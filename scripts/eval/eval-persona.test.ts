import assert from "node:assert/strict";
import test from "node:test";
import { selectEvalPersona } from "./eval-persona.js";
import { resolveEstimatorPersonaForPrompt } from "../../apps/api/src/services/estimator-persona-prompt.js";
import { buildCompactClaudeMdContent } from "../../apps/api/src/services/claude-md-generator.js";

test("eval persona selection matches the drawer, with explicit overrides", () => {
  const personas = [
    { id: "disabled", enabled: false, isDefault: true },
    { id: "mechanical", enabled: true, isDefault: true },
    { id: "electrical", enabled: true, isDefault: false },
  ];
  assert.equal(selectEvalPersona(personas)?.id, "mechanical");
  assert.equal(selectEvalPersona(personas, "electrical")?.id, "electrical");
  assert.equal(selectEvalPersona(personas, "none"), null);
  assert.equal(selectEvalPersona([]), null);
  assert.throws(() => selectEvalPersona(personas, "disabled"), /disabled/);
  assert.throws(() => selectEvalPersona(personas, "missing"), /missing/);
});

test("shared production resolver renders the same persona guidance for API-backed evals", async () => {
  const persona = { name: "Mechanical", trade: "Piping", systemPrompt: "Use the configured mechanical playbook.",
    knowledgeBookIds: '["book"]', knowledgeDocumentIds: ["page"], datasetTags: '["pipe"]',
    packageBuckets: ["Shop", "Field"], commercialGuidance: { packaging: { defaultExecutionMode: "self-perform" } },
    productivityGuidance: { roleCoverage: { roles: ["Foreman"] } }, reviewFocusAreas: ["Pipe lengths"] };
  const store = { getEstimatorPersona: async () => persona, getKnowledgeBook: async () => ({ name: "Piping manual" }),
    getKnowledgeDocument: async () => ({ title: "Labour reference" }) };
  const resolved = await resolveEstimatorPersonaForPrompt(store, "mechanical");
  assert.equal(await resolveEstimatorPersonaForPrompt(store, undefined), null);
  assert.deepEqual(resolved?.knowledgeBookNames, ["Piping manual"]);
  assert.deepEqual(resolved?.knowledgeDocumentNames, ["Labour reference"]);
  const brief = buildCompactClaudeMdContent({ projectDir: "/tmp", projectName: "Test", clientName: "", location: "", scope: "", quoteNumber: "", dataRoot: "/tmp", documents: [], persona: resolved });
  assert.match(brief, /Estimating Playbook: Mechanical/);
  for (const expected of [persona.systemPrompt, "Piping manual", "Labour reference", "self-perform", "Pipe lengths"]) assert.ok(brief.includes(expected));
});
