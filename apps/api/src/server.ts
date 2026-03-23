import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { access, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { z } from "zod";

import {
  type PrismaApiStore,
  type AdditionalLineItemPatchInput,
  type CatalogItemPatchInput,
  type CatalogPatchInput,
  type ConditionPatchInput,
  type CreateAdditionalLineItemInput,
  type CreateCatalogInput,
  type CreateCatalogItemInput,
  type CreateConditionInput,
  type CreateFileNodeInput,
  type CreateModifierInput,
  type CreatePhaseInput,
  type CreateReportSectionInput,
  type CreateWorksheetInput,
  type CreateWorksheetItemInput,
  type CreateProjectInput,
  type FileNodePatchInput,
  type ModifierPatchInput,
  type PackageIngestionOutcome,
  type PhasePatchInput,
  type QuotePatchInput,
  type ReportSectionPatchInput,
  type RevisionPatchInput,
  type StatusPatchInput,
  type WorksheetPatchInput,
  type WorksheetItemPatchInput,
  type CreateJobInput,
  type ImportProcessInput,
  type PluginPatchInput,
  type CreatePluginInput,
  type CreateUserInput,
  type UserPatchInput,
  type CreateTakeoffAnnotationInput,
  type TakeoffAnnotationPatchInput,
  type CreateScheduleTaskInput,
  type ScheduleTaskPatchInput,
  type CreateDependencyInput
} from "./prisma-store.js";
import { prisma } from "@bidwright/db";
import {
  relativePackageArchivePath,
  relativeProjectFilePath,
  resolveApiPath,
  sanitizeFileName
} from "./paths.js";
import { agentRoutes } from "./routes/agent-routes.js";
import { knowledgeRoutes } from "./routes/knowledge-routes.js";
import { datasetRoutes } from "./routes/dataset-routes.js";
import { takeoffRoutes } from "./routes/takeoff-routes.js";
import { authPlugin } from "./middleware/auth.js";
import { authRoutes } from "./routes/auth-routes.js";
import { adminRoutes } from "./routes/admin-routes.js";
import { rateScheduleRoutes } from "./routes/rate-schedule-routes.js";
import { intakeRoutes } from "./routes/intake-routes.js";
import { catalogRoutes } from "./routes/catalog-routes.js";
import { buildPdfDataPackage, generatePdfHtml, generatePdfBuffer, buildSchedulePdfData, generateSchedulePdfHtml, type PdfLayoutOptions } from "./services/pdf-service.js";
import { sendQuoteEmail } from "./services/email-service.js";
import { cleanExpiredSessions } from "./services/auth-service.js";
import {
  aiRewriteDescription,
  aiRewriteNotes,
  aiSuggestPhases,
  aiSuggestEquipment
} from "./services/ai-service.js";

const createProjectSchema = z.object({
  name: z.string().min(1),
  clientName: z.string().min(1),
  location: z.string().min(1),
  packageName: z.string().min(1).optional(),
  summary: z.string().optional()
});

const workspacePatchSchema = z.record(z.unknown());
const ingestBodySchema = z.object({
  packageId: z.string().min(1).optional()
});
const revisionPatchSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  notes: z.string().optional(),
  breakoutStyle: z.enum(["grand_total", "category", "phase", "phase_detail", "labour_material_equipment"]).optional(),
  phaseWorksheetEnabled: z.boolean().optional(),
  useCalculatedTotal: z.boolean().optional(),
  type: z.enum(["Firm", "Budget", "BudgetDNE"]).optional(),
  scratchpad: z.string().optional(),
  leadLetter: z.string().optional(),
  dateEstimatedShip: z.string().nullable().optional(),
  dateQuote: z.string().nullable().optional(),
  dateDue: z.string().nullable().optional(),
  dateWalkdown: z.string().nullable().optional(),
  dateWorkStart: z.string().nullable().optional(),
  dateWorkEnd: z.string().nullable().optional(),
  shippingMethod: z.string().optional(),
  shippingTerms: z.string().optional(),
  freightOnBoard: z.string().optional(),
  status: z.enum(["Open", "Pending", "Awarded", "DidNotGet", "Declined", "Cancelled", "Closed", "Other"]).optional(),
  defaultMarkup: z.number().finite().optional(),
  necaDifficulty: z.string().optional(),
  followUpNote: z.string().optional(),
  printEmptyNotesColumn: z.boolean().optional(),
  printCategory: z.array(z.string()).optional(),
  printPhaseTotalOnly: z.boolean().optional(),
  showOvertimeDoubletime: z.boolean().optional(),
  grandTotal: z.number().finite().optional(),
  regHours: z.number().finite().optional(),
  overHours: z.number().finite().optional(),
  doubleHours: z.number().finite().optional(),
  breakoutPackage: z.array(z.unknown()).optional(),
  calculatedCategoryTotals: z.array(z.unknown()).optional()
});
const quotePatchSchema = z.object({
  customerExistingNew: z.enum(["Existing", "New"]).optional(),
  customerId: z.string().nullable().optional(),
  customerString: z.string().optional(),
  customerContactId: z.string().nullable().optional(),
  customerContactString: z.string().optional(),
  customerContactEmailString: z.string().optional(),
  departmentId: z.string().nullable().optional(),
  userId: z.string().nullable().optional()
});
const worksheetItemPatchSchema = z.object({
  phaseId: z.string().nullable().optional(),
  category: z.string().min(1).optional(),
  entityType: z.string().min(1).optional(),
  entityName: z.string().min(1).optional(),
  vendor: z.string().nullable().optional(),
  description: z.string().optional(),
  quantity: z.number().finite().optional(),
  uom: z.string().min(1).optional(),
  cost: z.number().finite().optional(),
  markup: z.number().finite().optional(),
  price: z.number().finite().optional(),
  laborHourReg: z.number().finite().optional(),
  laborHourOver: z.number().finite().optional(),
  laborHourDouble: z.number().finite().optional(),
  lineOrder: z.number().int().optional()
});
const createWorksheetItemSchema = z.object({
  phaseId: z.string().nullable().optional(),
  category: z.string().min(1),
  entityType: z.string().min(1),
  entityName: z.string().min(1),
  vendor: z.string().nullable().optional(),
  description: z.string().default(""),
  quantity: z.coerce.number().finite(),
  uom: z.string().min(1),
  cost: z.coerce.number().finite(),
  markup: z.coerce.number().finite(),
  price: z.coerce.number().finite(),
  laborHourReg: z.coerce.number().finite().default(0),
  laborHourOver: z.coerce.number().finite().default(0),
  laborHourDouble: z.coerce.number().finite().default(0),
  lineOrder: z.coerce.number().int().optional()
});
const createWorksheetSchema = z.object({
  name: z.string().min(1)
});
const worksheetPatchSchema = z.object({
  name: z.string().min(1).optional(),
  order: z.number().int().optional()
});

const createPhaseSchema = z.object({
  number: z.string().optional(),
  name: z.string().optional(),
  description: z.string().optional()
});

const phasePatchSchema = z.object({
  number: z.string().optional(),
  name: z.string().optional(),
  description: z.string().optional(),
  order: z.number().int().optional(),
  startDate: z.string().nullable().optional(),
  endDate: z.string().nullable().optional(),
  color: z.string().optional()
});

const createScheduleTaskSchema = z.object({
  phaseId: z.string().nullable().optional(),
  name: z.string().optional(),
  description: z.string().optional(),
  taskType: z.enum(["task", "milestone"]).optional(),
  status: z.enum(["not_started", "in_progress", "complete", "on_hold"]).optional(),
  startDate: z.string().nullable().optional(),
  endDate: z.string().nullable().optional(),
  duration: z.number().int().min(0).optional(),
  progress: z.number().min(0).max(1).optional(),
  assignee: z.string().optional(),
  order: z.number().int().optional()
});

const scheduleTaskPatchSchema = z.object({
  phaseId: z.string().nullable().optional(),
  name: z.string().optional(),
  description: z.string().optional(),
  taskType: z.enum(["task", "milestone"]).optional(),
  status: z.enum(["not_started", "in_progress", "complete", "on_hold"]).optional(),
  startDate: z.string().nullable().optional(),
  endDate: z.string().nullable().optional(),
  duration: z.number().int().min(0).optional(),
  progress: z.number().min(0).max(1).optional(),
  assignee: z.string().optional(),
  order: z.number().int().optional()
});

const batchUpdateScheduleTasksSchema = z.object({
  updates: z.array(z.object({
    id: z.string().min(1),
    phaseId: z.string().nullable().optional(),
    name: z.string().optional(),
    startDate: z.string().nullable().optional(),
    endDate: z.string().nullable().optional(),
    duration: z.number().int().min(0).optional(),
    progress: z.number().min(0).max(1).optional(),
    status: z.enum(["not_started", "in_progress", "complete", "on_hold"]).optional(),
    assignee: z.string().optional(),
    order: z.number().int().optional()
  }))
});

const createDependencySchema = z.object({
  predecessorId: z.string().min(1),
  successorId: z.string().min(1),
  type: z.enum(["FS", "SS", "FF", "SF"]).optional(),
  lagDays: z.number().int().optional()
});

const createModifierSchema = z.object({
  name: z.string().optional(),
  type: z.string().optional(),
  appliesTo: z.string().optional(),
  percentage: z.number().finite().nullable().optional(),
  amount: z.number().finite().nullable().optional(),
  show: z.enum(["Yes", "No"]).optional()
});

const modifierPatchSchema = z.object({
  name: z.string().optional(),
  type: z.string().optional(),
  appliesTo: z.string().optional(),
  percentage: z.number().finite().nullable().optional(),
  amount: z.number().finite().nullable().optional(),
  show: z.enum(["Yes", "No"]).optional()
});

const createConditionSchema = z.object({
  type: z.string().min(1),
  value: z.string().min(1),
  order: z.number().int().optional()
});

const conditionPatchSchema = z.object({
  type: z.string().min(1).optional(),
  value: z.string().min(1).optional(),
  order: z.number().int().optional()
});

const reorderSchema = z.object({
  orderedIds: z.array(z.string().min(1))
});

const createAliSchema = z.object({
  name: z.string().optional(),
  type: z.enum(["OptionStandalone", "OptionAdditional", "LineItemAdditional", "LineItemStandalone", "CustomTotal"]).optional(),
  description: z.string().optional(),
  amount: z.number().finite().optional()
});

const aliPatchSchema = z.object({
  name: z.string().optional(),
  type: z.enum(["OptionStandalone", "OptionAdditional", "LineItemAdditional", "LineItemStandalone", "CustomTotal"]).optional(),
  description: z.string().optional(),
  amount: z.number().finite().optional()
});

const createReportSectionSchema = z.object({
  sectionType: z.string().optional(),
  title: z.string().optional(),
  content: z.string().optional(),
  order: z.number().int().optional(),
  parentSectionId: z.string().nullable().optional()
});

const reportSectionPatchSchema = z.object({
  sectionType: z.string().optional(),
  title: z.string().optional(),
  content: z.string().optional(),
  order: z.number().int().optional(),
  parentSectionId: z.string().nullable().optional()
});

const statusPatchSchema = z.object({
  ingestionStatus: z.enum(["queued", "processing", "ready", "review", "quoted"])
});

const createCatalogSchema = z.object({
  name: z.string().min(1),
  kind: z.string().min(1),
  scope: z.string().min(1),
  projectId: z.string().nullable().optional(),
  description: z.string().optional()
});

const catalogPatchSchema = z.object({
  name: z.string().min(1).optional(),
  kind: z.string().min(1).optional(),
  scope: z.string().min(1).optional(),
  projectId: z.string().nullable().optional(),
  description: z.string().optional()
});

const createCatalogItemSchema = z.object({
  code: z.string().default(""),
  name: z.string().min(1),
  unit: z.string().default("EA"),
  unitCost: z.number().finite().default(0),
  unitPrice: z.number().finite().default(0),
  category: z.string().optional(),
  metadata: z.record(z.unknown()).optional()
});

const catalogItemPatchSchema = z.object({
  code: z.string().optional(),
  name: z.string().min(1).optional(),
  unit: z.string().optional(),
  unitCost: z.number().finite().optional(),
  unitPrice: z.number().finite().optional(),
  category: z.string().optional(),
  metadata: z.record(z.unknown()).optional()
});

const createFileNodeSchema = z.object({
  parentId: z.string().nullable().optional(),
  name: z.string().min(1),
  type: z.enum(["file", "directory"]),
  fileType: z.string().optional(),
  size: z.number().int().optional(),
  documentId: z.string().optional(),
  storagePath: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
  createdBy: z.string().optional()
});

const fileNodePatchSchema = z.object({
  name: z.string().min(1).optional(),
  parentId: z.string().nullable().optional()
});

interface UploadFieldMap {
  projectId?: string;
  projectName?: string;
  name?: string;
  clientName?: string;
  location?: string;
  packageName?: string;
  scope?: string;
  summary?: string;
  sourceKind?: "project" | "library";
}

interface MultipartPackageUpload {
  packageId: string;
  fields: UploadFieldMap;
  originalFileName: string;
  storagePath: string;
  totalBytes: number;
  checksum: string;
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function hashFile(filePath: string) {
  return new Promise<string>((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}

export function summaryMetrics(workspace: PackageIngestionOutcome["workspace"]) {
  return [
    {
      label: "Estimate Total",
      value: roundMoney(workspace.estimate.totals.calculatedTotal || workspace.estimate.totals.subtotal)
    },
    {
      label: "Projected Margin",
      value: roundMoney(workspace.estimate.totals.estimatedMargin)
    },
    {
      label: "Indexed Pages",
      value: workspace.sourceDocuments.reduce((sum, document) => sum + document.pageCount, 0)
    },
    {
      label: "AI Proposals",
      value: workspace.aiRuns.length
    }
  ];
}

async function saveMultipartPackageUpload(request: FastifyRequest): Promise<MultipartPackageUpload> {
  const fields: UploadFieldMap = {};
  const packageId = `pkg-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  let originalFileName = "";
  let storagePath = "";
  let totalBytes = 0;
  let checksum = "";
  let fileSeen = false;

  for await (const part of request.parts()) {
    if (part.type === "file") {
      if (fileSeen) {
        throw new Error("Only one zip file can be uploaded per request");
      }

      fileSeen = true;
      originalFileName = sanitizeFileName(part.filename || "customer-package.zip");
      const fileExt = path.extname(originalFileName).toLowerCase();
      if (fileExt !== ".zip") {
        throw new Error("Only .zip uploads are supported");
      }

      storagePath = resolveApiPath(relativePackageArchivePath(packageId, originalFileName));
      await mkdir(path.dirname(storagePath), { recursive: true });
      await pipeline(part.file, createWriteStream(storagePath));

      totalBytes = (await stat(storagePath)).size;
      checksum = await hashFile(storagePath);
      continue;
    }

    const value = Array.isArray(part.value) ? part.value.join("") : String(part.value);
    (fields as Record<string, string | undefined>)[part.fieldname] = value;
  }

  if (!fileSeen) {
    throw new Error("A zip file is required for package upload");
  }

  if (!storagePath) {
    throw new Error("Package upload could not be stored");
  }

  if (!checksum) {
    checksum = await hashFile(storagePath);
  }

  return {
    packageId,
    fields,
    originalFileName,
    storagePath,
    totalBytes,
    checksum
  };
}

function createProjectInputFromUpload(fields: UploadFieldMap, originalFileName: string): CreateProjectInput {
  const packageName = fields.packageName?.trim() || path.basename(originalFileName, path.extname(originalFileName));
  return {
    name: fields.projectName?.trim() || fields.name?.trim() || packageName,
    clientName: fields.clientName?.trim() || "Unassigned Client",
    location: fields.location?.trim() || "TBD",
    packageName,
    scope: fields.scope?.trim() || undefined,
    summary: fields.summary?.trim() || undefined
  };
}

function buildPackageResponse(result: PackageIngestionOutcome) {
  return {
    project: result.project,
    quote: result.quote,
    revision: result.revision,
    package: result.packageRecord,
    job: result.job,
    documents: result.documents,
    workspace: result.workspace,
    estimate: result.workspace.estimate,
    totals: result.totals,
    summaryMetrics: summaryMetrics(result.workspace)
  };
}

export async function buildWorkspaceResponse(store: PrismaApiStore, projectId: string) {
  const workspace = await store.getWorkspace(projectId);
  if (!workspace) {
    return null;
  }

  const rateSchedules = await store.listRevisionRateSchedules(projectId);

  return {
    workspace: {
      ...workspace,
      rateSchedules,
    },
    workspaceState: await store.getWorkspaceState(projectId),
    summaryMetrics: summaryMetrics(workspace),
    packages: await store.listPackages(projectId),
    jobs: await store.listJobs(projectId),
    documents: await store.listDocuments(projectId)
  };
}

async function ingestUploadForProject(store: PrismaApiStore, request: FastifyRequest, reply: FastifyReply, projectIdOverride?: string) {
  const multipartUpload = await saveMultipartPackageUpload(request);
  const sourceKind = multipartUpload.fields.sourceKind ?? "project";
  const projectId = (projectIdOverride ?? multipartUpload.fields.projectId)?.trim();

  if (projectIdOverride && multipartUpload.fields.projectId && multipartUpload.fields.projectId.trim() !== projectIdOverride) {
    reply.code(400);
    return {
      message: "Multipart projectId does not match the route projectId"
    };
  }

  let targetProjectId = projectId ?? null;
  if (targetProjectId) {
    const existingProject = await store.getProject(targetProjectId);
    if (!existingProject) {
      reply.code(404);
      return {
        message: "Project not found"
      };
    }
  } else {
    const createdProject = await store.createProject(createProjectInputFromUpload(multipartUpload.fields, multipartUpload.originalFileName));
    targetProjectId = createdProject.project.id;
  }

  if (!targetProjectId) {
    reply.code(400);
    return {
      message: "Project could not be resolved for package upload"
    };
  }

  const packageName =
    multipartUpload.fields.packageName?.trim() ||
    path.basename(multipartUpload.originalFileName, path.extname(multipartUpload.originalFileName));

  await store.registerUploadedPackage({
    packageId: multipartUpload.packageId,
    projectId: targetProjectId,
    packageName,
    originalFileName: multipartUpload.originalFileName,
    storagePath: path.relative(resolveApiPath(), multipartUpload.storagePath),
    checksum: multipartUpload.checksum,
    totalBytes: multipartUpload.totalBytes,
    sourceKind
  });

  // Run ingestion asynchronously — return immediately so the UI can redirect
  store.ingestUploadedPackage(multipartUpload.packageId).then(async (outcome) => {
    // Write ingestion results to agent memory so the AI drawer can display them
    try {
      const docs = outcome.documents ?? [];
      const summary = docs.map((d: any) => {
        const type = d.documentType ?? d.fileType ?? "unknown";
        const pages = d.pageCount ?? 0;
        const hasText = d.extractedText && d.extractedText.length > 50;
        return `- ${d.fileName} | ${type} | ${pages} pages | ${hasText ? "text extracted" : "no text"}`;
      }).join("\n");

      const memPath = resolveApiPath("projects", targetProjectId!, "agent-memory.json");
      let memory: any = { sections: {}, updatedAt: null };
      try { memory = JSON.parse(await readFile(memPath, "utf8")); } catch {}
      memory.sections["ingestion_results"] = `## Document Ingestion Complete\n\n${docs.length} documents extracted from package:\n\n${summary}`;
      memory.updatedAt = new Date().toISOString();
      await mkdir(path.dirname(memPath), { recursive: true });
      await writeFile(memPath, JSON.stringify(memory, null, 2), "utf8");
    } catch {}
  }).catch((err) => {
    console.error(`[ingestion] Package ${multipartUpload.packageId} failed:`, err);
  });

  // Return project info immediately so the UI can navigate to the workspace
  const project = await store.getProject(targetProjectId);
  const workspace = await store.getWorkspace(targetProjectId);
  reply.code(201);
  return {
    project,
    quote: workspace?.quote ?? null,
    revision: workspace?.currentRevision ?? null,
    documents: [],
    status: "processing",
    message: "Package uploaded. Document extraction is running in the background.",
  };
}

export function buildServer() {
  const app = Fastify({
    logger: true
  });

  // Prisma lifecycle
  app.addHook("onClose", async () => {
    await prisma.$disconnect();
  });

  app.register(cors, {
    origin: true
  });

  app.register(multipart, {
    limits: {
      files: 1,
      fileSize: 1_073_741_824
    }
  });

  app.register(authPlugin);

  app.setErrorHandler((error, _request, reply) => {
    app.log.error(error);
    reply.status(500).send({
      message: error instanceof Error ? error.message : "Internal server error"
    });
  });

  app.get("/health", async () => ({
    status: "ok",
    service: "bidwright-api",
    dataRoot: resolveApiPath()
  }));

  app.get("/projects", async (request) => request.store!.listProjectsWithState());

  app.post("/projects", async (request, reply) => {
    const parsed = createProjectSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        message: "Invalid project payload",
        issues: parsed.error.flatten()
      });
    }

    const result = await request.store!.createProject(parsed.data);
    reply.code(201);
    return result;
  });

  app.get("/projects/:projectId", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const project = await request.store!.getProject(projectId);

    if (!project) {
      return reply.code(404).send({
        message: "Project not found"
      });
    }

    return project;
  });

  app.get("/projects/:projectId/workspace", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const payload = await buildWorkspaceResponse(request.store!, projectId);

    if (!payload) {
      return reply.code(404).send({
        message: "Project workspace not found"
      });
    }

    return payload;
  });

  // ── Ingestion Status (for polling from AI drawer) ────────────────
  app.get("/projects/:projectId/ingestion-status", async (request) => {
    const { projectId } = request.params as { projectId: string };
    const project = await request.store!.getProject(projectId);
    if (!project) return { status: "unknown", documents: [] };

    const documents = await request.store!.listDocuments(projectId);
    return {
      status: (project as any).ingestionStatus ?? "unknown",
      documentCount: documents.length,
      documents: documents.map((d: any) => ({
        id: d.id,
        fileName: d.fileName,
        fileType: d.fileType,
        documentType: d.documentType,
        pageCount: d.pageCount,
        hasText: !!(d.extractedText && d.extractedText.length > 50),
      })),
    };
  });

  // ── Agent Memory (per-project persistent scratchpad) ─────────────
  app.get("/projects/:projectId/agent-memory", async (request) => {
    const { projectId } = request.params as { projectId: string };
    const memPath = resolveApiPath("projects", projectId, "agent-memory.json");
    try {
      const raw = await readFile(memPath, "utf8");
      return JSON.parse(raw);
    } catch {
      return { sections: {}, updatedAt: null };
    }
  });

  app.put("/projects/:projectId/agent-memory", async (request) => {
    const { projectId } = request.params as { projectId: string };
    const body = request.body as { section: string; content: string; append?: boolean };
    const memPath = resolveApiPath("projects", projectId, "agent-memory.json");

    let memory: { sections: Record<string, string>; updatedAt: string | null } = { sections: {}, updatedAt: null };
    try {
      const raw = await readFile(memPath, "utf8");
      memory = JSON.parse(raw);
    } catch {}

    if (body.append && memory.sections[body.section]) {
      memory.sections[body.section] += "\n" + body.content;
    } else {
      memory.sections[body.section] = body.content;
    }
    memory.updatedAt = new Date().toISOString();

    await mkdir(path.dirname(memPath), { recursive: true });
    await writeFile(memPath, JSON.stringify(memory, null, 2), "utf8");
    return memory;
  });

  app.get("/projects/:projectId/estimate", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const workspace = await request.store!.getWorkspace(projectId);

    if (!workspace) {
      return reply.code(404).send({
        message: "Project not found"
      });
    }

    return workspace.estimate;
  });

  app.get("/projects/:projectId/packages", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const project = await request.store!.getProject(projectId);
    if (!project) {
      return reply.code(404).send({
        message: "Project not found"
      });
    }
    return request.store!.listPackages(projectId);
  });

  app.get("/projects/:projectId/jobs", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const project = await request.store!.getProject(projectId);
    if (!project) {
      return reply.code(404).send({
        message: "Project not found"
      });
    }
    return request.store!.listJobs(projectId);
  });

  app.get("/projects/:projectId/documents", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const project = await request.store!.getProject(projectId);
    if (!project) {
      return reply.code(404).send({
        message: "Project not found"
      });
    }
    return request.store!.listDocuments(projectId);
  });

  app.get("/projects/:projectId/workspace-state", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const project = await request.store!.getProject(projectId);
    if (!project) {
      return reply.code(404).send({
        message: "Project not found"
      });
    }

    const workspaceState = await request.store!.getWorkspaceState(projectId);

    if (!workspaceState) {
      return reply.code(404).send({
        message: "Workspace state not found"
      });
    }

    return workspaceState;
  });

  app.patch("/projects/:projectId/workspace-state", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const project = await request.store!.getProject(projectId);
    if (!project) {
      return reply.code(404).send({
        message: "Project not found"
      });
    }

    const parsed = workspacePatchSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({
        message: "Invalid workspace state payload",
        issues: parsed.error.flatten()
      });
    }

    const workspaceState = await request.store!.updateWorkspaceState(projectId, parsed.data);
    if (!workspaceState) {
      return reply.code(404).send({
        message: "Workspace state not found"
      });
    }

    return workspaceState;
  });

  app.patch("/projects/:projectId/revisions/:revisionId", async (request, reply) => {
    const { projectId, revisionId } = request.params as { projectId: string; revisionId: string };
    const parsed = revisionPatchSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({
        message: "Invalid revision payload",
        issues: parsed.error.flatten()
      });
    }

    await request.store!.updateRevision(projectId, revisionId, parsed.data satisfies RevisionPatchInput);
    const payload = await buildWorkspaceResponse(request.store!, projectId);
    if (!payload) {
      return reply.code(404).send({
        message: "Project workspace not found"
      });
    }
    return payload;
  });

  app.post("/projects/:projectId/worksheets/:worksheetId/items", async (request, reply) => {
    const { projectId, worksheetId } = request.params as { projectId: string; worksheetId: string };
    const parsed = createWorksheetItemSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({
        message: "Invalid worksheet item payload",
        issues: parsed.error.flatten()
      });
    }

    await request.store!.createWorksheetItem(projectId, worksheetId, parsed.data satisfies CreateWorksheetItemInput);
    const payload = await buildWorkspaceResponse(request.store!, projectId);
    if (!payload) {
      return reply.code(404).send({
        message: "Project workspace not found"
      });
    }
    reply.code(201);
    return payload;
  });

  app.post("/projects/:projectId/worksheets", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const parsed = createWorksheetSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({
        message: "Invalid worksheet payload",
        issues: parsed.error.flatten()
      });
    }

    await request.store!.createWorksheet(projectId, parsed.data satisfies CreateWorksheetInput);
    const payload = await buildWorkspaceResponse(request.store!, projectId);
    if (!payload) {
      return reply.code(404).send({
        message: "Project workspace not found"
      });
    }
    reply.code(201);
    return payload;
  });

  app.patch("/projects/:projectId/worksheets/:worksheetId", async (request, reply) => {
    const { projectId, worksheetId } = request.params as { projectId: string; worksheetId: string };
    const parsed = worksheetPatchSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({
        message: "Invalid worksheet payload",
        issues: parsed.error.flatten()
      });
    }

    await request.store!.updateWorksheet(projectId, worksheetId, parsed.data satisfies WorksheetPatchInput);
    const payload = await buildWorkspaceResponse(request.store!, projectId);
    if (!payload) {
      return reply.code(404).send({
        message: "Project workspace not found"
      });
    }
    return payload;
  });

  app.delete("/projects/:projectId/worksheets/:worksheetId", async (request, reply) => {
    const { projectId, worksheetId } = request.params as { projectId: string; worksheetId: string };
    await request.store!.deleteWorksheet(projectId, worksheetId);
    const payload = await buildWorkspaceResponse(request.store!, projectId);
    if (!payload) {
      return reply.code(404).send({
        message: "Project workspace not found"
      });
    }
    return payload;
  });

  app.patch("/projects/:projectId/worksheet-items/:itemId", async (request, reply) => {
    const { projectId, itemId } = request.params as { projectId: string; itemId: string };
    const parsed = worksheetItemPatchSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({
        message: "Invalid worksheet item payload",
        issues: parsed.error.flatten()
      });
    }

    await request.store!.updateWorksheetItem(projectId, itemId, parsed.data satisfies WorksheetItemPatchInput);
    const payload = await buildWorkspaceResponse(request.store!, projectId);
    if (!payload) {
      return reply.code(404).send({
        message: "Project workspace not found"
      });
    }
    return payload;
  });

  app.delete("/projects/:projectId/worksheet-items/:itemId", async (request, reply) => {
    const { projectId, itemId } = request.params as { projectId: string; itemId: string };
    await request.store!.deleteWorksheetItem(projectId, itemId);
    const payload = await buildWorkspaceResponse(request.store!, projectId);
    if (!payload) {
      return reply.code(404).send({
        message: "Project workspace not found"
      });
    }
    return payload;
  });

  // ── Phase routes ──────────────────────────────────────────────────

  app.post("/projects/:projectId/phases", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const parsed = createPhaseSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({
        message: "Invalid phase payload",
        issues: parsed.error.flatten()
      });
    }

    const workspace = await request.store!.getWorkspace(projectId);
    if (!workspace) {
      return reply.code(404).send({ message: "Project workspace not found" });
    }

    await request.store!.createPhase(projectId, workspace.currentRevision.id, parsed.data satisfies CreatePhaseInput);
    const payload = await buildWorkspaceResponse(request.store!, projectId);
    if (!payload) {
      return reply.code(404).send({ message: "Project workspace not found" });
    }
    reply.code(201);
    return payload;
  });

  app.patch("/projects/:projectId/phases/:phaseId", async (request, reply) => {
    const { projectId, phaseId } = request.params as { projectId: string; phaseId: string };
    const parsed = phasePatchSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({
        message: "Invalid phase payload",
        issues: parsed.error.flatten()
      });
    }

    await request.store!.updatePhase(projectId, phaseId, parsed.data satisfies PhasePatchInput);
    const payload = await buildWorkspaceResponse(request.store!, projectId);
    if (!payload) {
      return reply.code(404).send({ message: "Project workspace not found" });
    }
    return payload;
  });

  app.delete("/projects/:projectId/phases/:phaseId", async (request, reply) => {
    const { projectId, phaseId } = request.params as { projectId: string; phaseId: string };
    await request.store!.deletePhase(projectId, phaseId);
    const payload = await buildWorkspaceResponse(request.store!, projectId);
    if (!payload) {
      return reply.code(404).send({ message: "Project workspace not found" });
    }
    return payload;
  });

  // ── Schedule Task routes ─────────────────────────────────────────────

  app.get("/projects/:projectId/schedule-tasks", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const project = await request.store!.getProject(projectId);
    if (!project) {
      return reply.code(404).send({ message: "Project not found" });
    }
    return request.store!.listScheduleTasks(projectId);
  });

  app.post("/projects/:projectId/schedule-tasks", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const parsed = createScheduleTaskSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ message: "Invalid schedule task payload", issues: parsed.error.flatten() });
    }

    const workspace = await request.store!.getWorkspace(projectId);
    if (!workspace) {
      return reply.code(404).send({ message: "Project workspace not found" });
    }

    await request.store!.createScheduleTask(projectId, workspace.currentRevision.id, parsed.data satisfies CreateScheduleTaskInput);
    const payload = await buildWorkspaceResponse(request.store!, projectId);
    if (!payload) {
      return reply.code(404).send({ message: "Project workspace not found" });
    }
    reply.code(201);
    return payload;
  });

  app.patch("/projects/:projectId/schedule-tasks/:taskId", async (request, reply) => {
    const { projectId, taskId } = request.params as { projectId: string; taskId: string };
    const parsed = scheduleTaskPatchSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ message: "Invalid schedule task payload", issues: parsed.error.flatten() });
    }

    await request.store!.updateScheduleTask(projectId, taskId, parsed.data satisfies ScheduleTaskPatchInput);
    const payload = await buildWorkspaceResponse(request.store!, projectId);
    if (!payload) {
      return reply.code(404).send({ message: "Project workspace not found" });
    }
    return payload;
  });

  app.delete("/projects/:projectId/schedule-tasks/:taskId", async (request, reply) => {
    const { projectId, taskId } = request.params as { projectId: string; taskId: string };
    await request.store!.deleteScheduleTask(projectId, taskId);
    const payload = await buildWorkspaceResponse(request.store!, projectId);
    if (!payload) {
      return reply.code(404).send({ message: "Project workspace not found" });
    }
    return payload;
  });

  app.post("/projects/:projectId/schedule-tasks/batch", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const parsed = batchUpdateScheduleTasksSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ message: "Invalid batch update payload", issues: parsed.error.flatten() });
    }

    await request.store!.batchUpdateScheduleTasks(projectId, parsed.data.updates);
    const payload = await buildWorkspaceResponse(request.store!, projectId);
    if (!payload) {
      return reply.code(404).send({ message: "Project workspace not found" });
    }
    return payload;
  });

  // ── Schedule Dependency routes ──────────────────────────────────────

  app.post("/projects/:projectId/schedule-dependencies", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const parsed = createDependencySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ message: "Invalid dependency payload", issues: parsed.error.flatten() });
    }

    await request.store!.createDependency(projectId, parsed.data satisfies CreateDependencyInput);
    const payload = await buildWorkspaceResponse(request.store!, projectId);
    if (!payload) {
      return reply.code(404).send({ message: "Project workspace not found" });
    }
    reply.code(201);
    return payload;
  });

  app.delete("/projects/:projectId/schedule-dependencies/:depId", async (request, reply) => {
    const { projectId, depId } = request.params as { projectId: string; depId: string };
    await request.store!.deleteDependency(projectId, depId);
    const payload = await buildWorkspaceResponse(request.store!, projectId);
    if (!payload) {
      return reply.code(404).send({ message: "Project workspace not found" });
    }
    return payload;
  });

  // ── Schedule Baseline routes ────────────────────────────────────────

  app.post("/projects/:projectId/schedule/save-baseline", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    await request.store!.saveBaseline(projectId);
    const payload = await buildWorkspaceResponse(request.store!, projectId);
    if (!payload) {
      return reply.code(404).send({ message: "Project workspace not found" });
    }
    return payload;
  });

  app.delete("/projects/:projectId/schedule/clear-baseline", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    await request.store!.clearBaseline(projectId);
    const payload = await buildWorkspaceResponse(request.store!, projectId);
    if (!payload) {
      return reply.code(404).send({ message: "Project workspace not found" });
    }
    return payload;
  });

  // ── Modifier routes ────────────────────────────────────────────────

  app.get("/projects/:projectId/modifiers", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const project = await request.store!.getProject(projectId);
    if (!project) {
      return reply.code(404).send({ message: "Project not found" });
    }
    return request.store!.listModifiers(projectId);
  });

  app.post("/projects/:projectId/modifiers", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const parsed = createModifierSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({
        message: "Invalid modifier payload",
        issues: parsed.error.flatten()
      });
    }

    const workspace = await request.store!.getWorkspace(projectId);
    if (!workspace) {
      return reply.code(404).send({ message: "Project workspace not found" });
    }

    await request.store!.createModifier(projectId, workspace.currentRevision.id, parsed.data satisfies CreateModifierInput);
    const payload = await buildWorkspaceResponse(request.store!, projectId);
    if (!payload) {
      return reply.code(404).send({ message: "Project workspace not found" });
    }
    reply.code(201);
    return payload;
  });

  app.patch("/projects/:projectId/modifiers/:modifierId", async (request, reply) => {
    const { projectId, modifierId } = request.params as { projectId: string; modifierId: string };
    const parsed = modifierPatchSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({
        message: "Invalid modifier payload",
        issues: parsed.error.flatten()
      });
    }

    await request.store!.updateModifier(projectId, modifierId, parsed.data satisfies ModifierPatchInput);
    const payload = await buildWorkspaceResponse(request.store!, projectId);
    if (!payload) {
      return reply.code(404).send({ message: "Project workspace not found" });
    }
    return payload;
  });

  app.delete("/projects/:projectId/modifiers/:modifierId", async (request, reply) => {
    const { projectId, modifierId } = request.params as { projectId: string; modifierId: string };
    await request.store!.deleteModifier(projectId, modifierId);
    const payload = await buildWorkspaceResponse(request.store!, projectId);
    if (!payload) {
      return reply.code(404).send({ message: "Project workspace not found" });
    }
    return payload;
  });

  // ── Condition routes ───────────────────────────────────────────────

  app.get("/conditions/library", async (request) => request.store!.listConditionLibrary());

  app.post("/conditions/library", async (request) => {
    const { type, value } = request.body as { type: string; value: string };
    if (!type || !value) throw new Error("type and value are required");
    return request.store!.createConditionLibraryEntry({ type, value });
  });

  app.delete("/conditions/library/:entryId", async (request) => {
    const { entryId } = request.params as { entryId: string };
    return request.store!.deleteConditionLibraryEntry(entryId);
  });

  app.get("/projects/:projectId/conditions", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const project = await request.store!.getProject(projectId);
    if (!project) {
      return reply.code(404).send({ message: "Project not found" });
    }
    return request.store!.listConditions(projectId);
  });

  app.post("/projects/:projectId/conditions", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const parsed = createConditionSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({
        message: "Invalid condition payload",
        issues: parsed.error.flatten()
      });
    }

    const workspace = await request.store!.getWorkspace(projectId);
    if (!workspace) {
      return reply.code(404).send({ message: "Project workspace not found" });
    }

    await request.store!.createCondition(projectId, workspace.currentRevision.id, parsed.data satisfies CreateConditionInput);
    const payload = await buildWorkspaceResponse(request.store!, projectId);
    if (!payload) {
      return reply.code(404).send({ message: "Project workspace not found" });
    }
    reply.code(201);
    return payload;
  });

  app.patch("/projects/:projectId/conditions/:conditionId", async (request, reply) => {
    const { projectId, conditionId } = request.params as { projectId: string; conditionId: string };
    const parsed = conditionPatchSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({
        message: "Invalid condition payload",
        issues: parsed.error.flatten()
      });
    }

    await request.store!.updateCondition(projectId, conditionId, parsed.data satisfies ConditionPatchInput);
    const payload = await buildWorkspaceResponse(request.store!, projectId);
    if (!payload) {
      return reply.code(404).send({ message: "Project workspace not found" });
    }
    return payload;
  });

  app.delete("/projects/:projectId/conditions/:conditionId", async (request, reply) => {
    const { projectId, conditionId } = request.params as { projectId: string; conditionId: string };
    await request.store!.deleteCondition(projectId, conditionId);
    const payload = await buildWorkspaceResponse(request.store!, projectId);
    if (!payload) {
      return reply.code(404).send({ message: "Project workspace not found" });
    }
    return payload;
  });

  app.post("/projects/:projectId/conditions/reorder", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const parsed = reorderSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({
        message: "Invalid reorder payload",
        issues: parsed.error.flatten()
      });
    }

    const workspace = await request.store!.getWorkspace(projectId);
    if (!workspace) {
      return reply.code(404).send({ message: "Project workspace not found" });
    }

    await request.store!.reorderConditions(projectId, workspace.currentRevision.id, parsed.data.orderedIds);
    const payload = await buildWorkspaceResponse(request.store!, projectId);
    if (!payload) {
      return reply.code(404).send({ message: "Project workspace not found" });
    }
    return payload;
  });

  // ── Additional Line Item routes ────────────────────────────────────

  app.get("/projects/:projectId/ali", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const project = await request.store!.getProject(projectId);
    if (!project) {
      return reply.code(404).send({ message: "Project not found" });
    }
    return request.store!.listAdditionalLineItems(projectId);
  });

  app.post("/projects/:projectId/ali", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const parsed = createAliSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({
        message: "Invalid additional line item payload",
        issues: parsed.error.flatten()
      });
    }

    const workspace = await request.store!.getWorkspace(projectId);
    if (!workspace) {
      return reply.code(404).send({ message: "Project workspace not found" });
    }

    await request.store!.createAdditionalLineItem(projectId, workspace.currentRevision.id, parsed.data satisfies CreateAdditionalLineItemInput);
    const payload = await buildWorkspaceResponse(request.store!, projectId);
    if (!payload) {
      return reply.code(404).send({ message: "Project workspace not found" });
    }
    reply.code(201);
    return payload;
  });

  app.patch("/projects/:projectId/ali/:aliId", async (request, reply) => {
    const { projectId, aliId } = request.params as { projectId: string; aliId: string };
    const parsed = aliPatchSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({
        message: "Invalid additional line item payload",
        issues: parsed.error.flatten()
      });
    }

    await request.store!.updateAdditionalLineItem(projectId, aliId, parsed.data satisfies AdditionalLineItemPatchInput);
    const payload = await buildWorkspaceResponse(request.store!, projectId);
    if (!payload) {
      return reply.code(404).send({ message: "Project workspace not found" });
    }
    return payload;
  });

  app.delete("/projects/:projectId/ali/:aliId", async (request, reply) => {
    const { projectId, aliId } = request.params as { projectId: string; aliId: string };
    await request.store!.deleteAdditionalLineItem(projectId, aliId);
    const payload = await buildWorkspaceResponse(request.store!, projectId);
    if (!payload) {
      return reply.code(404).send({ message: "Project workspace not found" });
    }
    return payload;
  });

  // ── Revision routes ────────────────────────────────────────────────

  app.post("/projects/:projectId/revisions", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const workspace = await request.store!.getWorkspace(projectId);
    if (!workspace) {
      return reply.code(404).send({ message: "Project workspace not found" });
    }

    await request.store!.createRevision(projectId, workspace.quote.id);
    const payload = await buildWorkspaceResponse(request.store!, projectId);
    if (!payload) {
      return reply.code(404).send({ message: "Project workspace not found" });
    }
    reply.code(201);
    return payload;
  });

  app.delete("/projects/:projectId/revisions/:revisionId", async (request, reply) => {
    const { projectId, revisionId } = request.params as { projectId: string; revisionId: string };
    await request.store!.deleteRevision(projectId, revisionId);
    const payload = await buildWorkspaceResponse(request.store!, projectId);
    if (!payload) {
      return reply.code(404).send({ message: "Project workspace not found" });
    }
    return payload;
  });

  app.post("/projects/:projectId/revisions/:revisionId/activate", async (request, reply) => {
    const { projectId, revisionId } = request.params as { projectId: string; revisionId: string };
    await request.store!.switchRevision(projectId, revisionId);
    const payload = await buildWorkspaceResponse(request.store!, projectId);
    if (!payload) {
      return reply.code(404).send({ message: "Project workspace not found" });
    }
    return payload;
  });

  app.post("/projects/:projectId/copy", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const result = await request.store!.copyQuote(projectId);
    const payload = await buildWorkspaceResponse(request.store!, result.project.id);
    if (!payload) {
      return reply.code(404).send({ message: "Project workspace not found" });
    }
    reply.code(201);
    return payload;
  });

  // ── Quote-level patch ──────────────────────────────────────────────

  app.patch("/projects/:projectId/quote", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const parsed = quotePatchSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({
        message: "Invalid quote payload",
        issues: parsed.error.flatten()
      });
    }

    await request.store!.updateQuote(projectId, parsed.data satisfies QuotePatchInput);
    const payload = await buildWorkspaceResponse(request.store!, projectId);
    if (!payload) {
      return reply.code(404).send({
        message: "Project workspace not found"
      });
    }
    return payload;
  });

  // ── Make revision zero ────────────────────────────────────────────

  app.post("/projects/:projectId/make-revision-zero", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    await request.store!.makeCurrentRevisionZero(projectId);
    const payload = await buildWorkspaceResponse(request.store!, projectId);
    if (!payload) {
      return reply.code(404).send({
        message: "Project workspace not found"
      });
    }
    return payload;
  });

  // ── Activity routes ────────────────────────────────────────────────

  app.get("/projects/:projectId/activity", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const project = await request.store!.getProject(projectId);
    if (!project) {
      return reply.code(404).send({ message: "Project not found" });
    }
    return request.store!.listActivities(projectId);
  });

  // ── Report Section routes ──────────────────────────────────────────

  app.get("/projects/:projectId/report-sections", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const project = await request.store!.getProject(projectId);
    if (!project) {
      return reply.code(404).send({ message: "Project not found" });
    }
    return request.store!.listReportSections(projectId);
  });

  app.post("/projects/:projectId/report-sections", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const parsed = createReportSectionSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({
        message: "Invalid report section payload",
        issues: parsed.error.flatten()
      });
    }

    const workspace = await request.store!.getWorkspace(projectId);
    if (!workspace) {
      return reply.code(404).send({ message: "Project workspace not found" });
    }

    await request.store!.createReportSection(projectId, workspace.currentRevision.id, parsed.data satisfies CreateReportSectionInput);
    const payload = await buildWorkspaceResponse(request.store!, projectId);
    if (!payload) {
      return reply.code(404).send({ message: "Project workspace not found" });
    }
    reply.code(201);
    return payload;
  });

  app.patch("/projects/:projectId/report-sections/:sectionId", async (request, reply) => {
    const { projectId, sectionId } = request.params as { projectId: string; sectionId: string };
    const parsed = reportSectionPatchSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({
        message: "Invalid report section payload",
        issues: parsed.error.flatten()
      });
    }

    await request.store!.updateReportSection(projectId, sectionId, parsed.data satisfies ReportSectionPatchInput);
    const payload = await buildWorkspaceResponse(request.store!, projectId);
    if (!payload) {
      return reply.code(404).send({ message: "Project workspace not found" });
    }
    return payload;
  });

  app.delete("/projects/:projectId/report-sections/:sectionId", async (request, reply) => {
    const { projectId, sectionId } = request.params as { projectId: string; sectionId: string };
    await request.store!.deleteReportSection(projectId, sectionId);
    const payload = await buildWorkspaceResponse(request.store!, projectId);
    if (!payload) {
      return reply.code(404).send({ message: "Project workspace not found" });
    }
    return payload;
  });

  app.post("/projects/:projectId/report-sections/reorder", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const parsed = reorderSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({
        message: "Invalid reorder payload",
        issues: parsed.error.flatten()
      });
    }

    const workspace = await request.store!.getWorkspace(projectId);
    if (!workspace) {
      return reply.code(404).send({ message: "Project workspace not found" });
    }

    await request.store!.reorderReportSections(projectId, workspace.currentRevision.id, parsed.data.orderedIds);
    const payload = await buildWorkspaceResponse(request.store!, projectId);
    if (!payload) {
      return reply.code(404).send({ message: "Project workspace not found" });
    }
    return payload;
  });

  // ── Status route ───────────────────────────────────────────────────

  app.patch("/projects/:projectId/status", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const parsed = statusPatchSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({
        message: "Invalid status payload",
        issues: parsed.error.flatten()
      });
    }

    await request.store!.updateProjectStatus(projectId, parsed.data satisfies StatusPatchInput);
    const payload = await buildWorkspaceResponse(request.store!, projectId);
    if (!payload) {
      return reply.code(404).send({ message: "Project workspace not found" });
    }
    return payload;
  });

  app.get("/packages/:packageId", async (request, reply) => {
    const { packageId } = request.params as { packageId: string };
    const packageRecord = await request.store!.getPackage(packageId);

    if (!packageRecord) {
      return reply.code(404).send({
        message: "Package not found"
      });
    }

    return packageRecord;
  });

  app.get("/jobs/:jobId", async (request, reply) => {
    const { jobId } = request.params as { jobId: string };
    const job = await request.store!.getJob(jobId);

    if (!job) {
      return reply.code(404).send({
        message: "Job not found"
      });
    }

    return job;
  });

  app.get("/entity-categories", async (request) => request.store!.listEntityCategories());

  app.post("/entity-categories", async (request, reply) => {
    const body = request.body as { name: string; entityType: string; [key: string]: unknown };
    if (!body.name || !body.entityType) {
      return reply.code(400).send({ message: "name and entityType are required" });
    }
    try {
      const cat = await request.store!.createEntityCategory(body);
      reply.code(201);
      return cat;
    } catch (error) {
      return reply.code(400).send({ message: error instanceof Error ? error.message : "Failed to create category" });
    }
  });

  app.patch("/entity-categories/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const patch = request.body as Record<string, unknown>;
    try {
      return await request.store!.updateEntityCategory(id, patch);
    } catch (error) {
      return reply.code(400).send({ message: error instanceof Error ? error.message : "Failed to update category" });
    }
  });

  app.delete("/entity-categories/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      return await request.store!.deleteEntityCategory(id);
    } catch (error) {
      return reply.code(400).send({ message: error instanceof Error ? error.message : "Failed to delete category" });
    }
  });

  app.post("/entity-categories/reorder", async (request) => {
    const { orderedIds } = request.body as { orderedIds: string[] };
    await request.store!.reorderEntityCategories(orderedIds);
    return { ok: true };
  });

  // ── Customers ──────────────────────────────────────────────────────────

  app.get("/customers", async (request) => {
    const url = new URL(request.url, "http://localhost");
    const q = url.searchParams.get("q");
    if (q) return request.store!.searchCustomers(q);
    return request.store!.listCustomers();
  });

  app.post("/customers", async (request, reply) => {
    const body = request.body as { name: string; [key: string]: unknown };
    if (!body.name) {
      return reply.code(400).send({ message: "name is required" });
    }
    try {
      const customer = await request.store!.createCustomer(body);
      reply.code(201);
      return customer;
    } catch (error) {
      return reply.code(400).send({ message: error instanceof Error ? error.message : "Failed to create customer" });
    }
  });

  app.get("/customers/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const customer = await request.store!.getCustomerWithContacts(id);
    if (!customer) return reply.code(404).send({ message: "Customer not found" });
    return customer;
  });

  app.patch("/customers/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const patch = request.body as Record<string, unknown>;
    try {
      return await request.store!.updateCustomer(id, patch);
    } catch (error) {
      return reply.code(400).send({ message: error instanceof Error ? error.message : "Failed to update customer" });
    }
  });

  app.delete("/customers/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      return await request.store!.deleteCustomer(id);
    } catch (error) {
      return reply.code(400).send({ message: error instanceof Error ? error.message : "Failed to delete customer" });
    }
  });

  // ── Customer Contacts ─────────────────────────────────────────────────

  app.get("/customers/:id/contacts", async (request) => {
    const { id } = request.params as { id: string };
    return request.store!.listCustomerContacts(id);
  });

  app.post("/customers/:id/contacts", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { name: string; [key: string]: unknown };
    if (!body.name) {
      return reply.code(400).send({ message: "name is required" });
    }
    try {
      const contact = await request.store!.createCustomerContact(id, body);
      reply.code(201);
      return contact;
    } catch (error) {
      return reply.code(400).send({ message: error instanceof Error ? error.message : "Failed to create contact" });
    }
  });

  app.patch("/customers/:customerId/contacts/:contactId", async (request, reply) => {
    const { contactId } = request.params as { customerId: string; contactId: string };
    const patch = request.body as Record<string, unknown>;
    try {
      return await request.store!.updateCustomerContact(contactId, patch);
    } catch (error) {
      return reply.code(400).send({ message: error instanceof Error ? error.message : "Failed to update contact" });
    }
  });

  app.delete("/customers/:customerId/contacts/:contactId", async (request, reply) => {
    const { contactId } = request.params as { customerId: string; contactId: string };
    try {
      return await request.store!.deleteCustomerContact(contactId);
    } catch (error) {
      return reply.code(400).send({ message: error instanceof Error ? error.message : "Failed to delete contact" });
    }
  });

  // ── Departments ───────────────────────────────────────────────────────

  app.get("/departments", async (request) => request.store!.listDepartments());

  app.post("/departments", async (request, reply) => {
    const body = request.body as { name: string; [key: string]: unknown };
    if (!body.name) {
      return reply.code(400).send({ message: "name is required" });
    }
    try {
      const dept = await request.store!.createDepartment(body);
      reply.code(201);
      return dept;
    } catch (error) {
      return reply.code(400).send({ message: error instanceof Error ? error.message : "Failed to create department" });
    }
  });

  app.patch("/departments/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const patch = request.body as Record<string, unknown>;
    try {
      return await request.store!.updateDepartment(id, patch);
    } catch (error) {
      return reply.code(400).send({ message: error instanceof Error ? error.message : "Failed to update department" });
    }
  });

  app.delete("/departments/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      return await request.store!.deleteDepartment(id);
    } catch (error) {
      return reply.code(400).send({ message: error instanceof Error ? error.message : "Failed to delete department" });
    }
  });

  // ── Catalogs ──────────────────────────────────────────────────────────

  app.get("/catalogs", async (request) => request.store!.listCatalogs());

  app.post("/catalogs", async (request, reply) => {
    const parsed = createCatalogSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ message: "Invalid catalog payload", issues: parsed.error.flatten() });
    }
    const catalog = await request.store!.createCatalog(parsed.data satisfies CreateCatalogInput);
    reply.code(201);
    return catalog;
  });

  app.patch("/catalogs/:catalogId", async (request, reply) => {
    const { catalogId } = request.params as { catalogId: string };
    const parsed = catalogPatchSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ message: "Invalid catalog payload", issues: parsed.error.flatten() });
    }
    try {
      return await request.store!.updateCatalog(catalogId, parsed.data satisfies CatalogPatchInput);
    } catch {
      return reply.code(404).send({ message: "Catalog not found" });
    }
  });

  app.delete("/catalogs/:catalogId", async (request, reply) => {
    const { catalogId } = request.params as { catalogId: string };
    try {
      return await request.store!.deleteCatalog(catalogId);
    } catch {
      return reply.code(404).send({ message: "Catalog not found" });
    }
  });

  app.get("/catalogs/:catalogId/items", async (request) => {
    const { catalogId } = request.params as { catalogId: string };
    return request.store!.listCatalogItems(catalogId);
  });

  app.post("/catalogs/:catalogId/items", async (request, reply) => {
    const { catalogId } = request.params as { catalogId: string };
    const parsed = createCatalogItemSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ message: "Invalid catalog item payload", issues: parsed.error.flatten() });
    }
    try {
      const item = await request.store!.createCatalogItem(catalogId, parsed.data satisfies CreateCatalogItemInput);
      reply.code(201);
      return item;
    } catch {
      return reply.code(404).send({ message: "Catalog not found" });
    }
  });

  app.patch("/catalogs/:catalogId/items/:itemId", async (request, reply) => {
    const { itemId } = request.params as { catalogId: string; itemId: string };
    const parsed = catalogItemPatchSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ message: "Invalid catalog item payload", issues: parsed.error.flatten() });
    }
    try {
      return await request.store!.updateCatalogItem(itemId, parsed.data satisfies CatalogItemPatchInput);
    } catch {
      return reply.code(404).send({ message: "Catalog item not found" });
    }
  });

  app.delete("/catalogs/:catalogId/items/:itemId", async (request, reply) => {
    const { itemId } = request.params as { catalogId: string; itemId: string };
    try {
      return await request.store!.deleteCatalogItem(itemId);
    } catch {
      return reply.code(404).send({ message: "Catalog item not found" });
    }
  });

  app.get("/catalogs/search", async (request) => {
    const query = z.object({
      q: z.string().default(""),
      catalogId: z.string().optional()
    }).safeParse(request.query ?? {});
    if (!query.success) return [];
    return request.store!.searchCatalogItems(query.data.q, query.data.catalogId);
  });

  app.get("/catalog/rates", async (request) => request.store!.listCatalogRates());

  // ── File Node routes ──────────────────────────────────────────────

  app.get("/projects/:projectId/files", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const project = await request.store!.getProject(projectId);
    if (!project) return reply.code(404).send({ message: "Project not found" });
    const query = z.object({ parentId: z.string().optional(), scope: z.string().optional() }).safeParse(request.query ?? {});
    const parentId = query.success ? query.data.parentId : undefined;
    const scope = query.success ? query.data.scope : undefined;
    return request.store!.listFileNodes(projectId, parentId, scope);
  });

  app.get("/projects/:projectId/files/tree", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const project = await request.store!.getProject(projectId);
    if (!project) return reply.code(404).send({ message: "Project not found" });
    const query = request.query as { scope?: string };
    return request.store!.getFileTree(projectId, query.scope);
  });

  app.post("/projects/:projectId/files", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const parsed = createFileNodeSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ message: "Invalid file node payload", issues: parsed.error.flatten() });
    }
    try {
      const node = await request.store!.createFileNode(projectId, parsed.data satisfies CreateFileNodeInput);
      reply.code(201);
      return node;
    } catch {
      return reply.code(404).send({ message: "Project or parent not found" });
    }
  });

  app.patch("/projects/:projectId/files/:nodeId", async (request, reply) => {
    const { nodeId } = request.params as { projectId: string; nodeId: string };
    const parsed = fileNodePatchSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ message: "Invalid file node payload", issues: parsed.error.flatten() });
    }
    try {
      return await request.store!.updateFileNode(nodeId, parsed.data satisfies FileNodePatchInput);
    } catch {
      return reply.code(404).send({ message: "File node not found" });
    }
  });

  app.delete("/projects/:projectId/files/:nodeId", async (request, reply) => {
    const { nodeId } = request.params as { projectId: string; nodeId: string };
    try {
      return await request.store!.deleteFileNode(nodeId);
    } catch {
      return reply.code(404).send({ message: "File node not found" });
    }
  });

  // ── File Upload (any file type) ─────────────────────────────────────────

  app.post("/projects/:projectId/files/upload", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const project = await request.store!.getProject(projectId);
    if (!project) return reply.code(404).send({ message: "Project not found" });

    const fields: Record<string, string> = {};
    let fileBuffer: Buffer | null = null;
    let originalFileName = "";
    let fileSize = 0;
    let fileSeen = false;

    for await (const part of request.parts()) {
      if (part.type === "file") {
        if (fileSeen) {
          return reply.code(400).send({ message: "Only one file per upload" });
        }
        fileSeen = true;
        originalFileName = part.filename || "unnamed";
        fileBuffer = await part.toBuffer();
        fileSize = fileBuffer.length;
      } else {
        fields[part.fieldname] = Array.isArray(part.value) ? part.value.join("") : String(part.value);
      }
    }

    if (!fileSeen || !fileBuffer) {
      return reply.code(400).send({ message: "A file is required" });
    }

    const fileExt = path.extname(originalFileName).replace(/^\./, "").toLowerCase();
    const parentId = fields.parentId || null;

    // Create the FileNode first to get an ID for the storage path
    const node = await request.store!.createFileNode(projectId, {
      parentId,
      name: originalFileName,
      type: "file",
      fileType: fileExt || undefined,
      size: fileSize,
      metadata: {},
    });

    // Write file to disk
    const relPath = relativeProjectFilePath(projectId, node.id, originalFileName);
    const absPath = resolveApiPath(relPath);
    await mkdir(path.dirname(absPath), { recursive: true });
    const { writeFile } = await import("node:fs/promises");
    await writeFile(absPath, fileBuffer);

    // Update node with storagePath
    const updated = await request.store!.updateFileNode(node.id, { storagePath: relPath });

    reply.code(201);
    return updated;
  });

  // ── File Download ──────────────────────────────────────────────────────

  const MIME_MAP: Record<string, string> = {
    pdf: "application/pdf",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    bmp: "image/bmp",
    tif: "image/tiff",
    tiff: "image/tiff",
    svg: "image/svg+xml",
    txt: "text/plain",
    md: "text/markdown",
    csv: "text/csv",
    tsv: "text/tab-separated-values",
    json: "application/json",
    xml: "application/xml",
    yaml: "application/x-yaml",
    yml: "application/x-yaml",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    xls: "application/vnd.ms-excel",
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    zip: "application/zip",
  };

  app.get("/projects/:projectId/files/:nodeId/download", async (request, reply) => {
    const { projectId, nodeId } = request.params as { projectId: string; nodeId: string };
    const node = await request.store!.getFileNode(nodeId);
    if (!node || node.projectId !== projectId) {
      return reply.code(404).send({ message: "File not found" });
    }
    if (node.type === "directory") {
      return reply.code(400).send({ message: "Cannot download a directory" });
    }
    if (!node.storagePath) {
      return reply.code(404).send({ message: "File has no stored content" });
    }

    const absPath = resolveApiPath(node.storagePath);
    try {
      await access(absPath);
    } catch {
      return reply.code(404).send({ message: "File not found on disk" });
    }

    const ext = path.extname(node.name).replace(/^\./, "").toLowerCase();
    const mime = MIME_MAP[ext] || "application/octet-stream";
    const inline = request.query && (request.query as Record<string, string>).inline === "1";

    reply.header("Content-Type", mime);
    reply.header("Content-Disposition", `${inline ? "inline" : "attachment"}; filename="${sanitizeFileName(node.name)}"`);
    return reply.send(createReadStream(absPath));
  });

  // ── Source Document Download ───────────────────────────────────────────

  app.get("/projects/:projectId/documents/:docId/download", async (request, reply) => {
    const { projectId, docId } = request.params as { projectId: string; docId: string };
    const doc = await request.store!.getDocument(projectId, docId);
    if (!doc) {
      return reply.code(404).send({ message: "Document not found" });
    }

    // Try to serve the original file from storagePath
    if (doc.storagePath) {
      const absPath = resolveApiPath(doc.storagePath);
      try {
        await access(absPath);
        const ext = path.extname(doc.fileName).replace(/^\./, "").toLowerCase();
        const mime = MIME_MAP[ext] || "application/octet-stream";
        const inline = request.query && (request.query as Record<string, string>).inline === "1";
        reply.header("Content-Type", mime);
        reply.header("Content-Disposition", `${inline ? "inline" : "attachment"}; filename="${sanitizeFileName(doc.fileName)}"`);
        return reply.send(createReadStream(absPath));
      } catch {
        // File not on disk — fall through to extracted text
      }
    }

    // Fallback: serve extracted text as plain text
    if (doc.extractedText) {
      reply.header("Content-Type", "text/plain; charset=utf-8");
      reply.header("Content-Disposition", `inline; filename="${sanitizeFileName(doc.fileName)}.txt"`);
      return reply.send(doc.extractedText);
    }

    return reply.code(404).send({ message: "No downloadable content for this document" });
  });

  // ── Upload from URL (for agent use) ────────────────────────────────────

  app.post("/projects/:projectId/files/upload-from-url", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const project = await request.store!.getProject(projectId);
    if (!project) return reply.code(404).send({ message: "Project not found" });

    const body = z.object({
      url: z.string().url(),
      name: z.string().optional(),
      parentId: z.string().nullable().optional(),
    }).safeParse(request.body ?? {});

    if (!body.success) {
      return reply.code(400).send({ message: "Invalid payload", issues: body.error.flatten() });
    }

    const { url, name, parentId } = body.data;

    try {
      const response = await fetch(url);
      if (!response.ok) {
        return reply.code(400).send({ message: `Failed to fetch URL: ${response.status} ${response.statusText}` });
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      const urlPath = new URL(url).pathname;
      const fileName = name || path.basename(urlPath) || "downloaded-file";
      const fileExt = path.extname(fileName).replace(/^\./, "").toLowerCase();

      const node = await request.store!.createFileNode(projectId, {
        parentId: parentId ?? null,
        name: fileName,
        type: "file",
        fileType: fileExt || undefined,
        size: buffer.length,
        metadata: { sourceUrl: url },
      });

      const relPath = relativeProjectFilePath(projectId, node.id, fileName);
      const absPath = resolveApiPath(relPath);
      await mkdir(path.dirname(absPath), { recursive: true });
      const { writeFile } = await import("node:fs/promises");
      await writeFile(absPath, buffer);

      const updated = await request.store!.updateFileNode(node.id, { storagePath: relPath });
      reply.code(201);
      return updated;
    } catch (err) {
      return reply.code(500).send({ message: `Upload from URL failed: ${err instanceof Error ? err.message : String(err)}` });
    }
  });

  app.get("/ai/runs", async (request) => {
    const query = z.object({
      projectId: z.string().optional()
    }).safeParse(request.query ?? {});

    if (!query.success) {
      return request.store!.listAiRuns();
    }

    return request.store!.listAiRuns(query.data.projectId);
  });

  app.post("/projects/:projectId/packages/upload", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const result = await ingestUploadForProject(request.store!, request, reply, projectId);

    return result;
  });

  app.post("/ingestion/package", async (request, reply) => {
    return ingestUploadForProject(request.store!, request, reply);
  });

  app.post("/projects/:projectId/ingest", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const parsed = ingestBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({
        message: "Invalid ingest payload",
        issues: parsed.error.flatten()
      });
    }

    const project = await request.store!.getProject(projectId);
    if (!project) {
      return reply.code(404).send({
        message: "Project not found"
      });
    }

    const packages = await request.store!.listPackages(projectId);
    const targetPackage =
      parsed.data.packageId ? packages.find((entry: any) => entry.id === parsed.data.packageId) : packages[0];

    if (!targetPackage) {
      return reply.code(404).send({
        message: "No package available to ingest"
      });
    }

    const outcome = await request.store!.ingestUploadedPackage(targetPackage.id);
    return buildPackageResponse(outcome);
  });

  // -------------------------------------------------------------------------
  // PDF generation
  // -------------------------------------------------------------------------

  app.get("/projects/:projectId/pdf/:templateType", async (request, reply) => {
    const { projectId, templateType } = request.params as {
      projectId: string;
      templateType: string;
    };
    const validTypes = ["main", "backup", "sitecopy", "closeout", "schedule"];
    if (!validTypes.includes(templateType)) {
      return reply
        .code(400)
        .send({ message: `Invalid template type. Must be one of: ${validTypes.join(", ")}` });
    }
    const workspace = await request.store!.getWorkspace(projectId);
    if (!workspace) {
      return reply.code(404).send({ message: "Project not found" });
    }
    if (templateType === "schedule") {
      const schedulePdfData = buildSchedulePdfData(workspace);
      const html = generateSchedulePdfHtml(schedulePdfData);
      const { buffer, contentType } = await generatePdfBuffer(html);
      return reply.type(contentType).send(buffer);
    }

    const reportSections = await request.store!.listReportSections(projectId);
    const pdfData = buildPdfDataPackage(workspace, reportSections);

    // Parse layout options from query param if present
    let layoutOptions: Partial<PdfLayoutOptions> | undefined;
    const layoutParam = (request.query as Record<string, string>)?.layout;
    if (layoutParam) {
      try { layoutOptions = JSON.parse(decodeURIComponent(layoutParam)); } catch { /* ignore */ }
    }

    const html = generatePdfHtml(pdfData, templateType, layoutOptions);
    const { buffer, contentType } = await generatePdfBuffer(html, layoutOptions);
    return reply.type(contentType).send(buffer);
  });

  // -------------------------------------------------------------------------
  // Send quote email
  // -------------------------------------------------------------------------

  app.post("/projects/:projectId/send-quote", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const body = request.body as { contacts?: string[]; message?: string } | null;
    const contacts = body?.contacts ?? [];
    const message = body?.message ?? "";

    if (contacts.length === 0) {
      return reply.code(400).send({ message: "At least one contact email is required" });
    }

    const workspace = await request.store!.getWorkspace(projectId);
    if (!workspace) {
      return reply.code(404).send({ message: "Project not found" });
    }

    const quoteNumber = workspace.quote?.quoteNumber ?? projectId;
    const subject = `Quote ${quoteNumber} – ${workspace.currentRevision?.title ?? workspace.project?.name ?? ""}`;

    const result = await sendQuoteEmail({
      to: contacts,
      subject,
      message,
      quoteNumber,
    });

    await request.store!.logActivity(projectId, workspace.currentRevision?.id ?? null, "quote_sent", {
      recipients: contacts,
      quoteNumber,
    });

    return result;
  });

  // -------------------------------------------------------------------------
  // Delete project
  // -------------------------------------------------------------------------

  app.delete("/projects/:projectId", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const project = await request.store!.getProject(projectId);
    if (!project) {
      return reply.code(404).send({ message: "Project not found" });
    }

    return request.store!.deleteProject(projectId);
  });

  // -------------------------------------------------------------------------
  // AI endpoints
  // -------------------------------------------------------------------------

  app.post("/projects/:projectId/ai/description", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const workspace = await request.store!.getWorkspace(projectId);
    if (!workspace) {
      return reply.code(404).send({ message: "Project not found" });
    }
    const rev = workspace.currentRevision;
    const projectContext = `Project: ${workspace.project?.name ?? ""}\nClient: ${workspace.project?.clientName ?? ""}\nLocation: ${workspace.project?.location ?? ""}`;
    const description = await aiRewriteDescription(
      rev?.description ?? "",
      projectContext
    );
    return { description };
  });

  app.post("/projects/:projectId/ai/notes", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const workspace = await request.store!.getWorkspace(projectId);
    if (!workspace) {
      return reply.code(404).send({ message: "Project not found" });
    }
    const rev = workspace.currentRevision;
    const projectContext = `Project: ${workspace.project?.name ?? ""}\nClient: ${workspace.project?.clientName ?? ""}`;
    const notes = await aiRewriteNotes(rev?.notes ?? "", projectContext);
    return { notes };
  });

  app.post("/projects/:projectId/ai/phases", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const workspace = await request.store!.getWorkspace(projectId);
    if (!workspace) {
      return reply.code(404).send({ message: "Project not found" });
    }
    const rev = workspace.currentRevision;
    const allItems = (workspace.worksheets ?? []).flatMap(
      (ws: any) => ws.items ?? []
    );
    const phases = await aiSuggestPhases(rev?.description ?? "", allItems);
    return { phases };
  });

  app.post("/projects/:projectId/ai/phases/accept", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const body = request.body as {
      phases?: Array<{ number: string; name: string; description: string }>;
    } | null;
    const phases = body?.phases ?? [];

    const workspace = await request.store!.getWorkspace(projectId);
    if (!workspace) {
      return reply.code(404).send({ message: "Project not found" });
    }

    const revisionId = workspace.currentRevision?.id;
    if (!revisionId) {
      return reply.code(400).send({ message: "No active revision" });
    }

    for (const phase of phases) {
      await request.store!.createPhase(projectId, revisionId, {
        number: phase.number,
        name: phase.name,
        description: phase.description,
      });
    }

    await request.store!.logActivity(projectId, revisionId, "ai_phases_accepted", {
      phaseCount: phases.length,
    });

    const response = await buildWorkspaceResponse(request.store!, projectId);
    if (!response) {
      return reply.code(404).send({ message: "Failed to build workspace" });
    }
    return response;
  });

  app.post("/projects/:projectId/ai/equipment", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const workspace = await request.store!.getWorkspace(projectId);
    if (!workspace) {
      return reply.code(404).send({ message: "Project not found" });
    }
    const rev = workspace.currentRevision;
    const allItems = (workspace.worksheets ?? []).flatMap(
      (ws: any) => ws.items ?? []
    );
    const labourItems = allItems.filter(
      (i: any) =>
        i.category?.toLowerCase() === "labor" ||
        i.category?.toLowerCase() === "labour"
    );
    const equipment = await aiSuggestEquipment(
      rev?.description ?? "",
      labourItems
    );
    return { equipment };
  });

  app.post("/projects/:projectId/ai/equipment/accept", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const body = request.body as {
      equipment?: Array<{
        name: string;
        description: string;
        quantity: number;
        duration: number;
        estimatedCost: number;
      }>;
    } | null;
    const equipment = body?.equipment ?? [];

    const workspace = await request.store!.getWorkspace(projectId);
    if (!workspace) {
      return reply.code(404).send({ message: "Project not found" });
    }

    const revisionId = workspace.currentRevision?.id;
    if (!revisionId) {
      return reply.code(400).send({ message: "No active revision" });
    }

    // Find the first worksheet (or create one for equipment)
    const worksheets = workspace.worksheets ?? [];
    let targetWorksheetId = worksheets[0]?.id;
    if (!targetWorksheetId) {
      return reply.code(400).send({ message: "No worksheet available for equipment items" });
    }

    for (const item of equipment) {
      await request.store!.createWorksheetItem(projectId, targetWorksheetId, {
        category: "Equipment",
        entityType: "equipment",
        entityName: item.name,
        description: item.description,
        quantity: item.quantity,
        uom: "day",
        cost: item.estimatedCost,
        markup: 0,
        price: item.estimatedCost,
        laborHourReg: 0,
        laborHourOver: 0,
        laborHourDouble: 0,
      });
    }

    await request.store!.logActivity(projectId, revisionId, "ai_equipment_accepted", {
      equipmentCount: equipment.length,
    });

    const response = await buildWorkspaceResponse(request.store!, projectId);
    if (!response) {
      return reply.code(404).send({ message: "Failed to build workspace" });
    }
    return response;
  });

  // ── Job routes ─────────────────────────────────────────────────────

  const createJobSchema = z.object({
    name: z.string().min(1),
    foreman: z.string().optional(),
    projectManager: z.string().optional(),
    startDate: z.string().nullable().optional(),
    shipDate: z.string().nullable().optional(),
    poNumber: z.string().optional(),
    poIssuer: z.string().optional()
  });

  app.post("/projects/:projectId/jobs", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const parsed = createJobSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({
        message: "Invalid job payload",
        issues: parsed.error.flatten()
      });
    }

    const workspace = await request.store!.getWorkspace(projectId);
    if (!workspace) {
      return reply.code(404).send({ message: "Project workspace not found" });
    }

    const job = await request.store!.createJob(projectId, workspace.currentRevision.id, parsed.data satisfies CreateJobInput);
    reply.code(201);
    return job;
  });

  app.get("/jobs", async (request) => request.store!.listAllJobs());

  // ── Import BOM routes ─────────────────────────────────────────────

  app.post("/projects/:projectId/import-preview", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const project = await request.store!.getProject(projectId);
    if (!project) {
      return reply.code(404).send({ message: "Project not found" });
    }

    let csvText = "";
    let originalFileName = "import.csv";

    for await (const part of request.parts()) {
      if (part.type === "file") {
        originalFileName = part.filename || originalFileName;
        const chunks: Buffer[] = [];
        for await (const chunk of part.file) {
          chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
        }
        csvText = Buffer.concat(chunks).toString("utf8");
      }
    }

    if (!csvText) {
      return reply.code(400).send({ message: "No file uploaded" });
    }

    const parsed = request.store!.parseCSV(csvText);
    const fileId = `import-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    request.store!.storeImportPreview(fileId, parsed);

    return {
      headers: parsed.headers,
      sampleRows: parsed.rows.slice(0, 5),
      fileId
    };
  });

  const importProcessSchema = z.object({
    fileId: z.string().min(1),
    worksheetId: z.string().min(1),
    mapping: z.record(z.string())
  });

  app.post("/projects/:projectId/import-process", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const parsed = importProcessSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({
        message: "Invalid import process payload",
        issues: parsed.error.flatten()
      });
    }

    const project = await request.store!.getProject(projectId);
    if (!project) {
      return reply.code(404).send({ message: "Project not found" });
    }

    await request.store!.processImport(
      projectId,
      parsed.data.worksheetId,
      parsed.data.fileId,
      parsed.data.mapping
    );

    const payload = await buildWorkspaceResponse(request.store!, projectId);
    if (!payload) {
      return reply.code(404).send({ message: "Project workspace not found" });
    }

    return payload;
  });

  // ── Plugin Routes ──────────────────────────────────────────────────

  app.get("/plugins", async (request) => request.store!.listPlugins());

  app.get("/plugins/:pluginId", async (request, reply) => {
    const { pluginId } = request.params as { pluginId: string };
    const plugin = await request.store!.getPlugin(pluginId);
    if (!plugin) {
      return reply.code(404).send({ message: "Plugin not found" });
    }
    return plugin;
  });

  app.post("/plugins", async (request, reply) => {
    const body = request.body as CreatePluginInput;
    const plugin = await request.store!.createPlugin(body);
    reply.code(201);
    return plugin;
  });

  app.patch("/plugins/:pluginId", async (request, reply) => {
    const { pluginId } = request.params as { pluginId: string };
    const patch = request.body as PluginPatchInput;
    try {
      const plugin = await request.store!.updatePlugin(pluginId, patch);
      return plugin;
    } catch {
      return reply.code(404).send({ message: "Plugin not found" });
    }
  });

  app.delete("/plugins/:pluginId", async (request, reply) => {
    const { pluginId } = request.params as { pluginId: string };
    try {
      const plugin = await request.store!.deletePlugin(pluginId);
      return plugin;
    } catch {
      return reply.code(404).send({ message: "Plugin not found" });
    }
  });

  app.post("/plugins/:pluginId/execute", async (request, reply) => {
    const { pluginId } = request.params as { pluginId: string };
    const body = request.body as {
      toolId?: string; projectId: string; revisionId: string; input: Record<string, unknown>;
      worksheetId?: string; formState?: Record<string, unknown>; executedBy?: "user" | "agent"; agentSessionId?: string;
    };
    try {
      const execution = await request.store!.executePlugin(
        pluginId, body.toolId ?? pluginId, body.projectId, body.revisionId, body.input ?? {},
        { worksheetId: body.worksheetId, formState: body.formState, executedBy: body.executedBy, agentSessionId: body.agentSessionId },
      );
      reply.code(201);
      return execution;
    } catch (error) {
      return reply.code(400).send({ message: error instanceof Error ? error.message : "Execution failed" });
    }
  });

  // ── Plugin HTTP Fetch Proxy ──────────────────────────────────────
  // Allows plugins to make external HTTP requests via the server,
  // avoiding CORS issues and keeping API keys server-side in plugin config.

  app.post("/plugins/:pluginId/fetch", async (request, reply) => {
    const { pluginId } = request.params as { pluginId: string };
    const { url, method, headers, body: fetchBody, timeout } = request.body as {
      url: string;
      method?: string;
      headers?: Record<string, string>;
      body?: unknown;
      timeout?: number;
    };

    if (!url) return reply.code(400).send({ message: "url is required" });

    // Validate the plugin exists and is enabled
    const plugin = await request.store!.getPlugin(pluginId);
    if (!plugin) return reply.code(404).send({ message: "Plugin not found" });
    if (!plugin.enabled) return reply.code(403).send({ message: "Plugin is disabled" });

    // Check allowed domains from plugin config
    const allowedDomains = (plugin.config.allowedDomains as string[] | undefined) ?? [];
    if (allowedDomains.length > 0) {
      try {
        const parsed = new URL(url);
        const domainAllowed = allowedDomains.some(
          (d) => parsed.hostname === d || parsed.hostname.endsWith(`.${d}`)
        );
        if (!domainAllowed) {
          return reply.code(403).send({ message: `Domain ${parsed.hostname} not in plugin's allowed domains` });
        }
      } catch {
        return reply.code(400).send({ message: "Invalid URL" });
      }
    }

    // Merge plugin config headers (e.g., API keys) with request headers
    const configHeaders = (plugin.config.defaultHeaders as Record<string, string> | undefined) ?? {};
    const mergedHeaders: Record<string, string> = { ...configHeaders, ...headers };

    try {
      const controller = new AbortController();
      const fetchTimeout = Math.min(timeout ?? 30000, 60000);
      const timer = setTimeout(() => controller.abort(), fetchTimeout);

      const response = await fetch(url, {
        method: method ?? "GET",
        headers: mergedHeaders,
        body: fetchBody ? (typeof fetchBody === "string" ? fetchBody : JSON.stringify(fetchBody)) : undefined,
        signal: controller.signal,
      });
      clearTimeout(timer);

      const contentType = response.headers.get("content-type") ?? "";
      let responseBody: unknown;
      if (contentType.includes("application/json")) {
        responseBody = await response.json();
      } else {
        responseBody = await response.text();
      }

      return {
        status: response.status,
        statusText: response.statusText,
        headers: Object.fromEntries((response.headers as any).entries()),
        body: responseBody,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Fetch failed";
      return reply.code(502).send({ message: `External fetch failed: ${message}` });
    }
  });

  app.get("/projects/:projectId/plugin-executions", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const project = await request.store!.getProject(projectId);
    if (!project) {
      return reply.code(404).send({ message: "Project not found" });
    }
    return request.store!.listPluginExecutions(projectId);
  });

  // ── Knowledge Book Routes ──────────────────────────────────────────

  app.get("/knowledge/books", async (request) => {
    const { projectId } = (request.query ?? {}) as { projectId?: string };
    return request.store!.listKnowledgeBooks(projectId);
  });

  app.get("/knowledge/books/:bookId", async (request, reply) => {
    const { bookId } = request.params as { bookId: string };
    const book = await request.store!.getKnowledgeBook(bookId);
    if (!book) return reply.code(404).send({ message: "Knowledge book not found" });
    return book;
  });

  app.post("/knowledge/books", async (request, reply) => {
    const body = request.body as {
      name: string; description: string;
      category: string; scope: string;
      projectId?: string | null;
      sourceFileName: string; sourceFileSize: number;
    };
    const book = await request.store!.createKnowledgeBook(body as Parameters<PrismaApiStore["createKnowledgeBook"]>[0]);
    reply.code(201);
    return book;
  });

  app.patch("/knowledge/books/:bookId", async (request, reply) => {
    const { bookId } = request.params as { bookId: string };
    const patch = request.body as Record<string, unknown>;
    try {
      return await request.store!.updateKnowledgeBook(bookId, patch as Parameters<PrismaApiStore["updateKnowledgeBook"]>[1]);
    } catch {
      return reply.code(404).send({ message: "Knowledge book not found" });
    }
  });

  app.delete("/knowledge/books/:bookId", async (request, reply) => {
    const { bookId } = request.params as { bookId: string };
    try {
      return await request.store!.deleteKnowledgeBook(bookId);
    } catch {
      return reply.code(404).send({ message: "Knowledge book not found" });
    }
  });

  app.get("/knowledge/books/:bookId/chunks", async (request, reply) => {
    const { bookId } = request.params as { bookId: string };
    const book = await request.store!.getKnowledgeBook(bookId);
    if (!book) return reply.code(404).send({ message: "Knowledge book not found" });
    return request.store!.listKnowledgeChunks(bookId);
  });

  app.post("/knowledge/books/:bookId/chunks", async (request, reply) => {
    const { bookId } = request.params as { bookId: string };
    const body = request.body as { pageNumber?: number | null; sectionTitle: string; text: string; tokenCount?: number; order?: number };
    try {
      const chunk = await request.store!.createKnowledgeChunk(bookId, body);
      reply.code(201);
      return chunk;
    } catch {
      return reply.code(404).send({ message: "Knowledge book not found" });
    }
  });

  app.post("/knowledge/books/:bookId/chunks/batch", async (request, reply) => {
    const { bookId } = request.params as { bookId: string };
    const body = request.body as Array<{ pageNumber?: number | null; sectionTitle: string; text: string; tokenCount?: number; order?: number }>;
    const book = await request.store!.getKnowledgeBook(bookId);
    if (!book) return reply.code(404).send({ message: "Knowledge book not found" });
    const results = [];
    for (const item of body) {
      const chunk = await request.store!.createKnowledgeChunk(bookId, item);
      results.push(chunk);
    }
    reply.code(201);
    return results;
  });

  app.get("/knowledge/search", async (request) => {
    const { q, bookId, limit } = (request.query ?? {}) as { q?: string; bookId?: string; limit?: string };
    return request.store!.searchKnowledgeChunks(q ?? "", bookId, limit ? parseInt(limit, 10) : undefined);
  });

  // ── Knowledge Book File Serving ────────────────────────────────────

  app.get("/knowledge/books/:bookId/file", async (request, reply) => {
    const { bookId } = request.params as { bookId: string };
    const book = await request.store!.getKnowledgeBook(bookId);
    if (!book) return reply.code(404).send({ message: "Knowledge book not found" });
    if (!book.storagePath) return reply.code(404).send({ message: "No source file stored for this book" });

    const { resolveApiPath } = await import("./paths.js");
    const absPath = resolveApiPath(book.storagePath);
    try {
      await import("node:fs/promises").then((fs) => fs.access(absPath));
    } catch {
      return reply.code(404).send({ message: "Source file not found on disk" });
    }

    const ext = book.sourceFileName.split(".").pop()?.toLowerCase() ?? "";
    const MIME: Record<string, string> = {
      pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
      gif: "image/gif", webp: "image/webp", svg: "image/svg+xml", tiff: "image/tiff",
      txt: "text/plain", csv: "text/csv", json: "application/json",
      xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    };
    const contentType = MIME[ext] || "application/octet-stream";
    const inline = (request.query as { inline?: string })?.inline === "1";
    const disposition = inline ? "inline" : `attachment; filename="${book.sourceFileName}"`;

    const { createReadStream } = await import("node:fs");
    return reply
      .header("Content-Type", contentType)
      .header("Content-Disposition", disposition)
      .send(createReadStream(absPath));
  });

  app.get("/knowledge/books/:bookId/thumbnail", async (request, reply) => {
    const { bookId } = request.params as { bookId: string };
    const book = await request.store!.getKnowledgeBook(bookId);
    if (!book) return reply.code(404).send({ message: "Knowledge book not found" });
    if (!book.storagePath) return reply.code(404).send({ message: "No source file" });

    const { resolveApiPath } = await import("./paths.js");
    const { relativeKnowledgeBookThumbnailPath } = await import("./paths.js");
    const thumbRelPath = relativeKnowledgeBookThumbnailPath(bookId);
    const thumbAbsPath = resolveApiPath(thumbRelPath);

    // Return cached thumbnail if it exists
    try {
      await import("node:fs/promises").then((fs) => fs.access(thumbAbsPath));
      const { createReadStream } = await import("node:fs");
      return reply
        .header("Content-Type", "image/png")
        .header("Cache-Control", "public, max-age=86400")
        .send(createReadStream(thumbAbsPath));
    } catch {
      // Generate thumbnail
    }

    const sourceAbsPath = resolveApiPath(book.storagePath);
    const ext = book.sourceFileName.split(".").pop()?.toLowerCase() ?? "";

    if (ext === "pdf") {
      // Use pdftoppm to generate thumbnail from first page
      try {
        const { execSync } = await import("node:child_process");
        const { mkdir } = await import("node:fs/promises");
        await mkdir(path.dirname(thumbAbsPath), { recursive: true });
        execSync(
          `pdftoppm -f 1 -l 1 -png -r 150 -singlefile "${sourceAbsPath}" "${thumbAbsPath.replace(/\.png$/, "")}"`,
          { timeout: 15000 },
        );
        const { createReadStream } = await import("node:fs");
        return reply
          .header("Content-Type", "image/png")
          .header("Cache-Control", "public, max-age=86400")
          .send(createReadStream(thumbAbsPath));
      } catch {
        return reply.code(500).send({ message: "Thumbnail generation failed" });
      }
    } else if (["png", "jpg", "jpeg", "gif", "webp"].includes(ext)) {
      // For images, just serve the original
      const { createReadStream } = await import("node:fs");
      return reply
        .header("Content-Type", `image/${ext === "jpg" ? "jpeg" : ext}`)
        .header("Cache-Control", "public, max-age=86400")
        .send(createReadStream(sourceAbsPath));
    }

    return reply.code(404).send({ message: "No thumbnail available for this file type" });
  });

  // ── Dataset Routes ────────────────────────────────────────────────

  app.get("/datasets", async (request) => {
    const { projectId } = (request.query ?? {}) as { projectId?: string };
    return request.store!.listDatasets(projectId);
  });

  app.get("/datasets/:datasetId", async (request, reply) => {
    const { datasetId } = request.params as { datasetId: string };
    const dataset = await request.store!.getDataset(datasetId);
    if (!dataset) return reply.code(404).send({ message: "Dataset not found" });
    return dataset;
  });

  app.post("/datasets", async (request, reply) => {
    const body = request.body as Parameters<PrismaApiStore["createDataset"]>[0];
    const dataset = await request.store!.createDataset(body);
    reply.code(201);
    return dataset;
  });

  app.patch("/datasets/:datasetId", async (request, reply) => {
    const { datasetId } = request.params as { datasetId: string };
    const patch = request.body as Record<string, unknown>;
    try {
      return await request.store!.updateDataset(datasetId, patch as Parameters<PrismaApiStore["updateDataset"]>[1]);
    } catch {
      return reply.code(404).send({ message: "Dataset not found" });
    }
  });

  app.delete("/datasets/:datasetId", async (request, reply) => {
    const { datasetId } = request.params as { datasetId: string };
    try {
      return await request.store!.deleteDataset(datasetId);
    } catch {
      return reply.code(404).send({ message: "Dataset not found" });
    }
  });

  app.get("/datasets/:datasetId/rows", async (request, reply) => {
    const { datasetId } = request.params as { datasetId: string };
    const { filter, sort, limit, offset } = (request.query ?? {}) as { filter?: string; sort?: string; limit?: string; offset?: string };
    const dataset = await request.store!.getDataset(datasetId);
    if (!dataset) return reply.code(404).send({ message: "Dataset not found" });
    return request.store!.listDatasetRows(datasetId, filter, sort, limit ? parseInt(limit, 10) : undefined, offset ? parseInt(offset, 10) : undefined);
  });

  app.post("/datasets/:datasetId/rows", async (request, reply) => {
    const { datasetId } = request.params as { datasetId: string };
    const body = request.body as { data: Record<string, unknown> };
    try {
      const row = await request.store!.createDatasetRow(datasetId, body.data ?? body);
      reply.code(201);
      return row;
    } catch {
      return reply.code(404).send({ message: "Dataset not found" });
    }
  });

  app.post("/datasets/:datasetId/rows/batch", async (request, reply) => {
    const { datasetId } = request.params as { datasetId: string };
    const body = request.body as { rows: Array<Record<string, unknown>> };
    try {
      const rows = await request.store!.createDatasetRowsBatch(datasetId, body.rows ?? body);
      reply.code(201);
      return rows;
    } catch {
      return reply.code(404).send({ message: "Dataset not found" });
    }
  });

  app.patch("/datasets/:datasetId/rows/:rowId", async (request, reply) => {
    const { rowId } = request.params as { datasetId: string; rowId: string };
    const body = request.body as { data: Record<string, unknown> };
    try {
      return await request.store!.updateDatasetRow(rowId, body.data ?? body);
    } catch {
      return reply.code(404).send({ message: "Dataset row not found" });
    }
  });

  app.delete("/datasets/:datasetId/rows/:rowId", async (request, reply) => {
    const { rowId } = request.params as { datasetId: string; rowId: string };
    try {
      return await request.store!.deleteDatasetRow(rowId);
    } catch {
      return reply.code(404).send({ message: "Dataset row not found" });
    }
  });

  app.get("/datasets/:datasetId/search", async (request, reply) => {
    const { datasetId } = request.params as { datasetId: string };
    const { q } = (request.query ?? {}) as { q?: string };
    const dataset = await request.store!.getDataset(datasetId);
    if (!dataset) return reply.code(404).send({ message: "Dataset not found" });
    return request.store!.searchDatasetRows(datasetId, q ?? "");
  });

  app.post("/datasets/:datasetId/query", async (request, reply) => {
    const { datasetId } = request.params as { datasetId: string };
    const { filters } = request.body as { filters: Array<{ column: string; op: string; value: unknown }> };
    const dataset = await request.store!.getDataset(datasetId);
    if (!dataset) return reply.code(404).send({ message: "Dataset not found" });
    return request.store!.queryDataset(datasetId, filters as Parameters<PrismaApiStore["queryDataset"]>[1]);
  });

  // ── Settings Routes ──────────────────────────────────────────────────

  app.get("/settings", async (request) => request.store!.getSettings());

  app.patch("/settings", async (request) => {
    const patch = request.body as Record<string, unknown>;
    return request.store!.updateSettings(patch as Parameters<PrismaApiStore["updateSettings"]>[0]);
  });

  // ── Integration Test & Models Routes ─────────────────────────────────

  app.post("/settings/integrations/test-key", async (request, reply) => {
    const { provider, apiKey, baseUrl } = request.body as { provider: string; apiKey: string; baseUrl?: string };
    if (!provider) return reply.code(400).send({ success: false, message: "provider is required" });
    if (!apiKey && provider !== "lmstudio") return reply.code(400).send({ success: false, message: "apiKey is required" });
    try {
      let ok = false;
      if (provider === "anthropic") {
        const res = await fetch("https://api.anthropic.com/v1/models?limit=1", {
          headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
        });
        ok = res.ok;
      } else if (provider === "openai") {
        const res = await fetch("https://api.openai.com/v1/models?limit=1", {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        ok = res.ok;
      } else if (provider === "openrouter") {
        const res = await fetch("https://openrouter.ai/api/v1/models", {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        ok = res.ok;
      } else if (provider === "gemini") {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
        ok = res.ok;
      } else if (provider === "lmstudio") {
        const url = baseUrl || "http://localhost:1234/v1";
        const res = await fetch(`${url}/models`);
        ok = res.ok;
      }
      if (ok) return { success: true, message: "Connection successful" };
      return reply.code(400).send({ success: false, message: "Invalid API key or connection failed" });
    } catch (err: any) {
      return reply.code(400).send({ success: false, message: err.message || "Connection failed" });
    }
  });

  app.post("/settings/integrations/models", async (request, reply) => {
    const { provider, apiKey, baseUrl } = request.body as { provider: string; apiKey: string; baseUrl?: string };
    if (!provider) return reply.code(400).send({ message: "provider is required" });
    try {
      let models: { id: string; name: string }[] = [];
      if (provider === "anthropic") {
        const res = await fetch("https://api.anthropic.com/v1/models?limit=100", {
          headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
        });
        if (!res.ok) return reply.code(400).send({ message: "Failed to fetch models" });
        const data = await res.json() as { data: { id: string; display_name?: string }[] };
        models = (data.data || []).map((m) => ({ id: m.id, name: m.display_name || m.id }));
      } else if (provider === "openai") {
        const res = await fetch("https://api.openai.com/v1/models", {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        if (!res.ok) return reply.code(400).send({ message: "Failed to fetch models" });
        const data = await res.json() as { data: { id: string }[] };
        models = (data.data || []).map((m) => ({ id: m.id, name: m.id }));
      } else if (provider === "openrouter") {
        const res = await fetch("https://openrouter.ai/api/v1/models", {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        if (!res.ok) return reply.code(400).send({ message: "Failed to fetch models" });
        const data = await res.json() as { data: { id: string; name?: string }[] };
        models = (data.data || []).map((m) => ({ id: m.id, name: m.name || m.id }));
      } else if (provider === "gemini") {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
        if (!res.ok) return reply.code(400).send({ message: "Failed to fetch models" });
        const data = await res.json() as { models: { name: string; displayName?: string }[] };
        models = (data.models || []).map((m) => ({
          id: m.name.replace("models/", ""),
          name: m.displayName || m.name.replace("models/", ""),
        }));
      } else if (provider === "lmstudio") {
        const url = baseUrl || "http://localhost:1234/v1";
        const res = await fetch(`${url}/models`);
        if (!res.ok) return reply.code(400).send({ message: "Failed to fetch models" });
        const data = await res.json() as { data: { id: string }[] };
        models = (data.data || []).map((m) => ({ id: m.id, name: m.id }));
      }
      return { models };
    } catch (err: any) {
      return reply.code(400).send({ message: err.message || "Failed to fetch models" });
    }
  });

  // ── Brand Routes ──────────────────────────────────────────────────────

  app.get("/settings/brand", async (request) => {
    const settings = await request.store!.getSettings();
    return settings.brand;
  });

  app.patch("/settings/brand", async (request) => {
    const patch = request.body as Record<string, unknown>;
    const settings = await request.store!.getSettings();
    const merged = { ...settings.brand, ...patch };
    await request.store!.updateSettings({ brand: merged as any });
    return merged;
  });

  app.post("/settings/brand/capture", async (request, reply) => {
    const { websiteUrl } = request.body as { websiteUrl: string };
    if (!websiteUrl) return reply.code(400).send({ message: "websiteUrl is required" });

    const settings = await request.store!.getSettings();
    const provider = settings.integrations.llmProvider || "anthropic";
    const model = settings.integrations.llmModel || "claude-sonnet-4-20250514";
    const providerKeyMap: Record<string, string> = {
      anthropic: settings.integrations.anthropicKey,
      openai: settings.integrations.openaiKey,
      openrouter: settings.integrations.openrouterKey,
      gemini: settings.integrations.geminiKey,
      lmstudio: "lm-studio",
    };
    const apiKey = providerKeyMap[provider] || settings.integrations.anthropicKey || settings.integrations.openaiKey;

    if (!apiKey) return reply.code(400).send({ message: "No API key configured. Set an API key in Integrations settings first." });

    const { captureBrand } = await import("./services/brand-capture.js");
    const brand = await captureBrand(websiteUrl, { provider, apiKey, model });
    await request.store!.updateSettings({ brand: brand as any });
    return brand;
  });

  // ── User Routes ─────────────────────────────────────────────────────

  app.get("/users", async (request) => {
    const users = await request.store!.listUsers();
    return users.map(({ passwordHash, ...u }: any) => u);
  });

  app.post("/users", async (request, reply) => {
    const body = request.body as CreateUserInput;
    if (!body.email || !body.name || !body.role) {
      return reply.code(400).send({ message: "email, name, and role are required" });
    }
    try {
      const user = await request.store!.createUser(body);
      const { passwordHash, ...safeUser } = user as any;
      reply.code(201);
      return safeUser;
    } catch (error) {
      return reply.code(400).send({ message: error instanceof Error ? error.message : "Create failed" });
    }
  });

  app.patch("/users/:userId", async (request, reply) => {
    const { userId } = request.params as { userId: string };
    const patch = request.body as UserPatchInput;
    try {
      const user = await request.store!.updateUser(userId, patch);
      const { passwordHash, ...safeUser } = user as any;
      return safeUser;
    } catch (error) {
      return reply.code(404).send({ message: error instanceof Error ? error.message : "User not found" });
    }
  });

  app.delete("/users/:userId", async (request, reply) => {
    const { userId } = request.params as { userId: string };
    try {
      const user = await request.store!.deleteUser(userId);
      const { passwordHash, ...safeUser } = user as any;
      return safeUser;
    } catch (error) {
      return reply.code(404).send({ message: error instanceof Error ? error.message : "User not found" });
    }
  });

  app.register(authRoutes);
  app.register(adminRoutes);
  app.register(agentRoutes);
  app.register(knowledgeRoutes);
  app.register(datasetRoutes);
  app.register(takeoffRoutes);
  app.register(rateScheduleRoutes);
  app.register(intakeRoutes);
  app.register(catalogRoutes);

  app.addHook("onReady", async () => {
    await cleanExpiredSessions(prisma);
    setInterval(() => cleanExpiredSessions(prisma), 60 * 60 * 1000);
  });

  return app;
}

export const createBidwrightServer = buildServer;
