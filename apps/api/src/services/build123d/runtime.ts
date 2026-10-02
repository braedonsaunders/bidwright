import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import {
	lstat,
	mkdtemp,
	readdir,
	readFile,
	realpath,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	type CadBuild,
	type CadProgram,
	type CadSource,
	validateCadBuild,
	validateCadProgram,
} from "@bidwright/domain";
import { spawnBubblewrappedProcess } from "@braedonsaunders/appkit-process-sandbox";
import { getProcessSandboxLauncherIdentity } from "../agent-host/launcher-identity.js";
import { prepareLauncherWritablePaths } from "../agent-host/writable-path-ownership.js";

const runnerDirectory = dirname(fileURLToPath(import.meta.url));
const runner = join(runnerDirectory, "runner.py");
const MAX_BYTES = 48 * 1024 * 1024;
async function scratchBytes(directory: string): Promise<number> {
	let bytes = 0;
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		if (entry.isSymbolicLink()) continue;
		const path = join(directory, entry.name);
		if (entry.isDirectory()) bytes += await scratchBytes(path);
		else bytes += (await lstat(path)).size;
		if (bytes > 128 * 1024 * 1024) break;
	}
	return bytes;
}
// One native CAD process at a time fits the production API memory budget.
let active = false;
const waiting: Array<() => void> = [];

async function acquire(signal?: AbortSignal) {
	signal?.throwIfAborted();
	if (!active) {
		active = true;
		return;
	}
	if (waiting.length >= 8)
		throw new Error("The CAD worker is busy. Please try again shortly.");
	await new Promise<void>((accept, reject) => {
		const ready = () => {
			signal?.removeEventListener("abort", abort);
			accept();
		};
		const abort = () => {
			const index = waiting.indexOf(ready);
			if (index >= 0) waiting.splice(index, 1);
			reject(signal?.reason ?? new Error("CAD build stopped"));
		};
		waiting.push(ready);
		signal?.addEventListener("abort", abort, { once: true });
	});
}
function release() {
	const next = waiting.shift();
	if (next) next();
	else active = false;
}

export function cadPythonPath(): string {
	return process.env.BIDWRIGHT_CAD_PYTHON ?? "/opt/cad-venv/bin/python";
}

export async function spawnCadSandbox(
	directory: string,
	python = cadPythonPath(),
): Promise<ChildProcess> {
	if (!existsSync(python))
		throw new Error(
			"The build123d runtime is not installed. Configure BIDWRIGHT_CAD_PYTHON for development.",
		);
	const environment = {
		PATH: `${dirname(python)}:/usr/bin:/bin`,
		HOME: directory,
		TMPDIR: directory,
		XDG_CACHE_HOME: directory,
		PYTHONDONTWRITEBYTECODE: "1",
		PYTHONNOUSERSITE: "1",
		OPENBLAS_NUM_THREADS: "1",
		OMP_NUM_THREADS: "1",
		MKL_NUM_THREADS: "1",
		VECLIB_MAXIMUM_THREADS: "1",
		LANG: "C.UTF-8",
	};
	if (process.platform === "linux") {
		const pythonRuntime = resolve(dirname(await realpath(python)), "..");
		const identity =
			process.getuid?.() === 0
				? getProcessSandboxLauncherIdentity()
				: undefined;
		if (identity) await prepareLauncherWritablePaths([directory], identity);
		return spawnBubblewrappedProcess({
			command: python,
			args: ["-I", runner],
			cwd: directory,
			writablePaths: [directory],
			readOnlyPaths: [
				"/usr",
				pythonRuntime,
				resolve(dirname(python), ".."),
				runnerDirectory,
			],
			maskedPaths: ["/data", "/home", "/root", "/var", "/etc"],
			network: "none",
			launcherIdentity: identity,
			limits: {
				cpuSeconds: 90,
				addressSpaceBytes: 1536 * 1024 * 1024,
				fileSizeBytes: MAX_BYTES,
				processes: 64,
				openFiles: 128,
			},
			environment,
			stdio: ["ignore", "ignore", "pipe"],
		});
	}
	if (process.platform === "darwin") {
		const pythonReal = await realpath(python);
		const pythonRuntime = resolve(dirname(pythonReal), "..");
		const privatePaths = [
			"/Users",
			"/Volumes",
			"/data",
			"/app",
			"/home",
			"/root",
			"/Library/Application Support",
			"/Library/Preferences",
			"/private/tmp",
			"/private/etc",
			"/private/var",
		];
		const readable = [
			resolve(dirname(python), ".."),
			runnerDirectory,
			directory,
		];
		// Keep system loader access available and mask private data roots.
		// Production uses the stricter Linux mount namespace above.
		const profile = `(version 1) (allow default)
      (deny network*) (deny process-fork)
      (deny process-exec (require-all (require-not (literal ${JSON.stringify(python)})) (require-not (subpath ${JSON.stringify(pythonRuntime)}))))
      (deny file-read-data (require-all (require-any ${privatePaths.map((p) => `(subpath ${JSON.stringify(p)})`).join(" ")}) ${readable.map((p) => `(require-not (subpath ${JSON.stringify(p)}))`).join(" ")}))
      (deny file-write* (require-all (require-not (subpath ${JSON.stringify(directory)})) (require-not (literal "/dev/null"))))`;
		return spawn(
			"/usr/bin/sandbox-exec",
			["-p", profile, python, "-I", runner],
			{ cwd: directory, env: environment, stdio: ["ignore", "ignore", "pipe"] },
		);
	}
	throw new Error(
		"CAD execution requires the Linux or macOS OS sandbox; unisolated execution is disabled.",
	);
}

async function run(
	payload: unknown,
	signal?: AbortSignal,
): Promise<Record<string, any>> {
	await acquire(signal);
	let directory: string | undefined;
	try {
		signal?.throwIfAborted();
		directory = await realpath(await mkdtemp(join(tmpdir(), "bidwright-cad-")));
		await writeFile(join(directory, "input.json"), JSON.stringify(payload), {
			mode: 0o600,
		});
		const child = await spawnCadSandbox(directory);
		await new Promise<void>((accept, reject) => {
			let stderr = "";
			let failure: Error | undefined;
			const stop = (error: Error) => {
				failure = error;
				child.kill("SIGKILL");
			};
			const abort = () => stop(new Error("CAD build stopped"));
			const timer = setTimeout(
				() =>
					stop(
						new Error(
							"CAD build exceeded its two-minute execution limit; split it into subassemblies",
						),
					),
				120000,
			);
			const diskCheck = setInterval(() => {
				void scratchBytes(directory!)
					.then((bytes) => {
						if (bytes > 128 * 1024 * 1024)
							stop(new Error("CAD scratch files exceeded their size limit"));
					})
					.catch(() => {});
			}, 1000);
			signal?.addEventListener("abort", abort, { once: true });
			child.stderr?.on("data", (chunk) => {
				stderr = (stderr + chunk.toString()).slice(-4000);
			});
			child.once("error", (error) => {
				failure = error;
			});
			child.once("close", (code, signalName) => {
				clearTimeout(timer);
				signal?.removeEventListener("abort", abort);
				clearInterval(diskCheck);
				if (failure) reject(failure);
				else if (code !== 0)
					reject(
						new Error(
							`CAD sandbox exited ${code ?? signalName}: ${stderr.trim()}`,
						),
					);
				else accept();
			});
			if (signal?.aborted) abort();
		});
		const outputPath = join(directory, "result.json");
		const output = await lstat(outputPath);
		if (
			!output.isFile() ||
			output.isSymbolicLink() ||
			output.size > MAX_BYTES ||
			(await realpath(outputPath)) !== outputPath
		)
			throw new Error("Invalid CAD output file");
		const result = await readFile(outputPath);
		if (result.length > MAX_BYTES)
			throw new Error("CAD result exceeds its output limit");
		const data = JSON.parse(result.toString("utf8"));
		if (!data.ok)
			throw new Error(`${data.error}\n${data.traceback ?? ""}`.slice(0, 8000));
		return data;
	} finally {
		if (directory) await rm(directory, { recursive: true, force: true });
		release();
	}
}

export async function getCadApiDocs(query: string, signal?: AbortSignal) {
	if (query.length > 300)
		throw new Error("CAD documentation query is too long");
	return run({ mode: "docs", query }, signal);
}

export async function executeCadProgram(
	program: CadProgram,
	input: {
		sources?: Record<string, CadSource>;
		geometry?: Record<string, string>;
	},
	signal?: AbortSignal,
): Promise<CadBuild & { preview: string }> {
	validateCadProgram(program);
	const sources: Record<string, CadSource> = Object.create(null);
	for (const [key, nodeId] of Object.entries(program.imports)) {
		const stored = input.sources && Object.hasOwn(input.sources, key) ? input.sources[key] : undefined;
		if (stored && stored.nodeId !== nodeId)
			throw new Error(
				`Input snapshot ${key} cannot change its target node; use a new key`,
			);
		const brep = stored?.brep ?? input.geometry?.[nodeId];
		if (!brep)
			throw new Error(
				`Current geometry for ${nodeId} is unavailable. Select that part in the editor before editing it.`,
			);
		sources[key] = { nodeId, brep };
	}
	const data = await run({ program, sources }, signal);
	const build = {
		program,
		parts: data.parts,
		sources,
		libraryVersion: data.libraryVersion,
		kernelVersion: data.kernelVersion,
	};
	validateCadBuild(build);
	return { ...build, preview: data.preview };
}
