/**
 * LocalProcessHost — run the CLI as a direct `child_process.spawn` on this
 * host. This is the default everywhere (desktop, dev, Docker self-host)
 * until B1 introduces `BubblewrappedHost` for the multi-tenant case.
 *
 * Lifted byte-for-byte from the previous free `spawnChild` function in
 * `cli-runtime.ts` so behavior is unchanged for all existing callers.
 */

import { spawn, type ChildProcess, execSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { quoteWindowsArg } from "../cli-adapters/shared.js";
import type { AgentRuntimeHost, SpawnProcessOpts } from "./types.js";

export const localProcessHost: AgentRuntimeHost = {
  id: "local-process",

  async spawnProcess(opts: SpawnProcessOpts): Promise<ChildProcess> {
    const { plan, projectDir, cliEnv, isWin, batSuffix } = opts;

    if (!isWin) {
      console.log(
        `[cli:spawn] cmd=${plan.cliCmd} cwd=${projectDir} argCount=${plan.args.length}`,
      );
      const child = spawn(plan.cliCmd, plan.args, {
        cwd: projectDir,
        env: { ...process.env, ...cliEnv },
        stdio: ["ignore", "pipe", "pipe"],
      });
      console.log(`[cli:spawn] pid=${child.pid}`);
      return child;
    }

    // Windows: resolve the .cmd/.bat/.exe behind the binary name and wrap in
    // a launcher .bat so we don't fight cmd.exe over argument quoting.
    let resolvedCmd = plan.cliCmd;
    try {
      const candidates = execSync(`where ${plan.cliCmd}`, { encoding: "utf-8" })
        .trim()
        .split(/\r?\n/);
      resolvedCmd =
        candidates.find((c) => /\.(cmd|bat|exe)$/i.test(c)) || candidates[0] || resolvedCmd;
    } catch {
      // fall back to plan.cliCmd
    }

    const args = [...plan.args];
    const promptFile = join(projectDir, ".bidwright-prompt.txt");
    let usePromptStdin = false;

    if (plan.promptHandling.kind === "flag") {
      const idx = plan.promptHandling.index;
      if (idx >= 0 && idx < args.length) {
        await writeFile(promptFile, args[idx], "utf-8");
        args[idx] = "Execute the instructions in .bidwright-prompt.txt";
      }
    } else if (plan.promptHandling.kind === "positional-stdin") {
      const idx = plan.promptHandling.index;
      if (idx >= 0 && idx < args.length) {
        await writeFile(promptFile, args[idx], "utf-8");
        args[idx] = "-";
        usePromptStdin = true;
      }
    } // "positional" needs no transformation; quoting handles it.

    const batLines = ["@echo off"];
    const quotedArgs = args.map(quoteWindowsArg);
    if (usePromptStdin) {
      batLines.push(`type "${promptFile}" | call "${resolvedCmd}" ${quotedArgs.join(" ")}`);
    } else {
      batLines.push(`call "${resolvedCmd}" ${quotedArgs.join(" ")}`);
    }

    const batFile = join(projectDir, `.bidwright-${batSuffix}.bat`);
    await writeFile(batFile, batLines.join("\r\n") + "\r\n");

    console.log(`[cli:spawn:win] bat=${batFile} cmd=${resolvedCmd}`);
    const child = spawn("cmd.exe", ["/c", batFile], {
      cwd: projectDir,
      env: { ...process.env, ...cliEnv },
      stdio: ["ignore", "pipe", "pipe"],
    });
    console.log(`[cli:spawn:win] pid=${child.pid}`);
    return child;
  },
};
