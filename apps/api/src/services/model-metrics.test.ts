import test from "node:test";
import assert from "node:assert/strict";
import { aggregatePersistedElements } from "./model-metrics.js";

test("pipe totals group flat APS size keys and exclude containers, duplicates and other scope", () => {
  const make = (id: string, value: number, properties: any = {}) => ({ id, elementClass: "Pipe", properties: { "AutoCAD.Size": '3"', "AutoCAD.Status": "New", ...properties }, quantities: [{ quantityType: "Length", value, unit: "ft" }] });
  const result = aggregatePersistedElements([make("pipe", 10), make("container", 100, { estimateRelevant: false }), make("existing", 20, { "AutoCAD.Status": "Existing" }), { ...make("fitting", 2), elementClass: "Elbow" }], {
    groupBy: "property", property: "AutoCAD.Size", elementClass: "Pipe", propertyFilters: { "AutoCAD.Status": "New" },
  });
  assert.equal(result.groups[0].key, '3"');
  assert.equal(result.groups[0].elementCount, 1);
  assert.equal(result.groups[0].quantities[0].value, 10);
});
