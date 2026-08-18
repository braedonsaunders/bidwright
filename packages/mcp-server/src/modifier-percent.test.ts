import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./tools/quote-tools.ts", import.meta.url), "utf8");

/** The conversion the modifier tools apply, mirrored from quote-tools.ts. */
function percentToRatio(percent: number | null | undefined): number | null | undefined {
  if (percent === null || percent === undefined) return percent;
  const value = Number(percent);
  return Number.isFinite(value) ? value / 100 : percent;
}

test("a percent from the agent becomes the ratio the engine prices", () => {
  // The incident: the agent asked for a 5% contingency, the value was stored
  // as the ratio 5, and a $100k job was quoted 500% higher.
  assert.equal(percentToRatio(5), 0.05);
  assert.equal(percentToRatio(10), 0.1);
  assert.equal(percentToRatio(100), 1);
  assert.equal(percentToRatio(-15), -0.15);
});

test("a cleared or absent percentage is passed through untouched", () => {
  assert.equal(percentToRatio(null), null);
  assert.equal(percentToRatio(undefined), undefined);
});

test("the conversion is applied on both the create and update paths", () => {
  const createBody = source.slice(source.indexOf('"createModifier"'), source.indexOf('"updateModifier"'));
  assert.match(createBody, /percentToRatio\(input\.percentage\)/, "createModifier converts before POST");

  const updateBody = source.slice(source.indexOf('"updateModifier"'), source.indexOf('"deleteModifier"'));
  assert.match(updateBody, /percentToRatio\(patch\.percentage\)/, "updateModifier converts before PATCH");
});

test("both tools tell the agent the field is a percent, not a fraction", () => {
  // The old wording promised percent but nothing converted, which is what let
  // the mismatch through silently.
  const modifierSection = source.slice(source.indexOf('"createModifier"'), source.indexOf('"deleteModifier"'));
  const descriptions = [...modifierSection.matchAll(/percentage:[^\n]*describe\("([^"]+)"\)/g)].map((m) => m[1]);
  assert.equal(descriptions.length, 2, "create and update both document the field");
  for (const description of descriptions) {
    assert.match(description, /PERCENT, not a fraction/, `ambiguous wording: ${description}`);
  }
});
