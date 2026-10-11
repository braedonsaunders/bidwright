import { chmod, copyFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";

export const AGENT_SKILL_NAMES = ["pdf-takeoff", "bim-takeoff", "cad-takeoff", "model-3d-takeoff", "piping-mto", "code-aggregation", "specialist-subagents"] as const;

export function agentSkillIndex(runtime?: string): string {
  const root = runtime === "claude-code" ? ".claude/skills" : ".bidwright/skills";
  return `Portable skills: ${AGENT_SKILL_NAMES.map(name => `[${name}](${root}/${name}/SKILL.md)`).join(", ")}.`;
}

export async function writeAgentWorkspaceAssets(projectDir: string, runtime?: string) {
  // Source assets ship with the API image, including when tsc emits the monorepo tree.
  const assetRoot = ["./", "../../src/services/", "../../../../../src/services/"]
    .map(path => new URL(path, import.meta.url))
    .find(path => existsSync(new URL("bw-client.mjs", path)));
  if (!assetRoot) throw new Error("Agent workspace assets are missing from the API installation");
  for (const name of AGENT_SKILL_NAMES) {
    const roots = runtime === "claude-code" ? [".bidwright/skills", ".claude/skills"] : [".bidwright/skills"];
    for (const root of roots) {
      const directory = join(projectDir, root, name);
      await mkdir(directory, { recursive: true });
      await copyFile(new URL(`agent-skills/${name}.md`, assetRoot), join(directory, "SKILL.md"));
    }
  }
  const bin = join(projectDir, ".bidwright/bin");
  await mkdir(bin, { recursive: true });
  await copyFile(new URL("bw-client.mjs", assetRoot), join(bin, "bw.mjs"));
  await writeFile(join(bin, "bw"), '#!/bin/sh\nexec node "$(dirname "$0")/bw.mjs" "$@"\n');
  await chmod(join(bin, "bw"), 0o755);
}
