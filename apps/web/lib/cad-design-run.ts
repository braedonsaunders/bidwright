import type {
	CadBuild,
	CadLiveUpdate,
	CadProgram,
	CadSource,
} from "@bidwright/domain";
import { apiRequest } from "./api/client";

export interface CadDesignRunInput {
	prompt?: string;
	program?: CadProgram | null;
	context?: unknown;
	sources?: Record<string, CadSource>;
	geometry?: Record<string, string>;
	history?: Array<{ role: "user" | "assistant"; content: string }>;
	feedback?: string;
	rebuild?: boolean;
}

export async function runCadDesign(
	projectId: string,
	input: CadDesignRunInput,
	signal: AbortSignal,
	progress: (status: string) => void,
	onLive?: (update: CadLiveUpdate) => Promise<void> | void,
): Promise<{ message: string; build: CadBuild | null }> {
	const path = `/api/models/${encodeURIComponent(projectId)}/design-runs`;
	signal.throwIfAborted();
	// Let this short start request return its job ID even if the user stops;
	// otherwise we'd lose the ability to cancel the server-side build.
	const run = await apiRequest<{ id: string }>(path, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(input),
		signal: AbortSignal.timeout(30000),
	});
	let previewRevision = -1;
	try {
		while (true) {
			signal.throwIfAborted();
			const state = await apiRequest<{
				status: string;
				progress: string;
				live?: CadLiveUpdate;
				error?: string;
				result?: { message: string; build: CadBuild | null };
			}>(
				`${path}/${encodeURIComponent(run.id)}?previewAfter=${previewRevision}`,
				{ signal },
			);
			signal.throwIfAborted();
			progress(state.progress);
			if (state.live) {
				await onLive?.(state.live);
				previewRevision = state.live.previewRevision;
			}
			signal.throwIfAborted();
			if (state.status === "completed" && state.result) return state.result;
			if (state.status === "failed")
				throw new Error(state.error || "The CAD model could not be built");
			if (state.status === "cancelled") throw new Error("CAD design stopped");
			await new Promise<void>((accept, reject) => {
				const stop = () => {
					clearTimeout(timer);
					signal.removeEventListener("abort", stop);
					reject(signal.reason);
				};
				const timer = setTimeout(() => {
					signal.removeEventListener("abort", stop);
					accept();
				}, 500);
				signal.addEventListener("abort", stop, { once: true });
				if (signal.aborted) stop();
			});
		}
	} finally {
		// Acknowledging a result releases its retained BREP data as well.
		void apiRequest(`${path}/${encodeURIComponent(run.id)}`, {
			method: "DELETE",
			signal: AbortSignal.timeout(10000),
		}).catch(() => {});
	}
}
