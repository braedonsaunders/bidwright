import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const INSTRUCTIONS = ["CLAUDE.md", "AGENTS.md", "codex.md", "GEMINI.md"];

/** Routes generate current role instructions before restoring provider state. */
export async function preserveCurrentInstructions<T>(directory: string, restore: () => Promise<T>): Promise<T> {
  const current = await Promise.all(INSTRUCTIONS.map(async (name) => ({
    name, text: await readFile(join(directory, name), "utf8").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    }),
  })));
  try {
    return await restore();
  } finally {
    await mkdir(directory, { recursive: true });
    for (const file of current) {
      if (file.text !== null) await writeFile(join(directory, file.name), file.text, "utf8");
    }
  }
}
