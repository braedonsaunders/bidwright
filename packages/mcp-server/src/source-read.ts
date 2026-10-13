import { apiPost, getProjectId } from "./api-client.js";
import type { SourceReadRecord } from "@bidwright/domain";

export function selectedPages(pages?: string): number[] | undefined {
  pages = pages?.replace(/\s/g, "");
  if (!pages || !/^\d+(?:-\d+)?$/.test(pages)) return undefined;
  const [start, end = start] = pages.split("-").map(Number);
  return end >= start && end - start < 2000 ? Array.from({ length: end-start+1 }, (_, i) => start+i) : undefined;
}

/** Only record the returned slice, never the full content fetched internally. */
export async function recordSourceRead(read: SourceReadRecord): Promise<string> {
  if (!getProjectId().startsWith("project-") || /^(kb-|kdoc-)/.test(read.documentId)) return "";
  try { await apiPost(`/api/projects/${encodeURIComponent(getProjectId())}/source-reads`, read); return ""; }
  catch { return "\n[Source delivery telemetry was unavailable; this read may be absent from coverage facts.]"; }
}
