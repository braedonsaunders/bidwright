import type { Worksheet, WorksheetItem } from "./models";

export const EstimatePositionKind = {
  Group: "group",
  Worksheet: "worksheet",
  Item: "item",
  Note: "note",
} as const;

export type EstimatePositionKind =
  (typeof EstimatePositionKind)[keyof typeof EstimatePositionKind];

export const EstimatePositionSourceKind = {
  Manual: "manual",
  Worksheet: "worksheet",
  WorksheetItem: "worksheet_item",
  Import: "import",
  Takeoff: "takeoff",
  Assembly: "assembly",
  Ai: "ai",
  Catalog: "catalog",
  Unknown: "unknown",
} as const;

export type EstimatePositionSourceKind =
  (typeof EstimatePositionSourceKind)[keyof typeof EstimatePositionSourceKind];

export const EstimatePositionConfidence = {
  Unknown: "unknown",
  Low: "low",
  Medium: "medium",
  High: "high",
  Verified: "verified",
} as const;

export type EstimatePositionConfidence =
  (typeof EstimatePositionConfidence)[keyof typeof EstimatePositionConfidence];

export const EstimatePositionValidationStatus = {
  Unvalidated: "unvalidated",
  NeedsReview: "needs_review",
  Valid: "valid",
  Invalid: "invalid",
  Waived: "waived",
} as const;

export type EstimatePositionValidationStatus =
  (typeof EstimatePositionValidationStatus)[keyof typeof EstimatePositionValidationStatus];

export type EstimatePositionJsonPrimitive = string | number | boolean | null;
export type EstimatePositionJsonValue =
  | EstimatePositionJsonPrimitive
  | EstimatePositionJsonValue[]
  | { [key: string]: EstimatePositionJsonValue };
export type EstimatePositionJsonObject = { [key: string]: EstimatePositionJsonValue };

export interface EstimatePositionClassification {
  system?: string | null;
  code?: string | null;
  label?: string | null;
  category?: string | null;
  entityType?: string | null;
  entityName?: string | null;
  phaseId?: string | null;
  catalogItemId?: string | null;
  assemblyId?: string | null;
  assemblyInstanceId?: string | null;
  costCode?: string | null;
  tags?: string[];
  attributes?: EstimatePositionJsonObject;
}

export interface EstimatePositionSourceRef {
  kind: EstimatePositionSourceKind;
  id: string | null;
  label?: string;
  notes?: string | null;
  documentId?: string | null;
  pageNumber?: number | null;
}

export interface EstimatePositionVersionToken {
  scope: "estimate_position";
  positionId: string;
  revision: number;
  source: {
    kind: EstimatePositionSourceKind;
    id: string | null;
    updatedAt: string | null;
    version: string | number | null;
  };
}

export interface EstimatePosition {
  id: string;
  kind: EstimatePositionKind;
  parentId: string | null;
  ordinal: string;
  label: string;
  description: string;
  quantity: number | null;
  uom: string | null;
  unitCost: number | null;
  totalCost: number | null;
  totalPrice: number | null;
  worksheetId: string | null;
  worksheetItemId: string | null;
  source: EstimatePositionSourceRef;
  confidence: EstimatePositionConfidence;
  validationStatus: EstimatePositionValidationStatus;
  classification: EstimatePositionClassification;
  versionToken: EstimatePositionVersionToken;
  sortKey: number;
}

export interface EstimatePositionTreeNode extends EstimatePosition {
  children: EstimatePositionTreeNode[];
  depth: number;
  pathIds: string[];
}

export const EstimatePositionTreeIssueCode = {
  DuplicateId: "duplicate_id",
  MissingParent: "missing_parent",
  Cycle: "cycle",
  OrdinalCollision: "ordinal_collision",
} as const;

export type EstimatePositionTreeIssueCode =
  (typeof EstimatePositionTreeIssueCode)[keyof typeof EstimatePositionTreeIssueCode];

export interface EstimatePositionTreeIssue {
  code: EstimatePositionTreeIssueCode;
  message: string;
  positionId?: string;
  parentId?: string | null;
  ordinal?: string;
  positionIds?: string[];
}

export interface EstimatePositionTree {
  roots: EstimatePositionTreeNode[];
  byId: Map<string, EstimatePositionTreeNode>;
  issues: EstimatePositionTreeIssue[];
}

export interface EstimatePositionOrdinalCollision {
  parentId: string | null;
  ordinal: string;
  positionIds: string[];
}

export interface BuildEstimatePositionTreeOptions {
  sort?: "ordinal" | "input";
}

export interface RenumberEstimatePositionsOptions {
  startAt?: number;
  sortBy?: "sortKey" | "ordinal" | "input";
}

export interface WorkspaceWorksheetLike extends Partial<Pick<Worksheet, "revisionId" | "name" | "order">> {
  id: Worksheet["id"];
  updatedAt?: string | null;
  version?: string | number | null;
}

export interface WorksheetItemLike extends Partial<
  Pick<
    WorksheetItem,
    | "worksheetId"
    | "phaseId"
    | "category"
    | "entityType"
    | "entityName"
    | "description"
    | "quantity"
    | "uom"
    | "cost"
    | "price"
    | "lineOrder"
    | "itemId"
    | "sourceNotes"
    | "sourceAssemblyId"
    | "assemblyInstanceId"
  >
> {
  id: WorksheetItem["id"];
  updatedAt?: string | null;
  version?: string | number | null;
}

export interface MapWorksheetToEstimatePositionOptions {
  ordinal?: string;
  sortKey?: number;
  confidence?: EstimatePositionConfidence;
  validationStatus?: EstimatePositionValidationStatus;
}

export interface MapWorksheetItemToEstimatePositionOptions extends MapWorksheetToEstimatePositionOptions {
  parentPositionId?: string | null;
  parentOrdinal?: string | null;
}

export interface MapWorkspaceEstimateToPositionsInput {
  worksheets: WorkspaceWorksheetLike[];
  worksheetItems?: WorksheetItemLike[];
}

export const estimatePositionPersistenceRecommendations = {
  tableName: "EstimatePosition",
  fields: [
    "id",
    "revisionId",
    "parentId",
    "ordinal",
    "kind",
    "sourceKind",
    "sourceId",
    "confidence",
    "validationStatus",
    "classification Json",
    "version Int @default(0)",
  ],
  indexes: [
    "[revisionId, parentId, ordinal]",
    "[sourceKind, sourceId]",
  ],
} as const;

export function estimatePositionIdForWorksheet(worksheetId: string): string {
  return `worksheet:${worksheetId}`;
}

export function estimatePositionIdForWorksheetItem(worksheetItemId: string): string {
  return `worksheet-item:${worksheetItemId}`;
}

export function parseEstimatePositionOrdinal(ordinal: string): number[] {
  const trimmed = ordinal.trim();
  if (!trimmed) {
    throw new Error("Estimate position ordinal cannot be empty");
  }

  return trimmed.split(".").map((segment) => {
    if (!/^\d+$/.test(segment)) {
      throw new Error(`Invalid estimate position ordinal "${ordinal}"`);
    }

    const value = Number.parseInt(segment, 10);
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new Error(`Invalid estimate position ordinal "${ordinal}"`);
    }

    return value;
  });
}

export function normalizeEstimatePositionOrdinal(ordinal: string): string {
  return parseEstimatePositionOrdinal(ordinal).join(".");
}

export function compareEstimatePositionOrdinals(a: string, b: string): number {
  return compareOrdinalSegments(parseEstimatePositionOrdinal(a), parseEstimatePositionOrdinal(b));
}

export function generateEstimatePositionOrdinal(
  parentOrdinal: string | null | undefined,
  oneBasedSiblingIndex: number,
): string {
  if (!Number.isSafeInteger(oneBasedSiblingIndex) || oneBasedSiblingIndex < 1) {
    throw new Error("Estimate position sibling index must be a positive integer");
  }

  const normalizedParent = parentOrdinal ? normalizeEstimatePositionOrdinal(parentOrdinal) : null;
  return normalizedParent ? `${normalizedParent}.${oneBasedSiblingIndex}` : String(oneBasedSiblingIndex);
}

export function getNextEstimatePositionOrdinal(
  siblingOrdinals: Array<string | null | undefined>,
  parentOrdinal: string | null = null,
): string {
  const parentSegments = parentOrdinal ? parseEstimatePositionOrdinal(parentOrdinal) : [];
  let maxSiblingIndex = 0;

  for (const ordinal of siblingOrdinals) {
    if (!ordinal) continue;

    const segments = parseEstimatePositionOrdinal(ordinal);
    if (!isDirectChildOrdinal(segments, parentSegments)) continue;

    maxSiblingIndex = Math.max(maxSiblingIndex, segments[segments.length - 1] ?? 0);
  }

  return generateEstimatePositionOrdinal(parentOrdinal, maxSiblingIndex + 1);
}

export function findEstimatePositionOrdinalCollisions(
  positions: EstimatePosition[],
): EstimatePositionOrdinalCollision[] {
  const buckets = new Map<string, { parentId: string | null; ordinal: string; positionIds: string[] }>();

  for (const position of positions) {
    const parentId = position.parentId ?? null;
    const ordinal = normalizeEstimatePositionOrdinal(position.ordinal);
    const key = `${parentId ?? ""}\u0000${ordinal}`;
    const bucket = buckets.get(key) ?? { parentId, ordinal, positionIds: [] };
    bucket.positionIds.push(position.id);
    buckets.set(key, bucket);
  }

  return Array.from(buckets.values())
    .filter((bucket) => bucket.positionIds.length > 1)
    .map((bucket) => ({
      parentId: bucket.parentId,
      ordinal: bucket.ordinal,
      positionIds: [...bucket.positionIds].sort(),
    }));
}

export function buildEstimatePositionTree(
  positions: EstimatePosition[],
  options: BuildEstimatePositionTreeOptions = {},
): EstimatePositionTree {
  const issues: EstimatePositionTreeIssue[] = [];
  const byId = new Map<string, EstimatePositionTreeNode>();

  for (const position of positions) {
    if (byId.has(position.id)) {
      issues.push({
        code: EstimatePositionTreeIssueCode.DuplicateId,
        positionId: position.id,
        message: `Duplicate estimate position id "${position.id}" was ignored.`,
      });
      continue;
    }

    byId.set(position.id, {
      ...position,
      children: [],
      depth: 0,
      pathIds: [position.id],
    });
  }

  for (const collision of findEstimatePositionOrdinalCollisions(Array.from(byId.values()))) {
    issues.push({
      code: EstimatePositionTreeIssueCode.OrdinalCollision,
      parentId: collision.parentId,
      ordinal: collision.ordinal,
      positionIds: collision.positionIds,
      message: `Ordinal "${collision.ordinal}" is used by multiple sibling estimate positions.`,
    });
  }

  const cyclicIds = findCyclicPositionIds(Array.from(byId.values()));
  for (const positionId of cyclicIds) {
    issues.push({
      code: EstimatePositionTreeIssueCode.Cycle,
      positionId,
      message: `Estimate position "${positionId}" participates in a parent cycle.`,
    });
  }

  const roots: EstimatePositionTreeNode[] = [];
  for (const node of byId.values()) {
    if (cyclicIds.has(node.id)) {
      roots.push(node);
      continue;
    }

    if (node.parentId) {
      const parent = byId.get(node.parentId);
      if (parent && !cyclicIds.has(parent.id)) {
        parent.children.push(node);
        continue;
      }

      if (!parent) {
        issues.push({
          code: EstimatePositionTreeIssueCode.MissingParent,
          positionId: node.id,
          parentId: node.parentId,
          message: `Estimate position "${node.id}" references missing parent "${node.parentId}".`,
        });
      }
    }

    roots.push(node);
  }

  const sort = options.sort ?? "ordinal";
  decorateTreeNodes(roots, sort);

  return { roots, byId, issues };
}

export function renumberEstimatePositions(
  positions: EstimatePosition[],
  options: RenumberEstimatePositionsOptions = {},
): EstimatePosition[] {
  const startAt = options.startAt ?? 1;
  if (!Number.isSafeInteger(startAt) || startAt < 1) {
    throw new Error("Estimate position renumbering startAt must be a positive integer");
  }

  const sortBy = options.sortBy ?? "sortKey";
  const inputIndexById = new Map<string, number>();
  positions.forEach((position, index) => {
    if (!inputIndexById.has(position.id)) {
      inputIndexById.set(position.id, index);
    }
  });

  const tree = buildEstimatePositionTree(positions, { sort: "input" });
  const nextPositions = new Map<string, EstimatePosition>();

  const visit = (nodes: EstimatePositionTreeNode[], parentOrdinal: string | null) => {
    const sorted = [...nodes].sort((a, b) => compareForRenumber(a, b, sortBy, inputIndexById));
    sorted.forEach((node, index) => {
      const ordinal = generateEstimatePositionOrdinal(parentOrdinal, startAt + index);
      nextPositions.set(node.id, { ...positionFromTreeNode(node), ordinal });
      visit(node.children, ordinal);
    });
  };

  visit(tree.roots, null);

  return positions.map((position) => nextPositions.get(position.id) ?? position);
}

export function createEstimatePositionVersionToken(args: {
  positionId: string;
  sourceKind: EstimatePositionSourceKind;
  sourceId?: string | null;
  sourceUpdatedAt?: string | null;
  sourceVersion?: string | number | null;
  revision?: number | null;
}): EstimatePositionVersionToken {
  const revision = args.revision ?? 0;
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new Error("Estimate position version token revision must be a non-negative integer");
  }

  return {
    scope: "estimate_position",
    positionId: args.positionId,
    revision,
    source: {
      kind: args.sourceKind,
      id: args.sourceId ?? null,
      updatedAt: args.sourceUpdatedAt ?? null,
      version: args.sourceVersion ?? null,
    },
  };
}

export function mapWorkspaceWorksheetToEstimatePosition(
  worksheet: WorkspaceWorksheetLike,
  options: MapWorksheetToEstimatePositionOptions = {},
): EstimatePosition {
  const id = estimatePositionIdForWorksheet(worksheet.id);
  const sortKey = options.sortKey ?? safeNumber(worksheet.order, 0);
  const ordinal = options.ordinal ?? generateEstimatePositionOrdinal(null, zeroBasedOrderToOneBased(sortKey));
  const label = nonEmptyString(worksheet.name) ?? "Worksheet";

  return {
    id,
    kind: EstimatePositionKind.Worksheet,
    parentId: null,
    ordinal,
    label,
    description: "",
    quantity: null,
    uom: null,
    unitCost: null,
    totalCost: null,
    totalPrice: null,
    worksheetId: worksheet.id,
    worksheetItemId: null,
    source: {
      kind: EstimatePositionSourceKind.Worksheet,
      id: worksheet.id,
      label,
    },
    confidence: options.confidence ?? EstimatePositionConfidence.High,
    validationStatus: options.validationStatus ?? EstimatePositionValidationStatus.Unvalidated,
    classification: {
      label,
      attributes: {
        revisionId: worksheet.revisionId ?? null,
      },
    },
    versionToken: createEstimatePositionVersionToken({
      positionId: id,
      sourceKind: EstimatePositionSourceKind.Worksheet,
      sourceId: worksheet.id,
      sourceUpdatedAt: worksheet.updatedAt ?? null,
      sourceVersion: worksheet.version ?? null,
    }),
    sortKey,
  };
}

export function mapWorksheetItemToEstimatePosition(
  item: WorksheetItemLike,
  options: MapWorksheetItemToEstimatePositionOptions = {},
): EstimatePosition {
  const id = estimatePositionIdForWorksheetItem(item.id);
  const worksheetId = item.worksheetId ?? null;
  const sortKey = options.sortKey ?? safeNumber(item.lineOrder, 0);
  const parentId =
    options.parentPositionId !== undefined
      ? options.parentPositionId
      : worksheetId
        ? estimatePositionIdForWorksheet(worksheetId)
        : null;
  const ordinal =
    options.ordinal ??
    generateEstimatePositionOrdinal(options.parentOrdinal ?? null, zeroBasedOrderToOneBased(sortKey));
  const quantity = nullableNumber(item.quantity);
  const unitCost = nullableNumber(item.cost);
  const totalCost = quantity !== null && unitCost !== null ? quantity * unitCost : null;
  const totalPrice = nullableNumber(item.price);
  const label =
    nonEmptyString(item.entityName) ??
    nonEmptyString(item.description) ??
    nonEmptyString(item.category) ??
    "Worksheet item";

  return {
    id,
    kind: EstimatePositionKind.Item,
    parentId,
    ordinal,
    label,
    description: item.description ?? "",
    quantity,
    uom: item.uom ?? null,
    unitCost,
    totalCost,
    totalPrice,
    worksheetId,
    worksheetItemId: item.id,
    source: {
      kind: EstimatePositionSourceKind.WorksheetItem,
      id: item.id,
      label,
      notes: item.sourceNotes ?? null,
    },
    confidence: options.confidence ?? EstimatePositionConfidence.High,
    validationStatus: options.validationStatus ?? EstimatePositionValidationStatus.Unvalidated,
    classification: {
      category: item.category ?? null,
      entityType: item.entityType ?? null,
      entityName: item.entityName ?? null,
      phaseId: item.phaseId ?? null,
      catalogItemId: item.itemId ?? null,
      assemblyId: item.sourceAssemblyId ?? null,
      assemblyInstanceId: item.assemblyInstanceId ?? null,
    },
    versionToken: createEstimatePositionVersionToken({
      positionId: id,
      sourceKind: EstimatePositionSourceKind.WorksheetItem,
      sourceId: item.id,
      sourceUpdatedAt: item.updatedAt ?? null,
      sourceVersion: item.version ?? null,
    }),
    sortKey,
  };
}

export function mapWorkspaceEstimateToPositions(
  input: MapWorkspaceEstimateToPositionsInput,
  options: MapWorksheetToEstimatePositionOptions = {},
): EstimatePosition[] {
  const positions: EstimatePosition[] = [];
  const worksheets = [...input.worksheets].sort(compareWorksheetLikes);
  const itemsByWorksheetId = new Map<string, WorksheetItemLike[]>();
  const seenItemIds = new Set<string>();

  for (const item of input.worksheetItems ?? []) {
    const worksheetId = item.worksheetId ?? "";
    const items = itemsByWorksheetId.get(worksheetId) ?? [];
    items.push(item);
    itemsByWorksheetId.set(worksheetId, items);
  }

  worksheets.forEach((worksheet, worksheetIndex) => {
    const worksheetOrdinal = generateEstimatePositionOrdinal(null, worksheetIndex + 1);
    const worksheetPosition = mapWorkspaceWorksheetToEstimatePosition(worksheet, {
      ...options,
      ordinal: worksheetOrdinal,
      sortKey: worksheetIndex,
    });
    positions.push(worksheetPosition);

    const worksheetItems = [...(itemsByWorksheetId.get(worksheet.id) ?? [])].sort(compareWorksheetItemLikes);
    worksheetItems.forEach((item, itemIndex) => {
      seenItemIds.add(item.id);
      positions.push(mapWorksheetItemToEstimatePosition(item, {
        ...options,
        parentPositionId: worksheetPosition.id,
        parentOrdinal: worksheetOrdinal,
        ordinal: generateEstimatePositionOrdinal(worksheetOrdinal, itemIndex + 1),
        sortKey: itemIndex,
      }));
    });
  });

  const orphanItems = [...(input.worksheetItems ?? [])]
    .filter((item) => !seenItemIds.has(item.id))
    .sort(compareWorksheetItemLikes);

  orphanItems.forEach((item, index) => {
    positions.push(mapWorksheetItemToEstimatePosition(item, {
      ...options,
      parentPositionId: null,
      parentOrdinal: null,
      ordinal: generateEstimatePositionOrdinal(null, worksheets.length + index + 1),
      sortKey: worksheets.length + index,
    }));
  });

  return positions;
}

function compareOrdinalSegments(a: number[], b: number[]): number {
  const maxLength = Math.max(a.length, b.length);
  for (let index = 0; index < maxLength; index += 1) {
    const aValue = a[index];
    const bValue = b[index];

    if (aValue === undefined) return -1;
    if (bValue === undefined) return 1;
    if (aValue !== bValue) return aValue - bValue;
  }

  return 0;
}

function isDirectChildOrdinal(segments: number[], parentSegments: number[]): boolean {
  if (segments.length !== parentSegments.length + 1) return false;
  return parentSegments.every((segment, index) => segments[index] === segment);
}

function tryCompareEstimatePositionOrdinals(a: string, b: string): number {
  try {
    return compareEstimatePositionOrdinals(a, b);
  } catch {
    return a.localeCompare(b);
  }
}

function decorateTreeNodes(nodes: EstimatePositionTreeNode[], sort: "ordinal" | "input"): void {
  if (sort === "ordinal") {
    nodes.sort(compareTreeNodes);
  }

  nodes.forEach((node) => {
    node.depth = 0;
    node.pathIds = [node.id];
    decorateTreeNode(node, sort);
  });
}

function decorateTreeNode(node: EstimatePositionTreeNode, sort: "ordinal" | "input"): void {
  if (sort === "ordinal") {
    node.children.sort(compareTreeNodes);
  }

  for (const child of node.children) {
    child.depth = node.depth + 1;
    child.pathIds = [...node.pathIds, child.id];
    decorateTreeNode(child, sort);
  }
}

function compareTreeNodes(a: EstimatePositionTreeNode, b: EstimatePositionTreeNode): number {
  const ordinalCompare = tryCompareEstimatePositionOrdinals(a.ordinal, b.ordinal);
  if (ordinalCompare !== 0) return ordinalCompare;

  const sortKeyCompare = a.sortKey - b.sortKey;
  if (sortKeyCompare !== 0) return sortKeyCompare;

  return a.id.localeCompare(b.id);
}

function compareForRenumber(
  a: EstimatePositionTreeNode,
  b: EstimatePositionTreeNode,
  sortBy: "sortKey" | "ordinal" | "input",
  inputIndexById: Map<string, number>,
): number {
  if (sortBy === "input") {
    return (inputIndexById.get(a.id) ?? 0) - (inputIndexById.get(b.id) ?? 0);
  }

  if (sortBy === "ordinal") {
    const ordinalCompare = tryCompareEstimatePositionOrdinals(a.ordinal, b.ordinal);
    if (ordinalCompare !== 0) return ordinalCompare;
  }

  const sortKeyCompare = a.sortKey - b.sortKey;
  if (sortKeyCompare !== 0) return sortKeyCompare;

  if (sortBy === "sortKey") {
    const ordinalCompare = tryCompareEstimatePositionOrdinals(a.ordinal, b.ordinal);
    if (ordinalCompare !== 0) return ordinalCompare;
  }

  return a.id.localeCompare(b.id);
}

function positionFromTreeNode(node: EstimatePositionTreeNode): EstimatePosition {
  const {
    children: _children,
    depth: _depth,
    pathIds: _pathIds,
    ...position
  } = node;
  return position;
}

function findCyclicPositionIds(positions: EstimatePosition[]): Set<string> {
  const byId = new Map(positions.map((position) => [position.id, position]));
  const cyclicIds = new Set<string>();

  for (const position of positions) {
    const chain: string[] = [];
    let current: EstimatePosition | undefined = position;

    while (current) {
      const existingIndex = chain.indexOf(current.id);
      if (existingIndex >= 0) {
        for (const id of chain.slice(existingIndex)) {
          cyclicIds.add(id);
        }
        break;
      }

      chain.push(current.id);
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
  }

  return cyclicIds;
}

function compareWorksheetLikes(a: WorkspaceWorksheetLike, b: WorkspaceWorksheetLike): number {
  const orderCompare = safeNumber(a.order, 0) - safeNumber(b.order, 0);
  if (orderCompare !== 0) return orderCompare;
  return a.id.localeCompare(b.id);
}

function compareWorksheetItemLikes(a: WorksheetItemLike, b: WorksheetItemLike): number {
  const worksheetCompare = (a.worksheetId ?? "").localeCompare(b.worksheetId ?? "");
  if (worksheetCompare !== 0) return worksheetCompare;

  const orderCompare = safeNumber(a.lineOrder, 0) - safeNumber(b.lineOrder, 0);
  if (orderCompare !== 0) return orderCompare;

  return a.id.localeCompare(b.id);
}

function zeroBasedOrderToOneBased(value: number): number {
  return Math.max(1, Math.trunc(value) + 1);
}

function safeNumber(value: number | null | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function nullableNumber(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function nonEmptyString(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
