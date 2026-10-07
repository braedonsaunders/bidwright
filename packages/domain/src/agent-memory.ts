/**
 * The per-project agent memory file (agent-memory.json).
 *
 * The API and the UI keep sections under `sections`; the agent's MCP tool
 * used to write them as top-level keys. Both shapes exist on disk, so every
 * reader and writer goes through this one normaliser, which keeps every
 * section from either shape and never drops content.
 */
export interface AgentMemory {
  sections: Record<string, string>;
  updatedAt: string | null;
}

const RESERVED_KEYS = new Set(["sections", "updatedAt"]);

export function normalizeAgentMemory(raw: unknown): AgentMemory {
  const record = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const sections: Record<string, string> = {};
  // Legacy flat keys first, so an explicit `sections` entry wins on conflict.
  for (const [key, value] of Object.entries(record)) {
    if (RESERVED_KEYS.has(key)) continue;
    if (typeof value === "string") sections[key] = value;
    else if (value !== undefined && value !== null) sections[key] = JSON.stringify(value);
  }
  const nested = record.sections && typeof record.sections === "object" && !Array.isArray(record.sections)
    ? record.sections as Record<string, unknown>
    : {};
  for (const [key, value] of Object.entries(nested)) {
    if (typeof value === "string") sections[key] = value;
    else if (value !== undefined && value !== null) sections[key] = JSON.stringify(value);
  }
  return {
    sections,
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : null,
  };
}

export function setAgentMemorySection(memory: AgentMemory, section: string, content: string, append = false): AgentMemory {
  const existing = memory.sections[section];
  return {
    sections: { ...memory.sections, [section]: append && existing ? `${existing}\n${content}` : content },
    updatedAt: new Date().toISOString(),
  };
}
