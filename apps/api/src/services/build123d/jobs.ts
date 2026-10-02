import { randomUUID } from "node:crypto";
import type { TenantAiConfig } from "@bidwright/agent";
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
	};
	jobs.set(job.id, job);
	const timeout = setTimeout(
		() =>
			job.controller.abort(
				new Error(
					"Model design exceeded ten minutes; split the request into smaller steps",
				),
			),
		10 * 60_000,
	);
	timeout.unref();
	void generate(config, input, {
		signal: job.controller.signal,
		progress: (text) => {
			job.progress = text;
		},
	})
		.then((result) => {
			if (job.controller.signal.aborted) return;
			job.result = result;
			job.status = "completed";
			job.progress = "Ready to apply";
		})
		.catch((error) => {
			if (job.status === "cancelled") return;
			job.status = "failed";
			job.error = error instanceof Error ? error.message : String(error);
			job.progress = "Design failed";
		})
		.finally(() => {
			job.finishedAt = Date.now();
			clearTimeout(timeout);
			const expiry = setTimeout(() => jobs.delete(job.id), 10 * 60_000);
			expiry.unref();
		});
	return { id: job.id, status: job.status, progress: job.progress };
}

export function getCadJob(scope: Scope, id: string) {
	const job = jobs.get(id);
	if (!job || !sameScope(scope, job.scope)) return null;
	return {
		id: job.id,
		status: job.status,
		progress: job.progress,
		result: job.result,
		error: job.error,
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
