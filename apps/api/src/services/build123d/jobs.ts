import { randomUUID } from "node:crypto";
import type { TenantAiConfig } from "@bidwright/agent";
import type { CadLiveUpdate, CadPart } from "@bidwright/domain";
import {
	type CadDesignInput,
	type CadDesignResult,
	generateCadDesign,
} from "./agent.js";

type Scope = {
	userId: string;
	organizationId: string | null;
	projectId: string;
};
interface Job {
	id: string;
	scope: Scope;
	status: "running" | "completed" | "failed" | "cancelled";
	progress: string;
	createdAt: number;
	finishedAt?: number;
	result?: CadDesignResult;
	error?: string;
	controller: AbortController;
	live: Omit<CadLiveUpdate, "preview">;
	preview: CadPart[] | null;
}
const jobs = new Map<string, Job>();
const sameScope = (a: Scope, b: Scope) =>
	a.userId === b.userId &&
	a.organizationId === b.organizationId &&
	a.projectId === b.projectId;

export function startCadJob(
	scope: Scope,
	config: TenantAiConfig | null,
	input: CadDesignInput,
	generate: typeof generateCadDesign = generateCadDesign,
	onEvent: (event: Record<string, unknown>) => void = (event) =>
		console.info(JSON.stringify(event)),
) {
	const now = Date.now();
	for (const [id, job] of jobs)
		if (job.status !== "running" && now - (job.finishedAt ?? now) > 10 * 60_000)
			jobs.delete(id);
	if (
		[...jobs.values()].some(
			(j) =>
				j.status === "running" &&
				j.scope.userId === scope.userId &&
				j.scope.organizationId === scope.organizationId,
		)
	)
		throw Object.assign(
			new Error(
				"A model design is already running. Stop it before starting another.",
			),
			{ statusCode: 409 },
		);
	if ([...jobs.values()].filter((j) => j.status === "running").length >= 4)
		throw Object.assign(
			new Error("The CAD designer is busy. Please try again shortly."),
			{ statusCode: 429 },
		);
	// Bound retained geometry and input contexts in the API process.
	if (jobs.size >= 8) {
		const finished = [...jobs.values()].find(
			(j) => j.status !== "running" && now - (j.finishedAt ?? now) > 60_000,
		);
		if (!finished)
			throw Object.assign(
				new Error("The CAD designer is busy. Please try again shortly."),
				{ statusCode: 429 },
			);
		jobs.delete(finished.id);
	}
	const job: Job = {
		id: randomUUID(),
		scope,
		status: "running",
		progress: "Starting CAD design…",
		createdAt: now,
		controller: new AbortController(),
		live: {
			activity: ["Starting CAD design…"],
			text: "",
			draftCharacters: 0,
			previewRevision: 0,
			previewCount: 0,
		},
		preview: null,
	};
	jobs.set(job.id, job);
	const log = (event: string, extra: Record<string, unknown> = {}) =>
		onEvent({
			event,
			runId: job.id,
			projectId: scope.projectId,
			userId: scope.userId,
			elapsedMs: Date.now() - job.createdAt,
			phase: job.progress,
			...extra,
		});
	log("cad.design.started", {
		provider: config?.provider,
		model: config?.model,
	});
	let lastDraftLog = 0;
	void generate(config, input, {
		signal: job.controller.signal,
		progress: (text) => {
			if (job.status !== "running" || job.controller.signal.aborted) return;
			job.progress = text;
			if (job.live.activity.at(-1) !== text) {
				job.live.activity = [...job.live.activity, text].slice(-8);
				log("cad.design.phase");
			}
		},
		activity: (value) => {
			if (job.status === "running" && !job.controller.signal.aborted) {
				Object.assign(job.live, value);
				if (
					(value.text || value.draftCharacters) &&
					Date.now() - lastDraftLog > 15000
				) {
					lastDraftLog = Date.now();
					log("cad.design.drafting", { characters: job.live.draftCharacters });
				}
			}
		},
		preview: (parts, label) => {
			if (job.status !== "running" || job.controller.signal.aborted) return;
			job.preview = parts;
			job.live.previewRevision++;
			job.live.previewCount = parts?.length ?? 0;
			if (parts) log("cad.design.preview", { parts: parts.length });
			if (label) {
				job.progress = label;
				job.live.activity = [...job.live.activity, label].slice(-8);
			}
		},
	})
		.then((result) => {
			if (job.controller.signal.aborted) return;
			job.preview = null;
			job.live.previewRevision++;
			job.live.previewCount = 0;
			job.result = result;
			job.status = "completed";
			job.progress = "Ready to apply";
			log("cad.design.completed", { parts: result.build?.parts.length ?? 0 });
		})
		.catch((error) => {
			if (job.status === "cancelled") return;
			job.preview = null;
			job.live.previewRevision++;
			job.live.previewCount = 0;
			job.status = "failed";
			const failure = job.controller.signal.aborted
				? job.controller.signal.reason
				: error;
			job.error = failure instanceof Error ? failure.message : String(failure);
			log("cad.design.failed", { error: job.error });
			job.progress = "Design failed";
		})
		.finally(() => {
			job.finishedAt = Date.now();
			const expiry = setTimeout(() => jobs.delete(job.id), 10 * 60_000);
			expiry.unref();
		});
	return { id: job.id, status: job.status, progress: job.progress };
}

export function getCadJob(scope: Scope, id: string, previewAfter = -1) {
	const job = jobs.get(id);
	if (!job || !sameScope(scope, job.scope)) return null;
	return {
		id: job.id,
		status: job.status,
		progress: job.progress,
		result: job.result,
		error: job.error,
		live: {
			...job.live,
			...(!Number.isFinite(previewAfter) ||
			previewAfter < job.live.previewRevision
				? { preview: job.preview }
				: {}),
		},
	};
}
export function cancelCadJob(scope: Scope, id: string) {
	const job = jobs.get(id);
	if (!job || !sameScope(scope, job.scope)) return false;
	if (job.status === "running") {
		job.status = "cancelled";
		job.progress = "Stopped";
		job.controller.abort(new Error("Model design stopped"));
	}
	jobs.delete(id);
	return true;
}
