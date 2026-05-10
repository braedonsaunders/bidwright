import test from "node:test";
import assert from "node:assert/strict";

import {
  EstimatePositionConfidence,
  EstimatePositionKind,
  EstimatePositionTreeIssueCode,
  EstimatePositionValidationStatus,
  buildEstimatePositionTree,
  estimatePositionIdForWorksheet,
  estimatePositionIdForWorksheetItem,
  findEstimatePositionOrdinalCollisions,
  generateEstimatePositionOrdinal,
  getNextEstimatePositionOrdinal,
  mapWorkspaceEstimateToPositions,
  renumberEstimatePositions,
  type EstimatePosition,
} from "./estimate-position";

function makePosition(patch: Partial<EstimatePosition> & Pick<EstimatePosition, "id" | "ordinal">): EstimatePosition {
  return {
    id: patch.id,
    kind: patch.kind ?? EstimatePositionKind.Item,
    parentId: patch.parentId ?? null,
    ordinal: patch.ordinal,
    label: patch.label ?? patch.id,
    description: patch.description ?? "",
    quantity: patch.quantity ?? null,
    uom: patch.uom ?? null,
    unitCost: patch.unitCost ?? null,
    totalCost: patch.totalCost ?? null,
    totalPrice: patch.totalPrice ?? null,
    worksheetId: patch.worksheetId ?? null,
    worksheetItemId: patch.worksheetItemId ?? null,
    source: patch.source ?? { kind: "manual", id: patch.id },
    confidence: patch.confidence ?? EstimatePositionConfidence.High,
    validationStatus: patch.validationStatus ?? EstimatePositionValidationStatus.Unvalidated,
    classification: patch.classification ?? {},
    versionToken: patch.versionToken ?? {
      scope: "estimate_position",
      positionId: patch.id,
      revision: 0,
      source: {
        kind: "manual",
        id: patch.id,
        updatedAt: null,
        version: null,
      },
    },
    sortKey: patch.sortKey ?? 0,
  };
}

test("buildEstimatePositionTree constructs sorted hierarchy with depth and path ids", () => {
  const positions = [
    makePosition({ id: "child-b", parentId: "root-a", ordinal: "1.2", sortKey: 2 }),
    makePosition({ id: "root-b", ordinal: "2", sortKey: 2 }),
    makePosition({ id: "child-a", parentId: "root-a", ordinal: "1.1", sortKey: 1 }),
    makePosition({ id: "root-a", ordinal: "1", sortKey: 1 }),
  ];

  const tree = buildEstimatePositionTree(positions);

  assert.equal(tree.issues.length, 0);
  assert.deepEqual(tree.roots.map((node) => node.id), ["root-a", "root-b"]);
  assert.deepEqual(tree.roots[0]!.children.map((node) => node.id), ["child-a", "child-b"]);
  assert.equal(tree.byId.get("child-a")!.depth, 1);
  assert.deepEqual(tree.byId.get("child-a")!.pathIds, ["root-a", "child-a"]);
});

test("ordinal helpers detect sibling collisions and generate next direct-child ordinal", () => {
  const positions = [
    makePosition({ id: "a", parentId: null, ordinal: "1" }),
    makePosition({ id: "b", parentId: null, ordinal: "1" }),
    makePosition({ id: "c", parentId: "a", ordinal: "1.1" }),
    makePosition({ id: "d", parentId: "a", ordinal: "1.2" }),
  ];

  assert.equal(generateEstimatePositionOrdinal("1", 3), "1.3");
  assert.equal(getNextEstimatePositionOrdinal(["1.1", "1.2", "2.1"], "1"), "1.3");

  const collisions = findEstimatePositionOrdinalCollisions(positions);
  assert.deepEqual(collisions, [{ parentId: null, ordinal: "1", positionIds: ["a", "b"] }]);

  const tree = buildEstimatePositionTree(positions);
  assert.equal(
    tree.issues.some((issue) => issue.code === EstimatePositionTreeIssueCode.OrdinalCollision),
    true,
  );
});

test("renumberEstimatePositions densifies roots and child ordinals after collisions", () => {
  const positions = [
    makePosition({ id: "root-b", ordinal: "1", sortKey: 20 }),
    makePosition({ id: "root-a", ordinal: "1", sortKey: 10 }),
    makePosition({ id: "child-b", parentId: "root-a", ordinal: "1.9", sortKey: 20 }),
    makePosition({ id: "child-a", parentId: "root-a", ordinal: "1.9", sortKey: 10 }),
  ];

  const renumbered = renumberEstimatePositions(positions);
  const byId = new Map(renumbered.map((position) => [position.id, position]));

  assert.equal(byId.get("root-a")!.ordinal, "1");
  assert.equal(byId.get("child-a")!.ordinal, "1.1");
  assert.equal(byId.get("child-b")!.ordinal, "1.2");
  assert.equal(byId.get("root-b")!.ordinal, "2");
});

test("mapWorkspaceEstimateToPositions produces stable worksheet and item positions", () => {
  const worksheets = [
    { id: "ws-b", revisionId: "rev-1", name: "Equipment", order: 2, version: 7 },
    { id: "ws-a", revisionId: "rev-1", name: "Labour", order: 1, updatedAt: "2026-04-30T12:00:00.000Z" },
  ];
  const worksheetItems = [
    {
      id: "item-b",
      worksheetId: "ws-a",
      category: "Labour",
      entityType: "RateSchedule",
      entityName: "Foreperson",
      description: "Supervision",
      quantity: 2,
      uom: "HR",
      cost: 125,
      price: 300,
      lineOrder: 2,
      phaseId: "phase-1",
      itemId: "catalog-b",
      sourceAssemblyId: "assembly-1",
      assemblyInstanceId: "assembly-instance-1",
      sourceNotes: "From takeoff",
    },
    {
      id: "item-a",
      worksheetId: "ws-a",
      category: "Labour",
      entityType: "RateSchedule",
      entityName: "Journeyperson",
      quantity: 3,
      uom: "HR",
      cost: 100,
      price: 375,
      lineOrder: 1,
    },
  ];

  const first = mapWorkspaceEstimateToPositions({ worksheets, worksheetItems });
  const second = mapWorkspaceEstimateToPositions({
    worksheets: [...worksheets].reverse(),
    worksheetItems: [...worksheetItems].reverse(),
  });

  assert.deepEqual(second, first);
  assert.deepEqual(first.map((position) => position.id), [
    estimatePositionIdForWorksheet("ws-a"),
    estimatePositionIdForWorksheetItem("item-a"),
    estimatePositionIdForWorksheetItem("item-b"),
    estimatePositionIdForWorksheet("ws-b"),
  ]);

  const itemB = first.find((position) => position.id === estimatePositionIdForWorksheetItem("item-b"))!;
  assert.equal(itemB.parentId, estimatePositionIdForWorksheet("ws-a"));
  assert.equal(itemB.ordinal, "1.2");
  assert.equal(itemB.totalCost, 250);
  assert.deepEqual(itemB.classification, {
    category: "Labour",
    entityType: "RateSchedule",
    entityName: "Foreperson",
    phaseId: "phase-1",
    catalogItemId: "catalog-b",
    assemblyId: "assembly-1",
    assemblyInstanceId: "assembly-instance-1",
  });
  assert.equal(itemB.versionToken.source.kind, "worksheet_item");
});
