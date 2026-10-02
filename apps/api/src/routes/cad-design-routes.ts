import { validateCadProgram } from "@bidwright/domain";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { CadDesignInput } from "../services/build123d/agent.js";
import {
	cancelCadJob,
	getCadJob,
	startCadJob,
} from "../services/build123d/jobs.js";
import { getCadApiDocs } from "../services/build123d/runtime.js";
import { requireRequestAiConfig } from "../services/request-ai-config.js";

export const cadDesignInputSchema = z
	.object({
		prompt: z.string().trim().min(1).max(12000).optional(),
		program: z.unknown().nullable().optional(),
		context: z.unknown().optional(),
		sources: z
			.record(
				z.object({
					nodeId: z.string().min(1).max(160),
					brep: z
						.string()
						.min(30)
						.max(24 * 1024 * 1024),
				}),
			)
			.optional(),
		geometry: z
			.record(
				z
					.string()
					.min(30)
					.max(24 * 1024 * 1024),
			)
			.optional(),
		history: z
			.array(
				z.object({
					role: z.enum(["user", "assistant"]),
					content: z.string().max(12000),
				}),
			)
			.max(16)
			.optional(),
		feedback: z.string().max(8000).optional(),
		rebuild: z.boolean().optional(),
	})
	.superRefine((data, context) => {
		if (!data.rebuild && !data.prompt)
			context.addIssue({
				code: "custom",
				message: "Describe the design to build",
			});
		if (data.rebuild && !data.program)
			context.addIssue({
				code: "custom",
				message: "A rebuild requires saved CAD source",
			});
		if (JSON.stringify(data.context ?? {}).length > 200000)
			context.addIssue({
				code: "custom",
				message: "Model context is too large",
			});
		if (JSON.stringify([data.sources, data.geometry]).length > 40 * 1024 * 1024)
			context.addIssue({
				code: "custom",
				message: "Geometry inputs exceed 40 MB; select the parts to edit",
			});
	});

function scope(request: FastifyRequest) {
	if (!request.user)
		throw Object.assign(new Error("Sign in to design a model"), {
			statusCode: 401,
		});
	return {
		userId: request.user.id,
		organizationId: request.user.organizationId,
		projectId: (request.params as { projectId: string }).projectId,
	};
}

export async function cadDesignRoutes(app: FastifyInstance) {
	app.post("/api/models/:projectId/design-runs", async (request, reply) => {
		const access = scope(request);
		if (!(await request.store!.getProject(access.projectId)))
			return reply.code(404).send({ message: "Project not found" });
		const parsed = cadDesignInputSchema.safeParse(request.body);
		if (!parsed.success)
			return reply.code(400).send({
				message: "Invalid CAD design request",
				issues: parsed.error.flatten(),
			});
		try {
			if (parsed.data.program != null) validateCadProgram(parsed.data.program);
		} catch (error) {
			return reply.code(400).send({
				message: error instanceof Error ? error.message : String(error),
			});
		}
		const config = parsed.data.rebuild
			? null
			: await requireRequestAiConfig(request);
		return reply
			.code(202)
			.send(
				startCadJob(
					access,
					config,
					parsed.data as CadDesignInput,
					undefined,
					(event) => request.log.info(event, "CAD design activity"),
				),
			);
	});
	app.get(
		"/api/models/:projectId/design-runs/:runId",
		async (request, reply) => {
			const access = scope(request);
			if (!(await request.store!.getProject(access.projectId)))
				return reply.code(404).send({ message: "Project not found" });
			const run = getCadJob(
				access,
				(request.params as { runId: string }).runId,
				Number((request.query as { previewAfter?: string }).previewAfter ?? -1),
			);
			return (
				run ??
				reply.code(404).send({
					message:
						"Design run expired or was stopped. Your model has not been changed.",
				})
			);
		},
	);
	app.delete(
		"/api/models/:projectId/design-runs/:runId",
		async (request, reply) => {
			const access = scope(request);
			if (!(await request.store!.getProject(access.projectId)))
				return reply.code(404).send({ message: "Project not found" });
			if (!cancelCadJob(access, (request.params as { runId: string }).runId))
				return reply.code(404).send({ message: "Design run not found" });
			return { stopped: true };
		},
	);
	app.get("/api/models/:projectId/cad-capabilities", async (request, reply) => {
		const access = scope(request);
		if (!(await request.store!.getProject(access.projectId)))
			return reply.code(404).send({ message: "Project not found" });
		const docs = await getCadApiDocs("");
		return {
			engine: "build123d",
			version: docs.version,
			kernel: "OpenCascade 8.0.1",
			symbols: docs.symbols,
		};
	});
}
