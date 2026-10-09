import type { FastifyInstance, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import { createHash } from "node:crypto";
import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@bidwright/db";
import { z } from "zod";
import { relativeProjectFilePath, resolveApiPath } from "../paths.js";

const SCOPE = "__bidwright_tools__";
const PERSONAL_PREFIX = "toolsu-";
const digest = (value: string) => createHash("sha256").update(value).digest("hex").slice(0, 32);

export type ToolsSpace = "personal" | "organization";
/** The organization-wide Tools file tree. */
export const toolsProjectId = (organizationId: string) => "tools-" + digest(organizationId);
/** A user's private Tools file tree inside their organization. */
export const personalToolsProjectId = (organizationId: string, userId: string) =>
  PERSONAL_PREFIX + digest(organizationId + ":" + userId);

/** Project ids of the Tools trees the requester may read and write. */
function ownToolsProjectIds(request: FastifyRequest) {
  const organizationId = request.store?.organizationId;
  if (!organizationId) return [];
  const userId = request.user?.id;
  return userId
    ? [personalToolsProjectId(organizationId, userId), toolsProjectId(organizationId)]
    : [toolsProjectId(organizationId)];
}

/**
 * Personal Tools trees are ordinary projects to the file routes, so guard every
 * /projects/:projectId request, and node-addressed requests, against another user's tree.
 */
export const toolsAccessPlugin = fp(
  async (app: FastifyInstance, options: { database?: typeof prisma } = {}) => {
    const db = options.database ?? prisma;
    app.addHook("preHandler", async (request, reply) => {
      const params = (request.params ?? {}) as { projectId?: string; nodeId?: string };
      if (!params.projectId) return;
      const allowed = ownToolsProjectIds(request);
      let projectId = params.projectId;
      if (params.nodeId && request.url.includes("/files/")) {
        const node = await db.fileNode.findUnique({ where: { id: params.nodeId }, select: { projectId: true } });
        if (node?.projectId.startsWith(PERSONAL_PREFIX)) projectId = node.projectId;
      }
      if (projectId.startsWith(PERSONAL_PREFIX) && !allowed.includes(projectId)) {
        return reply.code(404).send({ message: "Project not found" });
      }
    });
  },
  { name: "tools-access" },
);

/** Tenant-owned file containers; no Quote, Revision or Worksheet is created. */
export async function toolsRoutes(app: FastifyInstance, options: { database?: typeof prisma } = {}) {
  const db = options.database ?? prisma;
  app.post("/tools/workspace", async (request, reply) => {
    const organizationId = request.store?.organizationId;
    if (!organizationId) return reply.code(401).send({ message: "Organization context required" });
    const parsed = z
      .object({ space: z.enum(["personal", "organization"]).default("personal") })
      .safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ message: "Choose personal or organization files" });
    const userId = request.user?.id;
    const space: ToolsSpace = parsed.data.space === "personal" && userId ? "personal" : "organization";
    const id = space === "personal" ? personalToolsProjectId(organizationId, userId!) : toolsProjectId(organizationId);
    const name = space === "personal" ? "My files" : "Organization files";
    // Two tabs (or a double-mounted effect) can create the tree at once; the loser re-reads the winner's row.
    const upsert = () => db.project.upsert({
      where: { id },
      create: {
        id,
        organizationId,
        name,
        scope: SCOPE,
        isStandalone: true,
        ingestionStatus: "ready",
        summary: space === "personal" ? "Private standalone authoring files" : "Shared standalone authoring files",
      },
      update: {},
      select: { id: true, name: true, organizationId: true },
    });
    const project = await upsert().catch((error: { code?: string }) => {
      if (error?.code === "P2002") return upsert();
      throw error;
    });
    if (project.organizationId !== organizationId) return reply.code(404).send({ message: "Workspace not found" });
    return {
      space,
      project: { id: project.id, name },
      sourceDocuments: [],
      quote: null,
      currentRevision: { defaultMarkup: 0 },
    };
  });

  app.post("/tools/files/:nodeId/to-quote", async (request, reply) => {
    const store = request.store!;
    const { nodeId } = request.params as { nodeId: string };
    const parsed = z
      .object({
        projectId: z.string().min(1).optional(),
        quoteName: z.string().trim().min(1).max(200).optional(),
      })
      .safeParse(request.body);
    if (!parsed.success || (!parsed.data.projectId && !parsed.data.quoteName))
      return reply.code(400).send({ message: "Choose a quote or enter a new quote name" });
    const source = await db.fileNode.findFirst({
      where: { id: nodeId, projectId: { in: ownToolsProjectIds(request) }, type: "file" },
    });
    if (!source) return reply.code(404).send({ message: "Tools file not found" });
    let projectId = parsed.data.projectId,
      quoteId: string | null = null;
    if (projectId) {
      const project = await store.getProject(projectId);
      if (!project || projectId === source.projectId)
        return reply.code(404).send({ message: "Destination quote not found" });
      const quote = await db.quote.findFirst({
        where: { projectId, project: { organizationId: store.organizationId } },
        select: { id: true },
      });
      if (!quote) return reply.code(400).send({ message: "Choose a project with a quote" });
      quoteId = quote.id;
    } else {
      const result = await store.createProject({
        name: parsed.data.quoteName!,
        clientName: "",
        location: "",
        creationMode: "manual",
      });
      projectId = result.project.id;
      quoteId = result.quote?.id ?? null;
    }
    const targetProjectId = projectId!;
    const node = await store.createFileNode(targetProjectId, {
      name: source.name,
      type: "file",
      fileType: source.fileType ?? undefined,
      size: source.size ?? undefined,
      metadata: { ...(source.metadata as Record<string, unknown>), toolsSourceFileId: source.id },
    });
    try {
      if (source.storagePath) {
        const target = relativeProjectFilePath(targetProjectId, node.id, source.name);
        await mkdir(path.dirname(resolveApiPath(target)), { recursive: true });
        await copyFile(resolveApiPath(source.storagePath), resolveApiPath(target));
        await store.updateFileNode(node.id, { storagePath: target });
      }
      const pickups = await db.pickup.findMany({
        where: {
          projectId: source.projectId,
          documentId: { in: [source.id, "file-" + source.id] },
          sourceKind: "annotation",
        },
      });
      if (pickups.length)
        await db.pickup.createMany({
          data: pickups.map((p) => ({
            projectId: targetProjectId,
            documentId: "file-" + node.id,
            pageNumber: p.pageNumber,
            annotationType: p.annotationType,
            label: p.label,
            color: p.color,
            lineThickness: p.lineThickness,
            visible: p.visible,
            points: p.points as any,
            measurement: p.measurement as any,
            calibration: p.calibration as any,
            metadata: p.metadata as any,
            groupName: p.groupName,
          })),
        });
    } catch (error) {
      await db.pickup.deleteMany({ where: { projectId: targetProjectId, documentId: "file-" + node.id } });
      await store.deleteFileNode(node.id);
      throw error;
    }
    return { projectId, quoteId, fileNodeId: node.id };
  });
}
