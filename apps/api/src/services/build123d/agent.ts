import type {
	ChatMessage,
	LLMAdapter,
	TenantAiConfig,
	ToolSpec,
} from "@bidwright/agent";
import { ResponseLimitError } from "@bidwright/agent";
import {
	type CadBuild,
	type CadProgram,
	type CadSource,
	type CadPart,
	validateCadProgram,
} from "@bidwright/domain";
import { executeCadProgram, getCadApiDocs } from "./runtime.js";
import { validateCadEditScope } from "./edit-scope.js";

export interface CadDesignInput {
	prompt?: string;
	program?: CadProgram | null;
	context?: unknown;
	sources?: Record<string, CadSource>;
	geometry?: Record<string, string>;
	history?: Array<{ role: "user" | "assistant"; content: string }>;
	feedback?: string;
	/** Parameter/source editor rebuild, without asking an LLM. */
	rebuild?: boolean;
}
export interface CadDesignResult {
	message: string;
	build: CadBuild | null;
}

export const CAD_PROGRAM_INSTRUCTIONS = `You are Bidwright's fabrication CAD designer using build123d 0.13.0 / OpenCascade 8.0.1.
You have the FULL upstream Python API, not a fixed list of operations. Use cad_docs to discover public classes/functions, signatures and methods. Use cad_execute to build, measure and render a complete candidate, inspect feedback, and repair it. Use finish_design only after a successful execution and review of the measured bounds/volumes and the rendered views. Never claim a model was built without execution. Ask a brief clarification when critical dimensions are missing.

Program format: {version:1,engine:"build123d",name,units:"mm"|"in",parameters:{numeric_dimension:value},source:"Python source",imports:{snapshot_key:live_node_id},removedParts:[],assumptions:[]}.
The runner injects parameters (in program.units), unit_scale (25.4 for inches, 1 for mm), and existing(snapshot_key). build123d itself uses MILLIMETRES. Multiply input lengths by unit_scale; leave counts and angles unscaled. Never overwrite parameters with hardcoded defaults. Use from build123d import * and any Python standard-library helpers. No network, package installation, external processes, host files, or interactive GUI. Runtime documentation and introspection cover the entire installed CAD API, including selectors, curves, lofts, sweeps, shell/thickness operations, assemblies and custom reusable functions.

Users watch the design being built. Give a short public progress explanation before tool calls. For a nontrivial NEW design, execute a useful main body early, then refine the complete program with details/subassemblies in subsequent cad_execute calls. For existing designs always retain unaffected parts, even in early candidates. Initialize parts={} early and publish completed shapes as you construct them. Call preview(parts, "short description") at meaningful milestones (base body, drilled holes, assembled members); it streams actual valid CAD geometry to the user's viewport without committing it. Never sleep or invent geometry/progress to simulate work. Every execute still receives the complete runnable source; finish only when the requested model is complete and checked.

Publish parts as a Python dictionary of stable IDs to Shape/BuildPart objects, or {"shape":shape,"name":human_name,"nodeId":existing_target_node_id,"material":material_spec}. Every physical fabrication member stays a named separate part; do not fuse a welded assembly into one solid. Use functions, loops and reusable subassemblies for complexity, with deterministic part IDs. Up to 1,000 parts, 150,000 source characters; CPU/memory are bounded, so avoid needlessly fine tessellation or fused hardware.

Careful editing is mandatory. The current program is authoritative editable source. Revise the relevant function/parameter/portion and retain unaffected parts and their IDs/placements. Do not replace the whole design with an approximation. Preserve each part's nodeId. Omitting an existing program part requires its ID in removedParts and an explicit user deletion request. Never delete unrelated native/imported geometry. If any live nodes are selected, only those existing nodes may change; leave other geometry untouched. Ask the user to clear selection if the requested edit spans the whole assembly.
To edit imported or manually edited geometry: declare a NEW immutable snapshot key in imports pointing to the exact live node ID, call existing(key), then perform operations on that exact Shape; put the same node ID on the output part. Do not reconstruct it from its bounding box. The availableGeometryNodeIds list tells you what current geometry is accessible. Existing snapshot keys always keep their original geometry and node ID, making repeat edits/parameter changes reproducible. A new key explicitly rebases on current geometry. If the target was manually modified, base changed output on a NEW snapshot of that node; otherwise you would discard manual changes. Manually deleted parts must not be recreated. Unchanged geometry is preserved by the editor.

Check dimensions, hole placements, material thickness, assembly separations and fabrication intent. All measurement feedback is in mm/mm³. Curved geometry must be actual CAD curves/surfaces, not decorative tessellations. State meaningful assumptions and describe exactly which parts changed. STEP export supplies geometry to SolidWorks; do not claim to create native SolidWorks features.`;

const programSchema = {
	type: "object",
	required: [
		"version",
		"engine",
		"name",
		"units",
		"parameters",
		"source",
		"imports",
		"removedParts",
		"assumptions",
	],
	properties: {
		version: { type: "integer", enum: [1] },
		engine: { type: "string", enum: ["build123d"] },
		name: { type: "string" },
		units: { type: "string", enum: ["mm", "in"] },
		parameters: { type: "object", additionalProperties: { type: "number" } },
		source: { type: "string" },
		imports: { type: "object", additionalProperties: { type: "string" } },
		removedParts: { type: "array", items: { type: "string" } },
		assumptions: { type: "array", items: { type: "string" } },
	},
};
const tools: ToolSpec[] = [
	{
		name: "cad_docs",
		description:
			"Discover the full installed build123d API. Empty query lists symbols; names such as sweep, Solid.make_loft, Shape.faces return signatures/docs and class members. Search keywords when uncertain.",
		inputSchema: {
			type: "object",
			properties: { query: { type: "string" } },
			required: ["query"],
		},
	},
	{
		name: "cad_execute",
		description:
			"Execute a complete editable CAD program in the isolated worker. Returns validity, part identities, bounds, volumes, and rendered views. Fix reported problems and execute again before accepting.",
		inputSchema: {
			type: "object",
			properties: { program: programSchema },
			required: ["program"],
		},
	},
	{
		name: "finish_design",
		description:
			"Accept the LAST successful, inspected candidate with apply:true; use apply:false to ask a clarification without changing geometry.",
		inputSchema: {
			type: "object",
			properties: { message: { type: "string" }, apply: { type: "boolean" } },
			required: ["message", "apply"],
		},
	},
];

export async function designWithCadAdapter(
	adapter: LLMAdapter,
	model: string,
	input: CadDesignInput,
	options: {
		signal?: AbortSignal;
		progress?: (status: string) => void;
		activity?: (value: { text?: string; draftCharacters?: number }) => void;
		preview?: (parts: CadPart[] | null, label?: string) => void;
		execute?: typeof executeCadProgram;
		docs?: typeof getCadApiDocs;
	} = {},
): Promise<CadDesignResult> {
	const execute = options.execute ?? executeCadProgram;
	const docs = options.docs ?? getCadApiDocs;
	const check = () => options.signal?.throwIfAborted();
	check();
	if (input.rebuild) {
		if (!input.program) throw new Error("No saved CAD source to rebuild");
		options.progress?.("Building updated dimensions…");
		const { preview: _, ...build } = await execute(
			input.program,
			input,
			options.signal,
			(parts, label) => options.preview?.(parts, label),
		);
		validateCadEditScope(build, input.context, input.sources, false);
		return {
			message: "Updated the model from its editable CAD source.",
			build,
		};
	}
	if (!adapter.supportsTools)
		throw new Error(
			"This CAD designer requires an AI provider with tool calling support.",
		);
	const messages: ChatMessage[] = [
		...(input.history ?? []).slice(-16),
		{
			role: "user",
			content: JSON.stringify({
				request: input.prompt,
				currentProgram: input.program ?? null,
				liveModel: input.context ?? null,
				availableGeometryNodeIds: Object.keys(input.geometry ?? {}),
				immutableInputs: Object.fromEntries(
					Object.entries(input.sources ?? {}).map(([k, s]) => [k, s.nodeId]),
				),
				executionFeedback: input.feedback ?? null,
			}),
		},
	];
	let candidate: CadBuild | null = null;
	let failedBuild = false;
	let executions = 0;
	let responseRecoveries = 0;
	let responseBudget = adapter.id === "openrouter" ? 65536 : 16000;
	let hasPreview = false;
	for (let turn = 0; turn < 48; turn++) {
		check();
		options.progress?.(
			failedBuild
				? "Correcting the CAD program…"
				: candidate
					? "Inspecting geometry and dimensions…"
					: "Designing your model…",
		);
		let announcement = "";
		let draftCharacters = 0;
		options.activity?.({ text: "", draftCharacters: 0 });
		let planning = false;
		let response;
		try {
			response = await adapter.chat({
				model,
				signal: options.signal,
				timeoutMs: 2 * 60 * 60_000,
				systemPrompt:
					CAD_PROGRAM_INSTRUCTIONS +
					(!input.program && !hasPreview
						? "\nFIRST PREVIEW PHASE: Do not plan or code the entire complex assembly in one response. Start with a compact, valid main body/chassis program (roughly 30–100 lines) and cad_execute it now. Use sensible stated assumptions for unspecified dimensions. Build the remaining requested details in later turns. This is an early preview, not the finished design."
						: "\nContinue the requested design from the last successful source and measurements. Preserve unaffected parts. Complete all requested components before finish_design; an early preview is not a finished design."),
				messages,
				tools,
				maxTokens: responseBudget,
				reasoningEffort: "low",
				temperature: 0.2,
				onDelta: (delta) => {
					check();
					if (delta.type === "activity") {
						if (!planning && !draftCharacters && !announcement) {
							planning = true;
							options.progress?.("AI is planning the next build step…");
						}
					} else if (delta.type === "text") {
						announcement = (announcement + delta.text).slice(-4000);
						options.activity?.({ text: announcement });
					} else if (delta.toolName === "cad_execute") {
						if (!draftCharacters)
							options.progress?.("Writing the next CAD build step…");
						draftCharacters += delta.text.length;
						options.activity?.({ draftCharacters });
					}
				},
			});
		} catch (error) {
			check();
			if (!(error instanceof ResponseLimitError) || ++responseRecoveries > 3)
				throw error;
			responseBudget = Math.min(
				responseBudget * 2,
				adapter.id === "openrouter" ? 131072 : 64000,
			);
			options.progress?.(
				"Continuing the design with a larger response budget…",
			);
			messages.push({
				role: "user",
				content:
					"Your previous response exhausted its token budget before finishing. No partial code was executed. Restart this step with a compact complete runnable program, use reusable functions/loops, and execute an early useful preview before adding more detail. Continue until the original request is complete; do not ask the user to split the task.",
			});
			continue;
		}
		check();
		messages.push({
			role: "assistant",
			content: response.content,
			providerState: response.providerState,
		});
		const calls = response.content.filter((b) => b.type === "tool_use");
		if (!calls.length) {
			const message = response.content
				.filter((b) => b.type === "text")
				.map((b) => b.text ?? "")
				.join("\n")
				.trim();
			if (message && (!failedBuild || candidate))
				return { message: message.slice(0, 12000), build: candidate };
			messages.push({
				role: "user",
				content:
					"Use the CAD tools to repair and execute the model. Use finish_design to complete, or ask a clear clarification with apply:false.",
			});
			continue;
		}
		let finish: CadDesignResult | undefined;
		const images: string[] = [];
		for (const call of calls) {
			check();
			let result: unknown;
			try {
				const args = call.toolInput as Record<string, unknown>;
				if (!args || typeof args !== "object")
					throw new Error("Invalid CAD tool arguments");
				if (call.toolName === "cad_docs") {
					options.progress?.("Looking up the CAD library…");
					result = await docs(
						typeof args.query === "string" ? args.query : "",
						options.signal,
					);
				} else if (call.toolName === "cad_execute") {
					options.preview?.(null);
					candidate = null;
					failedBuild = true;
					if (++executions > 20)
						throw new Error(
							"Build attempt limit reached; clarify or simplify the requested design",
						);
					validateCadProgram(args.program);
					options.progress?.("Building and checking exact geometry…");
					const { preview, ...build } = await execute(
						args.program,
						input,
						options.signal,
						(parts, label) => options.preview?.(parts, label),
					);
					validateCadEditScope(build, input.context, input.sources);
					check();
					candidate = build;
					hasPreview = true;
					options.preview?.(build.parts, "Inspecting completed geometry");
					failedBuild = false;
					result = {
						ok: true,
						libraryVersion: build.libraryVersion,
						kernelVersion: build.kernelVersion,
						parts: build.parts.map(({ brep: _, fingerprint: __, ...p }) => p),
						instruction:
							"Inspect the measured dimensions and the rendered views against the request. Repair errors before finish_design.",
					};
					if (adapter.supportsVision && preview) images.push(preview);
				} else if (call.toolName === "finish_design") {
					if (
						typeof args.message !== "string" ||
						!args.message.trim() ||
						args.message.length > 12000 ||
						typeof args.apply !== "boolean"
					)
						throw new Error("Supply a brief message and apply boolean");
					if (args.apply && !candidate)
						throw new Error(
							"Execute a valid candidate before accepting the design",
						);
					finish = {
						message: args.message,
						build: args.apply ? candidate : null,
					};
					result = { ok: true };
				} else throw new Error("Unknown CAD tool");
			} catch (error) {
				check();
				if (call.toolName === "cad_execute") options.preview?.(null);
				result = {
					ok: false,
					error: error instanceof Error ? error.message : String(error),
				};
			}
			messages.push({
				role: "tool",
				toolCallId: call.toolUseId,
				content: JSON.stringify(result),
			});
		}
		// Finish must happen in a subsequent turn, after the execution's actual
		// measurements/render are visible to the agent, not alongside its build.
		if (finish && !calls.some((c) => c.toolName === "cad_execute"))
			return finish;
		if (images.length)
			messages.push({
				role: "user",
				content: [
					{
						type: "text",
						text: "Actual generated geometry: isometric, front and top views. Check it before accepting.",
					},
					{
						type: "image",
						imageData: images.at(-1),
						imageMimeType: "image/png",
					},
				],
			});
	}
	throw new Error(
		"The CAD agent reached its design limit. No geometry was changed; refine the request and retry.",
	);
}

export async function generateCadDesign(
	config: TenantAiConfig | null,
	input: CadDesignInput,
	options: Parameters<typeof designWithCadAdapter>[3] = {},
) {
	if (input.rebuild) {
		if (!input.program) throw new Error("No saved CAD source to rebuild");
		options.progress?.("Building updated dimensions…");
		const { preview: _, ...build } = await (
			options.execute ?? executeCadProgram
		)(input.program, input, options.signal, (parts, label) =>
			options.preview?.(parts, label),
		);
		validateCadEditScope(build, input.context, input.sources, false);
		return {
			message: "Updated the model from its editable CAD source.",
			build,
		};
	}
	if (!config) throw new Error("Configure an AI provider to design a model");
	const { createLLMAdapter } = await import("@bidwright/agent");
	return designWithCadAdapter(
		createLLMAdapter(config),
		config.model,
		input,
		options,
	);
}
