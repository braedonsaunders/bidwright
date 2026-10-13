import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { componentCensus } from "@bidwright/domain";
import { apiGet, apiPost, getProjectId } from "../api-client.js";
import { resolveSourceDocumentId } from "../source-document.js";
import { recordSourceRead, selectedPages } from "../source-read.js";

export function registerComponentTools(server: McpServer) {
  server.tool("countComponents", "Read a component census from extracted schedule/legend tables and literal tagged callouts. Returns component types, counts per page, method, confidence and source refs. Optional symbolPages runs the existing visual cluster detector; clusters need source-legend interpretation. Overlapping methods are not summed. No takeoff marks are written.", {
    documentId: z.string(), pages: z.string().optional(),
    tagPrefixes: z.array(z.string().min(1).max(20)).max(30).default([]).describe("Literal tag prefixes observed in this source's legend; no trade defaults."),
    symbolPages: z.array(z.number().int().positive()).max(5).default([]).describe("Optional physical pages for existing symbol detection; page scans are returned separately."),
  }, async ({ documentId, pages, tagPrefixes, symbolPages }) => {
    documentId = await resolveSourceDocumentId(documentId);
    const doc = await apiGet(`/api/knowledge/documents/${getProjectId()}/${documentId}${pages ? `?pages=${encodeURIComponent(pages)}` : ""}`);
    const requested = selectedPages(pages);
    const tables = (doc.structuredData?.tables ?? []).filter((t: any) => !requested || requested.includes(t.pageNumber ?? t.page));
    const positioned = doc.structuredData?.pageText ?? doc.structuredData?.pages ?? [];
    const textPages = positioned.length ? positioned.filter((p: any) => !requested || requested.includes(Number(p.pageNumber ?? p.page))).map((p: any) => ({ pageNumber: Number(p.pageNumber ?? p.page), text: p.text ?? p.content ?? p.lines?.map((line: any) => line.text ?? line.content ?? "").join("\n") ?? "" }))
      : [...String(doc.content ?? "").matchAll(/--- Page (\d+) ---\n([\s\S]*?)(?=--- Page \d+ ---|$)/g)].map(m => ({ pageNumber: Number(m[1]), text: m[2] }));
    if (!textPages.length) textPages.push({ pageNumber: requested?.length === 1 ? requested[0] : null, text: doc.content ?? "" });
    const census = componentCensus(tables, textPages, tagPrefixes);
    const symbolMatches = [];
    for (const pageNumber of symbolPages) {
      const scan = await apiPost("/api/vision/scan-drawing", { projectId: getProjectId(), documentId, pageNumber });
      symbolMatches.push({ pageNumber, method: "symbol cluster matches", success: scan.success, error: scan.error, clusters: (scan.clusters ?? []).slice(0, 100).map((c: any) => ({ type: c.id, count: c.matchCount, confidence: c.avgConfidence, representativeBox: c.representativeBox })), imageWidth: scan.imageWidth, imageHeight: scan.imageHeight, fact: "Unclassified visual candidates; interpret against the legend and inspect pixels before treating as installed components." });
    }
    const telemetry = await recordSourceRead({ documentId, tool: "countComponents", pages: requested, offset: 0, returnedChars: 0, totalChars: (doc.content ?? "").length, truncated: false, checksum: doc.checksum });
    return { content: [{ type: "text" as const, text: JSON.stringify({ ...census, entries: census.entries.slice(0, 100).map(entry => ({ ...entry, sourceRefCount: entry.sourceRefs.length, sourceRefs: entry.sourceRefs.slice(0, 10).map(ref => ({ ...ref, text: ref.text.slice(0, 600) })) })), totalTypes: new Set(census.entries.map(e => e.type)).size, totalEntries: census.entries.length, truncated: census.entries.length > 100, symbolMatches, telemetry,
      takeoff: "saveSourceQuantityTakeoff({documentId,quantity,unit:'EA',label,sourceRefs}) saves a schedule count; pass its pickupId in updateWorksheetItem({itemId,takeoff:[{pickupId}]}). saveCountAsAnnotations saves inspected symbol matches. Narrow pages if more than 100 types are returned." }) }] };
  });
}
