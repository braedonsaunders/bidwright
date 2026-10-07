#!/usr/bin/env tsx
import { randomInt } from "node:crypto";
import { deflateSync } from "node:zlib";
import { readFile, writeFile } from "node:fs/promises";

const argv = process.argv.slice(2);
const option = (name: string, fallback = "") => argv.includes(name) ? argv[argv.indexOf(name) + 1] : fallback;
const api = option("--api-url", process.env.BIDWRIGHT_API_URL || "https://bidwright.rassaun.com/proxy").replace(/\/$/, "");
const source = option("--project-id", "project-92c0a6f3-b9c6-42d0-9ff0-1f078ba8a823");
const runtime = option("--runtime", "openrouter");
const model = option("--model", "moonshotai/kimi-k3");
const tokenFile = option("--token-file");
const token = tokenFile ? (await readFile(tokenFile, "utf8")).trim() : process.env.BIDWRIGHT_AUTH_TOKEN;
if (!token) throw new Error("Set BIDWRIGHT_AUTH_TOKEN or --token-file (never pass secrets in argv).");
if (!argv.includes("--execute")) throw new Error("Pass --execute to create an isolated project and run the image probe.");
const headers = { Authorization: `Bearer ${token}` };
async function request(path: string, body?: unknown) {
  const response = await fetch(`${api}${path}`, { headers: { ...headers, "Content-Type": "application/json" },
    method: body === undefined ? "GET" : "POST", body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response.json() as Promise<any>;
}
// Pure PNG encoder: no text, filenames, OCR layer, or metadata reveals the answer.
function crc32(bytes: Buffer) { let crc = 0xffffffff; for (const byte of bytes) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); } return (crc ^ 0xffffffff) >>> 0; }
function chunk(type: string, data: Buffer) { const name = Buffer.from(type); const size = Buffer.alloc(4); size.writeUInt32BE(data.length); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([name, data]))); return Buffer.concat([size, name, data, crc]); }
const palette = [{ name: "red", rgb: [230, 20, 20] }, { name: "green", rgb: [10, 180, 30] }, { name: "blue", rgb: [20, 40, 230] }, { name: "yellow", rgb: [240, 220, 10] }, { name: "black", rgb: [0, 0, 0] }, { name: "white", rgb: [255, 255, 255] }];
const colors = palette.slice(); for (let i = colors.length - 1; i > 0; i--) { const j = randomInt(i + 1); [colors[i], colors[j]] = [colors[j], colors[i]]; }
const expected = colors.slice(0, 4).map((c) => c.name);
const width = 512, height = 512;
const raw = Buffer.alloc(height * (1 + width * 3));
for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { const color = colors[(y < height / 2 ? 0 : 2) + (x < width / 2 ? 0 : 1)]; const offset = y * (1 + width * 3) + 1 + x * 3; raw.set(color.rgb, offset); }
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
const png = Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
const copied = await request(`/projects/${source}/copy`, { resetEstimate: true });
const projectId = copied.workspace?.project?.id;
if (!projectId || projectId === source) throw new Error("No isolated clone; refusing to continue.");
let active = false;
const stop = async () => { if (active) await request(`/api/cli/${projectId}/stop`, {}).catch(() => {}); active = false; };
const interrupt = () => { void stop().finally(() => process.exit(130)); };
process.once("SIGINT", interrupt); process.once("SIGTERM", interrupt);
try {
  const form = new FormData(); form.append("file", new Blob([png]), "transport-probe.png");
  const upload = await fetch(`${api}/projects/${projectId}/files/upload`, { method: "POST", headers, body: form, signal: AbortSignal.timeout(60_000) });
  if (!upload.ok) throw new Error(`Upload failed: HTTP ${upload.status}`);
  const prompt = "Use listProjectImages and inspectProjectImage to inspect transport-probe.png. It has four quadrants. Return only a JSON array with four lower-case color names in order top-left, top-right, bottom-left, bottom-right. Do not use shell or file-byte inspection; inspect the image returned by the tool. If you cannot see pixels say IMAGE_UNAVAILABLE.";
  // This project was created exclusively by the probe. A timed-out start response
  // can still leave a running agent, so arm cleanup before sending the request.
  active = true;
  const started = await request(`/api/cli/${projectId}/message`, { message: prompt, runtime, model, mode: "qa" });
  const deadline = Date.now() + 5 * 60_000;
  let status: any;
  while (Date.now() < deadline) {
    status = await request(`/api/cli/${projectId}/status`);
    if (["completed", "failed", "stopped"].includes(status.status)) { active = false; break; }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  const events: any[] = status?.events || [];
  const answers = events.filter((event) => event.type === "message" && event.data?.role === "assistant").map((event) => event.data.content);
  const answer = answers.at(-1) || "";
  let observed: unknown;
  try { observed = JSON.parse(answer.match(/\[[\s\S]*?\]/)?.[0] || "null"); } catch { observed = null; }
  const inspected = events.some((event) => /inspectProjectImage/.test(event.data?.toolId || ""));
  const passed = status?.status === "completed" && inspected && JSON.stringify(observed) === JSON.stringify(expected);
  const result = { runtime, model, sourceProject: source, projectId, runId: started.sessionId, status: status?.status,
    passed, expected, observed, inspected, answer, note: "Pass demonstrates pixels reached this runtime/model on this attempt; it does not validate drawing interpretation." };
  await writeFile(option("--out", `image-probe-${Date.now()}.json`), JSON.stringify(result, null, 2), { mode: 0o600 });
  console.log(JSON.stringify(result, null, 2));
  if (!passed) process.exitCode = 1;
} finally { await stop(); process.off("SIGINT", interrupt); process.off("SIGTERM", interrupt); }
