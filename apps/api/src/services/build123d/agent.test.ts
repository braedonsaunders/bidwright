import assert from "node:assert/strict";
import test from "node:test";
import type { ChatRequest, LLMAdapter } from "@bidwright/agent";
import type { CadProgram } from "@bidwright/domain";
import { designWithCadAdapter } from "./agent.js";

const program: CadProgram = {
	version: 1,
	engine: "build123d",
	name: "Hopper",
	units: "mm",
	parameters: {},
	source: "parts={}",
	imports: {},
	removedParts: [],
	assumptions: [],
};
const build = {
	program,
	parts: [],
	sources: {},
	libraryVersion: "0.13.0",
	kernelVersion: "8.0.1",
	preview: "cG5n",
};
function adapter(
	sequence: Array<{ name: string; input: unknown }[]>,
	requests: ChatRequest[],
): LLMAdapter {
	return {
		id: "mock",
		name: "Mock",
		supportsTools: true,
		supportsVision: true,
		maxContextTokens: 128000,
		async chat(request) {
			const { onDelta: _, signal: __, ...snapshot } = request;
			requests.push(structuredClone(snapshot));
			const actions = sequence.shift();
			assert.ok(actions, "unexpected extra agent turn");
			return {
				content: actions.map((a, i) => ({
					type: "tool_use" as const,
					toolUseId: `call-${requests.length}-${i}`,
					toolName: a.name,
					toolInput: a.input,
				})),
				stopReason: "tool_use",
				usage: { inputTokens: 1, outputTokens: 1 },
			};
		},
	};
}
test("CAD agent discovers APIs, repairs a failed build and sees measured geometry/render before accepting", async () => {
	const requests: ChatRequest[] = [];
	const mock = adapter(
		[
			[{ name: "cad_docs", input: { query: "loft offset" } }],
			[{ name: "cad_execute", input: { program } }],
			[
				{
					name: "cad_execute",
					input: { program: { ...program, source: "repaired source" } },
				},
			],
			[
				{
					name: "finish_design",
					input: { message: "Created the tapered hopper.", apply: true },
				},
			],
		],
		requests,
	);
	let executions = 0;
	const result = await designWithCadAdapter(
		mock,
		"model",
		{ prompt: "Create a tapered hopper" },
		{
			docs: async () => ({ symbols: ["loft", "offset"] }),
			execute: async (p) => {
				if (++executions === 1)
					throw new Error("Wall offset produced invalid geometry");
				return { ...build, program: p };
			},
		},
	);
	assert.equal(executions, 2);
	assert.equal(result.build?.program.source, "repaired source");
	assert.match(
		JSON.stringify(requests[2].messages),
		/Wall offset produced invalid/,
	);
	assert.match(JSON.stringify(requests[3].messages), /imageData/);
	assert.match(JSON.stringify(requests[3].messages), /kernelVersion/);
});
test("a model cannot be accepted in the same turn as its execution", async () => {
	const requests: ChatRequest[] = [];
	const mock = adapter(
		[
			[
				{ name: "cad_execute", input: { program } },
				{ name: "finish_design", input: { message: "Unchecked", apply: true } },
			],
			[{ name: "finish_design", input: { message: "Inspected", apply: true } }],
		],
		requests,
	);
	const result = await designWithCadAdapter(
		mock,
		"model",
		{ prompt: "Create model" },
		{ execute: async () => build },
	);
	assert.equal(requests.length, 2);
	assert.equal(result.message, "Inspected");
});
test("clarification and parameter rebuild do not invent geometry or need model calls", async () => {
	const requests: ChatRequest[] = [];
	const mock = adapter(
		[
			[
				{
					name: "finish_design",
					input: { message: "What wall thickness?", apply: false },
				},
			],
		],
		requests,
	);
	assert.equal(
		(await designWithCadAdapter(mock, "model", { prompt: "Hopper" })).build,
		null,
	);
	const changed = { ...program, parameters: { wall: 4 } };
	const result = await designWithCadAdapter(
		mock,
		"model",
		{ rebuild: true, program: changed },
		{ execute: async (p) => ({ ...build, program: p }) },
	);
	assert.equal(requests.length, 1);
	assert.equal(result.build?.program.parameters.wall, 4);
});
test("stop signals prevent further CAD execution", async () => {
	const controller = new AbortController();
	controller.abort();
	await assert.rejects(
		designWithCadAdapter(
			adapter([], []),
			"model",
			{ prompt: "Create model" },
			{ signal: controller.signal },
		),
		/abort/i,
	);
});
