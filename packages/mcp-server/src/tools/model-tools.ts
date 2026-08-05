import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiDelete, apiGet, apiPost, getProjectId, projectPath } from "../api-client.js";

function modelEditorPath(asset: any) {
  const sourcePath = asset.sourceDocumentId
    ? `/projects/${asset.projectId}/documents/${asset.sourceDocumentId}/download?inline=1`
    : asset.fileNodeId
      ? `/projects/${asset.projectId}/files/${asset.fileNodeId}/download?inline=1`
      : "";
  const params = new URLSearchParams({ embedded: "1", bidwright: "1" });
  if (sourcePath) params.set("url", sourcePath);
  if (asset.fileName) params.set("fileName", asset.fileName);
  return `/model-editor/index.html?${params.toString()}`;
}

function asRecord(value: any): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function asArray(value: any): any[] {
  return Array.isArray(value) ? value : [];
}

function compactValue(value: any, maxLength = 120) {
  if (value == null) return value;
  if (typeof value === "number" || typeof value === "boolean") return value;
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text;
}

function topRecordEntries(value: any, limit = 8) {
  return Object.entries(asRecord(value))
    .map(([key, entry]) => {
      const record = asRecord(entry);
      const count = Number(record.count ?? record.total ?? record.elements ?? record.quantity ?? entry ?? 0);
      return {
        key,
        count: Number.isFinite(count) ? count : undefined,
        sample: Object.keys(record).length > 0 ? compactValue(record.sample ?? record.label ?? record.name ?? record.type) : undefined,
      };
    })
    .sort((a, b) => (b.count ?? 0) - (a.count ?? 0))
    .slice(0, limit);
}

function previewRows(rows: any[], limit = 8) {
  return rows.slice(0, limit).map((row) => {
    const record = asRecord(row);
    return {
      id: record.id ?? record.elementId ?? record.quantityId ?? null,
      name: compactValue(record.name ?? record.description ?? record.label ?? record.type ?? record.class ?? ""),
      class: compactValue(record.class ?? record.category ?? record.kind ?? ""),
      material: compactValue(record.material ?? ""),
      level: compactValue(record.level ?? record.storey ?? ""),
      quantity: record.quantity ?? record.value ?? record.total ?? null,
      unit: record.unit ?? record.uom ?? null,
    };
  });
}

function paginate<T>(rows: T[], input: { limit?: number; offset?: number }, defaultLimit = 100, maxLimit = 500) {
  const offset = Math.max(0, input.offset ?? 0);
  const limit = Math.max(1, Math.min(input.limit ?? defaultLimit, maxLimit));
  const page = rows.slice(offset, offset + limit);
  return { rows: page, offset, limit, total: rows.length, hasMore: offset + page.length < rows.length };
}

function issuePreview(issues: any[], limit = 6) {
  return issues.slice(0, limit).map((issue) => {
    const record = asRecord(issue);
    return {
      severity: record.severity ?? record.level ?? "info",
      code: record.code ?? record.type ?? null,
      message: compactValue(record.message ?? record.description ?? issue, 180),
    };
  });
}

function normalizedKey(value: unknown) {
  return String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function quantityForTakeoffGroup(element: any, group: any) {
  const quantities = asArray(element.quantities);
  const measurement = normalizedKey(group.measurementType);
  const unit = normalizedKey(group.unit);
  const ranked = quantities
    .map((quantity) => {
      const quantityType = normalizedKey(quantity.quantityType);
      const quantityUnit = normalizedKey(quantity.unit);
      let score = 0;
      if (measurement && quantityType === measurement) score += 10;
      else if (measurement && quantityType.includes(measurement)) score += 6;
      if (unit && quantityUnit === unit) score += 8;
      score += Math.max(0, Math.min(1, Number(quantity.confidence) || 0));
      return { quantity, score };
    })
    .sort((a, b) => b.score - a.score);
  const preferred = ranked[0]?.score > 0 ? ranked[0].quantity : quantities[0];
  if (preferred && Number.isFinite(Number(preferred.value))) {
    return {
      quantityId: preferred.id as string | undefined,
      quantityType: preferred.quantityType ?? group.measurementType ?? "count",
      value: Number(preferred.value),
      unit: preferred.unit ?? group.unit ?? "",
    };
  }
  if (measurement === "count") {
    return { quantityId: undefined, quantityType: "count", value: 1, unit: group.unit || "EA" };
  }
  return { quantityId: undefined, quantityType: group.measurementType ?? "count", value: 0, unit: group.unit ?? "" };
}

function summarizeModelAsset(asset: any) {
  const manifest = asRecord(asset.manifest);
  const modelIngest = asRecord(manifest.modelIngest);
  const adapter = asRecord(modelIngest.adapter);
  const counts = asRecord(asset._count);
  const bom = asArray(asset.bom);
  const quantities = asArray(asset.quantities);
  const elements = asArray(asset.elements);
  const issues = asArray(asset.issues);
  const manifestCounts = asRecord(manifest.counts);
  const elementCount = counts.elements ?? manifestCounts.elements ?? manifest.elementCount ?? elements.length;
  const quantityCount = counts.quantities ?? manifestCounts.quantities ?? manifest.quantityCount ?? quantities.length;
  const bomCount = bom.length || manifestCounts.bomRows || manifest.bomRowCount || 0;
  const issueCount = counts.issues ?? manifestCounts.issues ?? issues.length;

  return {
    status: asset.status,
    format: asset.format,
    units: asset.units ?? manifest.units ?? null,
    parser: manifest.parser ?? manifest.parserName ?? manifest.generator ?? null,
    ingestAdapter: adapter.adapterId ?? manifest.adapterId ?? null,
    ingestProvider: adapter.provider ?? manifest.provider ?? null,
    ingestCapabilityStatus: adapter.status ?? manifest.adapterStatus ?? null,
    source: manifest.source ?? (asset.sourceDocumentId ? "source_document" : "file_node"),
    counts: {
      elements: elementCount,
      quantities: quantityCount,
      bomRows: bomCount,
      issues: issueCount,
    },
    elementStats: topRecordEntries(asset.elementStats, 10),
    bomPreview: previewRows(bom, 10),
    quantityPreview: previewRows(quantities, 10),
    elementPreview: previewRows(elements, 10),
    issuesPreview: issuePreview(issues, 8),
    agentHints: [
      elementCount ? "Use queryModelElements for filtered object/type/material/level searches." : null,
      quantityCount || bomCount ? "Use extractModelBom for persisted estimating quantities before creating worksheet items." : null,
      Boolean(manifest.editableInBidWrightModelEditor) ? "Open bidwrightEditorPath for visual QA or manual model review." : null,
      adapter.status && adapter.status !== "available" ? `Ingest adapter status is ${adapter.status}; inspect issues before relying on quantities.` : null,
    ].filter(Boolean),
  };
}

function normalizedAsset(asset: any) {
  const manifest = asset.manifest ?? {};
  return {
    id: asset.id,
    projectId: asset.projectId,
    fileName: asset.fileName,
    format: asset.format,
    status: asset.status,
    units: asset.units,
    checksum: asset.checksum,
    ingestCapabilityStatus: asRecord(asRecord(manifest.modelIngest).adapter).status ?? manifest.adapterStatus ?? null,
    ingestAdapter: asRecord(asRecord(manifest.modelIngest).adapter).adapterId ?? manifest.adapterId ?? null,
    source: manifest.source ?? (asset.sourceDocumentId ? "source_document" : "file_node"),
    sourceDocumentId: asset.sourceDocumentId ?? null,
    fileNodeId: asset.fileNodeId ?? null,
    editableInBidWrightModelEditor: Boolean(manifest.editableInBidWrightModelEditor),
    bidwrightEditorPath: modelEditorPath(asset),
    counts: asset._count ?? null,
    agentSummary: summarizeModelAsset(asset),
    updatedAt: asset.updatedAt ?? null,
  };
}

export function registerModelTools(server: McpServer) {
  server.tool(
    "getModelIngestCapabilities",
    `Report BidWright's CAD/BIM/model ingest capability matrix.

Use this before relying on RVT, DWG, IFC, DXF, STEP, mesh, or Autodesk APS extraction. It returns explicit adapter states: available, missing, unsupported, degraded, or failed.`,
    {
      format: z.string().optional().describe("Optional file extension filter, such as ifc, rvt, dwg, dxf, step, stl, obj, or glb."),
    },
    async ({ format }) => {
      const projectId = getProjectId();
      const params = new URLSearchParams();
      if (format) params.set("format", format);
      const result = await apiGet<any>(`/api/models/${projectId}/ingest-capabilities?${params.toString()}`);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    },
  );

  server.tool(
    "listModels",
    `Scan and list model/CAD/BIM assets in the current project.

Use this before model takeoff, model QA, model/BOM inspection, or when choosing a 3D file to open in BidWright's model editor.`,
    {},
    async () => {
      const projectId = getProjectId();
      const result = await apiGet<any>(`/api/models/${projectId}/assets?refresh=1`);
      const assets = result.assets ?? [];
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                count: assets.length,
                syncedIds: result.syncedIds ?? [],
                sourceCount: result.sourceCount ?? assets.length,
                models: assets.map(normalizedAsset),
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.tool(
    "getModelManifest",
    `Return a persisted BidWright model manifest.

The manifest includes parser status, source lineage, native file metadata, element/quantity counts, model issues, and any extracted model tree data.`,
    {
      modelId: z.string().describe("Model asset id returned by listModels"),
      includeRaw: z.boolean().default(false).describe("Include raw manifest arrays. Default false returns compact previews only."),
      limit: z.coerce.number().int().positive().max(200).default(50).describe("Rows per raw array when includeRaw=true."),
      offset: z.coerce.number().int().min(0).default(0).describe("Offset for raw arrays when includeRaw=true."),
    },
    async ({ modelId, includeRaw, limit, offset }) => {
      const projectId = getProjectId();
      const result = await apiGet<any>(`/api/models/${projectId}/assets/${modelId}`);
      const asset = result.asset;
      const elementsPage = paginate(asArray(asset.elements), { limit, offset }, 50, 200);
      const quantitiesPage = paginate(asArray(asset.quantities), { limit, offset }, 50, 200);
      const bomPage = paginate(asArray(asset.bom), { limit, offset }, 50, 200);
      const issuesPage = paginate(asArray(asset.issues), { limit, offset }, 50, 200);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                model: normalizedAsset(asset),
                agentSummary: summarizeModelAsset(asset),
                raw: includeRaw ? {
                  manifest: asset.manifest,
                  elementStats: asset.elementStats,
                  bom: { ...bomPage, rows: bomPage.rows },
                  elements: { ...elementsPage, rows: elementsPage.rows },
                  quantities: { ...quantitiesPage, rows: quantitiesPage.rows },
                  issues: { ...issuesPage, rows: issuesPage.rows },
                } : undefined,
                note: includeRaw
                  ? "Raw arrays are paginated with the same limit/offset. Use queryModelElements or extractModelBom for focused data."
                  : "Compact manifest only. Set includeRaw=true with limit/offset, or use queryModelElements/extractModelBom for focused data.",
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.tool(
    "queryModelElements",
    `Query persisted model elements by class/type/material/level/system/name/text.

This tool returns only extracted data. It does not infer or fabricate model elements.`,
    {
      modelId: z.string().describe("Model asset id returned by listModels"),
      query: z
        .object({
          text: z.string().optional(),
          class: z.string().optional(),
          type: z.string().optional(),
          material: z.string().optional(),
          level: z.string().optional(),
          system: z.string().optional(),
          name: z.string().optional(),
          limit: z.coerce.number().min(1).max(500).default(100),
          offset: z.coerce.number().min(0).default(0),
        })
        .default({ limit: 100 }),
    },
    async ({ modelId, query }) => {
      const projectId = getProjectId();
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== "") params.set(key, String(value));
      }
      const result = await apiGet<any>(`/api/models/${projectId}/assets/${modelId}/elements?${params.toString()}`);
      const elements = result.elements ?? [];
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                modelId,
                total: result.count ?? elements.length ?? 0,
                offset: query.offset ?? 0,
                limit: query.limit ?? 100,
                hasMore: (query.offset ?? 0) + elements.length < (result.count ?? elements.length ?? 0),
                elements,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.tool(
    "getModelElementDetails",
    `Return exact BIM/CAD element records, native properties, extracted quantities, and the system/run/estimate groups that contain them.

Use this after queryModelElements or queryModelTakeoffGroups when you need to inspect object properties, verify length/area/volume/count, or understand where an object sits in the detected topology. Element ids are Bidwright model-element ids, not viewer dbIds.`,
    {
      modelId: z.string().describe("Model asset id returned by listModels"),
      elementIds: z.array(z.string()).min(1).max(200).describe("Exact model element ids returned by queryModelElements or a takeoff group's memberElementIds"),
      includeProperties: z.boolean().default(true).describe("Include the complete native property bag. Disable for a smaller response."),
      includeGroups: z.boolean().default(true).describe("Attach matching system, network, run, and estimate group summaries."),
    },
    async ({ modelId, elementIds, includeProperties, includeGroups }) => {
      const projectId = getProjectId();
      const params = new URLSearchParams({
        ids: Array.from(new Set(elementIds)).join(","),
        limit: String(Math.min(500, elementIds.length)),
      });
      const [elementResult, topology] = await Promise.all([
        apiGet<any>(`/api/models/${projectId}/assets/${modelId}/elements?${params.toString()}`),
        includeGroups
          ? apiGet<any>(`/api/models/${projectId}/assets/${modelId}/topology`)
          : Promise.resolve({ groups: [] }),
      ]);
      const groups = asArray(topology.groups);
      const groupsByElement = new Map<string, any[]>();
      for (const group of groups) {
        for (const elementId of asArray(group.memberElementIds)) {
          const compactGroup = {
            id: group.id,
            signature: group.signature,
            parentId: group.parentId ?? null,
            kind: group.kind,
            name: group.name,
            source: group.source,
            confidence: group.confidence,
            measurementType: group.measurementType,
            quantity: group.quantity,
            unit: group.unit,
            warnings: group.warnings,
          };
          groupsByElement.set(String(elementId), [...(groupsByElement.get(String(elementId)) ?? []), compactGroup]);
        }
      }
      const elements = asArray(elementResult.elements).map((element) => ({
        ...element,
        properties: includeProperties ? element.properties : undefined,
        takeoffGroups: includeGroups ? groupsByElement.get(String(element.id)) ?? [] : undefined,
      }));
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({ modelId, requested: elementIds.length, returned: elements.length, elements }, null, 2),
        }],
      };
    },
  );

  server.tool(
    "queryModelTakeoffGroups",
    `Query the same persisted model topology used by Bidwright Takeoff Studio.

Returns authored and inferred systems, connected runs, networks, and estimator-facing rollups with member object ids, measurement type, quantity, unit, confidence, warnings, and hierarchy. Use this instead of inventing groupings from a truncated element list.`,
    {
      modelId: z.string().describe("Model asset id returned by listModels"),
      kind: z.enum(["system", "network", "run", "estimate"]).optional(),
      text: z.string().optional().describe("Case-insensitive match against group name, signature, trade, source, measurement type, or unit"),
      signature: z.string().optional().describe("Return one exact persisted group signature"),
      includeMemberIds: z.boolean().default(true),
      includeConnections: z.boolean().default(false).describe("Include the model connection graph when diagnosing topology"),
      limit: z.coerce.number().int().min(1).max(500).default(100),
      offset: z.coerce.number().int().min(0).default(0),
    },
    async ({ modelId, kind, text, signature, includeMemberIds, includeConnections, limit, offset }) => {
      const projectId = getProjectId();
      const topology = await apiGet<any>(
        `/api/models/${projectId}/assets/${modelId}/topology?includeConnections=${includeConnections ? "1" : "0"}`,
      );
      const needle = normalizedKey(text);
      const groups = asArray(topology.groups).filter((group) => {
        if (kind && group.kind !== kind) return false;
        if (signature && group.signature !== signature) return false;
        if (!needle) return true;
        return [group.name, group.signature, group.trade, group.source, group.measurementType, group.unit]
          .some((value) => normalizedKey(value).includes(needle));
      });
      const page = paginate(groups, { limit, offset }, 100, 500);
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            modelId,
            version: topology.version,
            diagnostics: topology.diagnostics,
            total: groups.length,
            offset: page.offset,
            limit: page.limit,
            hasMore: page.hasMore,
            groups: page.rows.map((group: any) => ({
              ...group,
              memberElementIds: includeMemberIds ? group.memberElementIds : undefined,
            })),
            connectionCount: topology.connectionCount ?? 0,
            connections: includeConnections ? topology.connections ?? [] : undefined,
            recipes: topology.recipes ?? [],
            overrides: topology.overrides ?? [],
          }, null, 2),
        }],
      };
    },
  );

  server.tool(
    "extractModelBom",
    `Return the persisted model BOM/quantity rows for estimating.

The BOM is conservative: unsupported formats return a clear status and empty rows instead of guessed quantities.`,
    {
      modelId: z.string().describe("Model asset id returned by listModels"),
      grouping: z.string().optional().describe("Requested grouping note, such as material, class, system, level, or assembly"),
      limit: z.coerce.number().int().positive().max(500).default(100),
      offset: z.coerce.number().int().min(0).default(0),
    },
    async ({ modelId, grouping, limit, offset }) => {
      const projectId = getProjectId();
      const result = await apiGet<any>(`/api/models/${projectId}/assets/${modelId}/bom`);
      const rows = result.rows ?? [];
      const page = paginate(rows, { limit, offset }, 100, 500);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                model: normalizedAsset(result.model),
                grouping: grouping ?? "native",
                status: rows.length > 0 ? "bom_available" : "no_bom_rows_available",
                rowCount: result.rowCount ?? rows.length,
                offset: page.offset,
                limit: page.limit,
                hasMore: page.hasMore,
                rows: page.rows,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.tool(
    "getModelTakeoffLinks",
    `Return the live 5D links between a model asset and quote worksheet line items.

Use this to understand which model elements/quantities already drive estimate rows before creating, editing, or deleting line items.`,
    {
      modelId: z.string().describe("Model asset id returned by listModels"),
    },
    async ({ modelId }) => {
      const projectId = getProjectId();
      const result = await apiGet<any>(`/api/models/${projectId}/assets/${modelId}/takeoff-links`);
      const links = result.links ?? [];
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                modelId,
                count: links.length,
                links,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.tool(
    "addModelTakeoffGroupToWorksheet",
    `Create one worksheet line from a persisted BIM/CAD system, run, network, or estimate group and bulk-link every source object for 5D traceability.

This is the agent equivalent of Takeoff Studio's explicit Add group action. It uses the topology's measured quantity and unit, preserves the group signature and native object provenance, and rolls the new worksheet item back if linking fails. Call queryModelTakeoffGroups first and use an exact signature.`,
    {
      modelId: z.string().describe("Model asset id returned by listModels"),
      groupSignature: z.string().describe("Exact signature returned by queryModelTakeoffGroups"),
      worksheetId: z.string().describe("Target worksheet id"),
      categoryId: z.string().nullable().optional().describe("Configured entity category id from getEntityCategories/quote item config"),
      category: z.string().min(1).describe("Worksheet category label"),
      entityType: z.string().min(1).describe("Configured category entity type"),
      entityName: z.string().optional().describe("Override the group name used for the worksheet row"),
      description: z.string().default(""),
      phaseId: z.string().nullable().optional(),
      quantityMultiplier: z.coerce.number().positive().default(1),
      cost: z.coerce.number().finite().default(0),
      markup: z.coerce.number().finite().default(0.2),
      price: z.coerce.number().finite().optional(),
      rateScheduleItemId: z.string().nullable().optional(),
      itemId: z.string().nullable().optional(),
      sourceNotes: z.string().optional(),
    },
    async (input) => {
      const projectId = getProjectId();
      const topology = await apiGet<any>(`/api/models/${projectId}/assets/${input.modelId}/topology`);
      const group = asArray(topology.groups).find((candidate) => candidate.signature === input.groupSignature);
      if (!group) {
        return {
          content: [{ type: "text" as const, text: `No takeoff group with signature ${input.groupSignature} exists on model ${input.modelId}. Call queryModelTakeoffGroups again.` }],
          isError: true,
        };
      }
      const memberElementIds = Array.from(new Set(asArray(group.memberElementIds).map(String)));
      if (memberElementIds.length === 0) {
        return {
          content: [{ type: "text" as const, text: `Takeoff group ${input.groupSignature} has no source elements and cannot be added.` }],
          isError: true,
        };
      }

      const elements: any[] = [];
      for (let offset = 0; offset < memberElementIds.length; offset += 500) {
        const ids = memberElementIds.slice(offset, offset + 500);
        const params = new URLSearchParams({ ids: ids.join(","), limit: String(ids.length) });
        const result = await apiGet<any>(`/api/models/${projectId}/assets/${input.modelId}/elements?${params.toString()}`);
        elements.push(...asArray(result.elements));
      }
      if (elements.length !== memberElementIds.length) {
        return {
          content: [{
            type: "text" as const,
            text: `Takeoff group ${input.groupSignature} references ${memberElementIds.length} objects but only ${elements.length} could be loaded. Rebuild the model topology before adding it.`,
          }],
          isError: true,
        };
      }

      const multiplier = input.quantityMultiplier;
      const groupQuantity = Number(group.quantity) || (normalizedKey(group.measurementType) === "count" ? elements.length : 0);
      const quantity = groupQuantity * multiplier;
      const lineItemBody = {
        phaseId: input.phaseId,
        categoryId: input.categoryId,
        category: input.category,
        entityType: input.entityType,
        entityName: input.entityName?.trim() || group.name || `${elements.length} model elements`,
        description: input.description,
        quantity,
        uom: String(group.unit || (normalizedKey(group.measurementType) === "count" ? "EA" : group.measurementType || "EA")),
        cost: input.cost,
        markup: input.markup,
        price: input.price ?? input.cost * (1 + input.markup),
        rateScheduleItemId: input.rateScheduleItemId,
        itemId: input.itemId,
        sourceNotes: [
          input.sourceNotes,
          `${group.kind} group: ${group.name}`,
          `${elements.length} model object${elements.length === 1 ? "" : "s"}`,
          `model: ${input.modelId}`,
          `signature: ${group.signature}`,
        ].filter(Boolean).join(" · "),
        sourceEvidence: {
          kind: "model_takeoff",
          modelId: input.modelId,
          groupId: group.id,
          groupSignature: group.signature,
          groupKind: group.kind,
          source: group.source,
          confidence: group.confidence,
          measurementType: group.measurementType,
          nativeQuantity: groupQuantity,
          quantityMultiplier: multiplier,
          unit: group.unit,
          memberElementIds,
          warnings: group.warnings ?? [],
        },
      };
      const createdResult = await apiPost<any>(
        `${projectPath(`/worksheets/${input.worksheetId}/items`)}?response=delta`,
        lineItemBody,
      );
      const createdItem = createdResult.item;
      if (!createdItem?.id) throw new Error("Worksheet item creation succeeded without returning a created item id.");

      const quantityRows = elements.map((element) => ({ element, resolved: quantityForTakeoffGroup(element, group) }));
      const resolvedTotal = quantityRows.reduce((sum, row) => sum + Math.max(0, Number(row.resolved.value) || 0), 0);
      const quantityScale = resolvedTotal > 0 && groupQuantity > 0 ? groupQuantity / resolvedTotal : 1;
      const links = quantityRows.map(({ element, resolved }) => {
        const baseValue = Number(resolved.value) || (groupQuantity > 0 ? groupQuantity / elements.length : 0);
        const derivedQuantity = baseValue * quantityScale * multiplier;
        return {
          modelElementId: element.id,
          modelQuantityId: resolved.quantityId,
          quantityField: "quantity",
          multiplier: quantityScale * multiplier,
          derivedQuantity,
          selection: {
            mode: "model-takeoff-group",
            groupId: group.id,
            groupSignature: group.signature,
            groupKind: group.kind,
            groupName: group.name,
            modelElementId: element.id,
            externalId: element.externalId,
            elementName: element.name,
            elementClass: element.elementClass,
            elementType: element.elementType,
            system: element.system,
            material: element.material,
            level: element.level,
            quantityType: resolved.quantityType,
            unit: resolved.unit,
          },
        };
      });
      try {
        for (let offset = 0; offset < links.length; offset += 500) {
          await apiPost(`/api/models/${projectId}/assets/${input.modelId}/takeoff-links/bulk`, {
            worksheetItemId: createdItem.id,
            links: links.slice(offset, offset + 500),
          });
        }
      } catch (error) {
        await apiDelete(projectPath(`/worksheet-items/${createdItem.id}`)).catch(() => undefined);
        throw error;
      }
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            created: true,
            worksheetItemId: createdItem.id,
            worksheetId: input.worksheetId,
            modelId: input.modelId,
            group: {
              id: group.id,
              signature: group.signature,
              kind: group.kind,
              name: group.name,
              measurementType: group.measurementType,
              quantity,
              unit: group.unit,
              memberCount: elements.length,
            },
            linksCreated: links.length,
            worksheetItem: createdItem,
          }, null, 2),
        }],
      };
    },
  );

  server.tool(
    "linkModelElementToWorksheetItem",
    `Create a 5D takeoff link from a model element or model quantity to an existing worksheet line item.

Call createWorksheetItem first when a new estimate row is needed, then call this tool with the returned worksheetItemId and the modelElementId/modelQuantityId from queryModelElements or getModelManifest.`,
    {
      modelId: z.string().describe("Model asset id returned by listModels"),
      worksheetItemId: z.string().describe("Worksheet item id to connect to model geometry"),
      modelElementId: z.string().optional().describe("Model element id, when the line item comes from a specific object/assembly"),
      modelQuantityId: z.string().optional().describe("Persisted model quantity id, when the line item should track a specific extracted quantity"),
      quantityField: z.string().default("quantity").describe("Worksheet item field driven by the model quantity"),
      multiplier: z.coerce.number().default(1).describe("Multiplier applied to the model quantity before writing/recording derivedQuantity"),
      derivedQuantity: z.coerce.number().optional().describe("Resolved quantity used for the worksheet item if already known"),
      selection: z.record(z.unknown()).optional().describe("Optional UI/model selection payload for traceability"),
    },
    async ({ modelId, ...input }) => {
      const projectId = getProjectId();
      const result = await apiPost<any>(`/api/models/${projectId}/assets/${modelId}/takeoff-links`, input);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                created: true,
                modelId,
                link: result.link ?? result,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.tool(
    "deleteModelTakeoffLink",
    "Delete a 5D takeoff link between a model asset and a worksheet line item. This does not delete the worksheet item itself.",
    {
      modelId: z.string().describe("Model asset id returned by listModels"),
      linkId: z.string().describe("Model takeoff link id returned by getModelTakeoffLinks"),
    },
    async ({ modelId, linkId }) => {
      const projectId = getProjectId();
      const result = await apiDelete<any>(`/api/models/${projectId}/assets/${modelId}/takeoff-links/${linkId}`);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result ?? { deleted: true, linkId }, null, 2),
          },
        ],
      };
    },
  );
}
