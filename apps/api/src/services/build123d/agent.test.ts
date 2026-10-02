import assert from "node:assert/strict";
import test from "node:test";
import type { ChatRequest, LLMAdapter } from "@bidwright/agent";
import { OpenRouterAdapter, ResponseLimitError } from "@bidwright/agent";
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
test("CAD retries exhausted reasoning without executing partial output and requests an early preview", async () => {
	const requests: ChatRequest[] = [];
	const mock = adapter(
		[
			[{ name: "cad_execute", input: { program } }],
			[{ name: "finish_design", input: { message: "Checked", apply: true } }],
		],
		requests,
	);
	const original = mock.chat;
	let count = 0;
	mock.id = "openrouter";
	mock.chat = async (request) => {
		if (++count === 1) {
			assert.equal(request.maxTokens, 65536);
			assert.equal(request.reasoningEffort, "low");
			assert.match(request.systemPrompt, /FIRST PREVIEW PHASE/);
			request.onDelta?.({ type: "activity", text: "" });
			throw new ResponseLimitError();
		}
		assert.equal(request.maxTokens, 131072);
		return original.call(mock, request);
	};
	const progress: string[] = [];
	let builds = 0;
	const result = await designWithCadAdapter(
		mock,
		"moonshotai/kimi-k3",
		{ prompt: "Dump trailer" },
		{
			progress: (s) => progress.push(s),
			execute: async () => {
				builds++;
				return build;
			},
		},
	);
	assert.equal(builds, 1);
	assert.equal(result.message, "Checked");
	assert.match(progress.join(" "), /planning.*larger response budget/);
	assert.match(
		JSON.stringify(requests[0].messages),
		/No partial code was executed/,
	);
	assert.doesNotMatch(requests[1].systemPrompt, /FIRST PREVIEW PHASE/);
});
test("response-limit recovery is bounded and cancellation cannot trigger a retry", async () => {
	const mock = adapter([], []);
	let count = 0;
	mock.chat = async () => {
		count++;
		throw new ResponseLimitError();
	};
	await assert.rejects(
		designWithCadAdapter(mock, "model", { prompt: "Trailer" }),
		ResponseLimitError,
	);
	assert.equal(count, 4);
	const controller = new AbortController();
	mock.chat = async () => {
		controller.abort(new Error("User stopped"));
		throw new ResponseLimitError();
	};
	await assert.rejects(
		designWithCadAdapter(
			mock,
			"model",
			{ prompt: "Trailer" },
			{ signal: controller.signal },
		),
		/User stopped/,
	);
});
test("real OpenRouter SDK sends the CAD reasoning budget and retains private tool context", async () => {
	const original = globalThis.fetch;
	const requests: any[] = [];
	globalThis.fetch = async (_url, init) => {
		requests.push(JSON.parse(String(init?.body)));
		const first = requests.length === 1;
		const chunks = first
			? [
					{
						reasoning: "private planning",
						reasoning_details: [
							{ index: 0, type: "reasoning.text", text: "private planning" },
						],
					},
					{
						tool_calls: [
							{
								index: 0,
								id: "build",
								type: "function",
								function: {
									name: "cad_execute",
									arguments: JSON.stringify({ program }),
								},
							},
						],
					},
				]
			: [
					{
						tool_calls: [
							{
								index: 0,
								id: "finish",
								type: "function",
								function: {
									name: "finish_design",
									arguments: JSON.stringify({
										message: "Checked",
										apply: true,
									}),
								},
							},
						],
					},
				];
		return new Response(
			chunks
				.map(
					(delta) =>
						`data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`,
				)
				.join("") +
				`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] })}\n\ndata: [DONE]\n\n`,
			{ headers: { "content-type": "text/event-stream" } },
		);
	};
	const activity: unknown[] = [];
	try {
		await designWithCadAdapter(
			new OpenRouterAdapter("test-key"),
			"moonshotai/kimi-k3",
			{ prompt: "Trailer" },
			{
				execute: async () => build,
				activity: (a) => activity.push(a),
			},
		);
		assert.equal(requests[0].stream, true);
		assert.equal(requests[0].max_tokens, 65536);
		assert.deepEqual(requests[0].reasoning, { effort: "low" });
		const assistant = requests[1].messages.find(
			(m: any) => m.role === "assistant",
		);
		assert.equal(assistant.reasoning_details[0].text, "private planning");
		assert.doesNotMatch(JSON.stringify(activity), /private planning/);
	} finally {
		globalThis.fetch = original;
	}
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
