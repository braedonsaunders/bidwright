/** One discovery covers a work phase even when a client asks for a single tool name. */
export const toolDiscoveryPhase = (family: string) => {
  if (["workspace", "quote", "worksheet", "summary"].includes(family)) return "estimate";
  if (["documents", "vision", "model"].includes(family)) return "sources";
  if (["knowledge", "resources"].includes(family)) return "pricing";
  if (["strategy", "review"].includes(family)) return "reconciliation";
  return "system";
};
export function compactToolSchema(value: any): any {
  if (Array.isArray(value)) return value.map(compactToolSchema);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !["$schema", "title"].includes(key)).map(([key, val]) =>
    [key, key === "description" && typeof val === "string" ? val.slice(0, 180) : compactToolSchema(val)]));
}
