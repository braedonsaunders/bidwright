import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCompactClaudeMdContent, buildReviewClaudeMdContent, generateInstructionFiles } from "./claude-md-generator.js";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { claudeCodeAdapter } from "./cli-adapters/claude-code.js";
import { AGENT_SKILL_NAMES } from "./agent-workspace-assets.js";
import { join } from "node:path";
import { tmpdir } from "node:os";
const params = { projectDir: "/tmp/not-created", dataRoot: "/tmp", projectName: "Installation", clientName: "Client", location: "Site", scope: "Install only, exclude fabrication", quoteNumber: "Test", documents: [] };
test("launch writes the overview, client and discoverable portable skills for each runtime", async () => {
  const projectDir = await mkdtemp(join(tmpdir(), "bidwright-instructions-"));
  try {
    const sourceOverview = { generatedAt: "2026-10-11T00:00:00Z", sources: [], modelScan: null, takeoff: { byDocumentPage: [], calibrations: {} } };
    for (const runtime of ["claude-code", "codex", "openrouter"]) {
      await generateInstructionFiles(runtime, { ...params, projectDir, sourceOverview });
      if (runtime === "claude-code") {
        await writeFile(join(projectDir, ".claude/stale-state.json"), "{}");
        // This is the launch order used before spawn: instructions, then adapter preparation.
        await claudeCodeAdapter.prepareWorkspace({
          projectDir, mcpRunner: process.execPath, mcpArgs: [], permissions: [], isWin: false, isResume: false,
          mcpEnv: { BIDWRIGHT_API_URL: "http://localhost:4001", BIDWRIGHT_AUTH_TOKEN: "", BIDWRIGHT_PROJECT_ID: "project",
            BIDWRIGHT_REVISION_ID: "", BIDWRIGHT_QUOTE_ID: "", BIDWRIGHT_AGENT_MODE: "build_estimate" },
        });
        await assert.rejects(readFile(join(projectDir, ".claude/stale-state.json")), { code: "ENOENT" });
        assert.ok(JSON.parse(await readFile(join(projectDir, ".claude/settings.json"), "utf8")).mcpServers.bidwright);
        for (const name of AGENT_SKILL_NAMES) {
          assert.equal(await readFile(join(projectDir, ".claude/skills", name, "SKILL.md"), "utf8"),
            await readFile(join(projectDir, ".bidwright/skills", name, "SKILL.md"), "utf8"));
        }
      }
      assert.deepEqual(JSON.parse(await readFile(join(projectDir, ".bidwright/source-overview.json"), "utf8")), sourceOverview);
      const instructions = await readFile(join(projectDir, "AGENTS.md"), "utf8");
      assert.equal(instructions.includes("WebFetch"), runtime === "claude-code");
      const root = runtime === "claude-code" ? ".claude" : ".bidwright";
      assert.ok(instructions.includes(`${root}/skills/pdf-takeoff/SKILL.md`));
      assert.match(await readFile(join(projectDir, root, "skills/pdf-takeoff/SKILL.md"), "utf8"), /name: pdf-takeoff/);
      assert.match(await readFile(join(projectDir, ".bidwright/bin/bw.mjs"), "utf8"), /BIDWRIGHT_AUTH_TOKEN/);
    }
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});
test("estimate instructions expose the project scope and estimating toolkit", () => {
  const text = buildCompactClaudeMdContent(params);
  for (const required of ["readDrawingPage", "readDrawingTile", "viewIds", "getLineDerivation", "batchEditWorksheetItems", "saveEstimateStrategyStages", "listCalibrationLessons", "person-hours", "procurement pack", "Install only, exclude fabrication"]) assert.ok(text.includes(required), required);
  assert.ok(!text.includes("ToolSearch"));
  assert.ok(!text.includes("queued Gemini"));
});
test("review instructions require independent source reading before comparing priced quantities", () => {
  assert.match(buildReviewClaudeMdContent(params), /independently derive high-risk quantities/i);
});

test("estimate and review agents recover from overview analysis failures without claiming an unreadable PDF", () => {
  for (const text of [buildCompactClaudeMdContent(params), buildReviewClaudeMdContent(params)]) {
    assert.match(text, /try `readDrawingTile` on the same page with an explicit `bbox/);
    assert.match(text, /bypasses optional overview analysis/);
    assert.match(text, /one overview timeout does not establish that the PDF itself is unreadable/);
    assert.match(text, /qualify dependent quantities rather than claiming complete inspection/);
  }
});

test("estimating instructions require a saved customer-facing scope narrative proportional to the job", () => {
  const text = buildCompactClaudeMdContent(params);
  assert.match(text, /Setup → General → Description \/ Scope of Work/);
  assert.match(text, /updateQuote\(\{ description:/);
  assert.match(text, /one substantial paragraph/);
  assert.match(text, /approaching a page/);
  assert.match(text, /respect an explicit user request for shorter wording/);
  assert.match(text, /Preserve substantive human wording and approved commercial terms/);
  assert.match(text, /Do not promise unconfirmed/);
  assert.match(text, /reread `getWorkspace` and verify `revision\.description`/);
  assert.match(text, /chat summary, report section, leadLetter, or internal scratchpad does not fill this field/);
});
