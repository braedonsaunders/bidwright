import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { z } from "zod";

import {
  apiStore,
  type AdditionalLineItemPatchInput,
  type CatalogItemPatchInput,
  type CatalogPatchInput,
  type ConditionPatchInput,
  type CreateAdditionalLineItemInput,
  type CreateCatalogInput,
  type CreateCatalogItemInput,
  type CreateConditionInput,
  type CreateFileNodeInput,
  type CreateLabourRateInput,
  type CreateModifierInput,
  type CreatePhaseInput,
  type CreateReportSectionInput,
  type CreateWorksheetInput,
  type CreateWorksheetItemInput,
  type CreateProjectInput,
  type FileNodePatchInput,
  type LabourRatePatchInput,
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
  type UserPatchInput
} from "./persistent-store.js";
import {
  relativePackageArchivePath,
  resolveApiPath,
  sanitizeFileName
} from "./paths.js";
import { agentRoutes } from "./routes/agent-routes.js";
import { buildPdfDataPackage, generatePdfHtml } from "./services/pdf-service.js";
import { sendQuoteEmail } from "./services/email-service.js";
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
  quantity: z.number().finite(),
  uom: z.string().min(1),
  cost: z.number().finite(),
  markup: z.number().finite(),
  price: z.number().finite(),
  laborHourReg: z.number().finite().default(0),
  laborHourOver: z.number().finite().default(0),
  laborHourDouble: z.number().finite().default(0),
  lineOrder: z.number().int().optional()
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
  order: z.number().int().optional()
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

const createLabourRateSchema = z.object({
  name: z.string().optional(),
  regularRate: z.number().finite().optional(),
  overtimeRate: z.number().finite().optional(),
  doubleRate: z.number().finite().optional()
});

const labourRatePatchSchema = z.object({
  name: z.string().optional(),
  regularRate: z.number().finite().optional(),
  overtimeRate: z.number().finite().optional(),
  doubleRate: z.number().finite().optional()
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

function summaryMetrics(workspace: PackageIngestionOutcome["workspace"]) {
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

async function buildWorkspaceResponse(projectId: string) {
  const workspace = await apiStore.getWorkspace(projectId);
  if (!workspace) {
    return null;
  }

  const labourRates = await apiStore.listLabourRates(projectId);

  return {
    workspace: {
      ...workspace,
      labourRates
    },
    workspaceState: await apiStore.getWorkspaceState(projectId),
    summaryMetrics: summaryMetrics(workspace),
    packages: await apiStore.listPackages(projectId),
    jobs: await apiStore.listJobs(projectId),
    documents: await apiStore.listDocuments(projectId)
  };
}

async function ingestUploadForProject(request: FastifyRequest, reply: FastifyReply, projectIdOverride?: string) {
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
    const existingProject = await apiStore.getProject(targetProjectId);
    if (!existingProject) {
      reply.code(404);
      return {
        message: "Project not found"
      };
    }
  } else {
    const createdProject = await apiStore.createProject(createProjectInputFromUpload(multipartUpload.fields, multipartUpload.originalFileName));
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

  await apiStore.registerUploadedPackage({
    packageId: multipartUpload.packageId,
    projectId: targetProjectId,
    packageName,
    originalFileName: multipartUpload.originalFileName,
    storagePath: path.relative(resolveApiPath(), multipartUpload.storagePath),
    checksum: multipartUpload.checksum,
    totalBytes: multipartUpload.totalBytes,
    sourceKind
  });

  const outcome = await apiStore.ingestUploadedPackage(multipartUpload.packageId);
  reply.code(201);
  return buildPackageResponse(outcome);
}

export function buildServer() {
  const app = Fastify({
    logger: true
  });

  void apiStore.initialize().catch((error) => {
    app.log.error(error);
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

  app.get("/projects", async () => apiStore.listProjectsWithState());

  app.post("/projects", async (request, reply) => {
    const parsed = createProjectSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        message: "Invalid project payload",
        issues: parsed.error.flatten()
      });
    }

    const result = await apiStore.createProject(parsed.data);
    reply.code(201);
    return result;
  });

  app.get("/projects/:projectId", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const project = await apiStore.getProject(projectId);

    if (!project) {
      return reply.code(404).send({
        message: "Project not found"
      });
    }

    return project;
  });

  app.get("/projects/:projectId/workspace", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const payload = await buildWorkspaceResponse(projectId);

    if (!payload) {
      return reply.code(404).send({
        message: "Project workspace not found"
      });
    }

    return payload;
  });

  app.get("/projects/:projectId/estimate", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const workspace = await apiStore.getWorkspace(projectId);

    if (!workspace) {
      return reply.code(404).send({
        message: "Project not found"
      });
    }

    return workspace.estimate;
  });

  app.get("/projects/:projectId/packages", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const project = await apiStore.getProject(projectId);
    if (!project) {
      return reply.code(404).send({
        message: "Project not found"
      });
    }
    return apiStore.listPackages(projectId);
  });

  app.get("/projects/:projectId/jobs", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const project = await apiStore.getProject(projectId);
    if (!project) {
      return reply.code(404).send({
        message: "Project not found"
      });
    }
    return apiStore.listJobs(projectId);
  });

  app.get("/projects/:projectId/documents", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const project = await apiStore.getProject(projectId);
    if (!project) {
      return reply.code(404).send({
        message: "Project not found"
      });
    }
    return apiStore.listDocuments(projectId);
  });

  app.get("/projects/:projectId/workspace-state", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const project = await apiStore.getProject(projectId);
    if (!project) {
      return reply.code(404).send({
        message: "Project not found"
      });
    }

    const workspaceState = await apiStore.getWorkspaceState(projectId);

    if (!workspaceState) {
      return reply.code(404).send({
        message: "Workspace state not found"
      });
    }

    return workspaceState;
  });

  app.patch("/projects/:projectId/workspace-state", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const project = await apiStore.getProject(projectId);
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

    const workspaceState = await apiStore.updateWorkspaceState(projectId, parsed.data);
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

    await apiStore.updateRevision(projectId, revisionId, parsed.data satisfies RevisionPatchInput);
    const payload = await buildWorkspaceResponse(projectId);
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

    await apiStore.createWorksheetItem(projectId, worksheetId, parsed.data satisfies CreateWorksheetItemInput);
    const payload = await buildWorkspaceResponse(projectId);
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

    await apiStore.createWorksheet(projectId, parsed.data satisfies CreateWorksheetInput);
    const payload = await buildWorkspaceResponse(projectId);
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

    await apiStore.updateWorksheet(projectId, worksheetId, parsed.data satisfies WorksheetPatchInput);
    const payload = await buildWorkspaceResponse(projectId);
    if (!payload) {
      return reply.code(404).send({
        message: "Project workspace not found"
      });
    }
    return payload;
  });

  app.delete("/projects/:projectId/worksheets/:worksheetId", async (request, reply) => {
    const { projectId, worksheetId } = request.params as { projectId: string; worksheetId: string };
    await apiStore.deleteWorksheet(projectId, worksheetId);
    const payload = await buildWorkspaceResponse(projectId);
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

    await apiStore.updateWorksheetItem(projectId, itemId, parsed.data satisfies WorksheetItemPatchInput);
    const payload = await buildWorkspaceResponse(projectId);
    if (!payload) {
      return reply.code(404).send({
        message: "Project workspace not found"
      });
    }
    return payload;
  });

  app.delete("/projects/:projectId/worksheet-items/:itemId", async (request, reply) => {
    const { projectId, itemId } = request.params as { projectId: string; itemId: string };
    await apiStore.deleteWorksheetItem(projectId, itemId);
    const payload = await buildWorkspaceResponse(projectId);
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

    const workspace = await apiStore.getWorkspace(projectId);
    if (!workspace) {
      return reply.code(404).send({ message: "Project workspace not found" });
    }

    await apiStore.createPhase(projectId, workspace.currentRevision.id, parsed.data satisfies CreatePhaseInput);
    const payload = await buildWorkspaceResponse(projectId);
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

    await apiStore.updatePhase(projectId, phaseId, parsed.data satisfies PhasePatchInput);
    const payload = await buildWorkspaceResponse(projectId);
    if (!payload) {
      return reply.code(404).send({ message: "Project workspace not found" });
    }
    return payload;
  });

  app.delete("/projects/:projectId/phases/:phaseId", async (request, reply) => {
    const { projectId, phaseId } = request.params as { projectId: string; phaseId: string };
    await apiStore.deletePhase(projectId, phaseId);
    const payload = await buildWorkspaceResponse(projectId);
    if (!payload) {
      return reply.code(404).send({ message: "Project workspace not found" });
    }
    return payload;
  });

  // ── Modifier routes ────────────────────────────────────────────────

  app.get("/projects/:projectId/modifiers", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const project = await apiStore.getProject(projectId);
    if (!project) {
      return reply.code(404).send({ message: "Project not found" });
    }
    return apiStore.listModifiers(projectId);
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

    const workspace = await apiStore.getWorkspace(projectId);
    if (!workspace) {
      return reply.code(404).send({ message: "Project workspace not found" });
    }

    await apiStore.createModifier(projectId, workspace.currentRevision.id, parsed.data satisfies CreateModifierInput);
    const payload = await buildWorkspaceResponse(projectId);
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

    await apiStore.updateModifier(projectId, modifierId, parsed.data satisfies ModifierPatchInput);
    const payload = await buildWorkspaceResponse(projectId);
    if (!payload) {
      return reply.code(404).send({ message: "Project workspace not found" });
    }
    return payload;
  });

  app.delete("/projects/:projectId/modifiers/:modifierId", async (request, reply) => {
    const { projectId, modifierId } = request.params as { projectId: string; modifierId: string };
    await apiStore.deleteModifier(projectId, modifierId);
    const payload = await buildWorkspaceResponse(projectId);
    if (!payload) {
      return reply.code(404).send({ message: "Project workspace not found" });
    }
    return payload;
  });

  // ── Condition routes ───────────────────────────────────────────────

  app.get("/conditions/library", async () => apiStore.listConditionLibrary());

  app.get("/projects/:projectId/conditions", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const project = await apiStore.getProject(projectId);
    if (!project) {
      return reply.code(404).send({ message: "Project not found" });
    }
    return apiStore.listConditions(projectId);
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

    const workspace = await apiStore.getWorkspace(projectId);
    if (!workspace) {
      return reply.code(404).send({ message: "Project workspace not found" });
    }

    await apiStore.createCondition(projectId, workspace.currentRevision.id, parsed.data satisfies CreateConditionInput);
    const payload = await buildWorkspaceResponse(projectId);
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

    await apiStore.updateCondition(projectId, conditionId, parsed.data satisfies ConditionPatchInput);
    const payload = await buildWorkspaceResponse(projectId);
    if (!payload) {
      return reply.code(404).send({ message: "Project workspace not found" });
    }
    return payload;
  });

  app.delete("/projects/:projectId/conditions/:conditionId", async (request, reply) => {
    const { projectId, conditionId } = request.params as { projectId: string; conditionId: string };
    await apiStore.deleteCondition(projectId, conditionId);
    const payload = await buildWorkspaceResponse(projectId);
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

    const workspace = await apiStore.getWorkspace(projectId);
    if (!workspace) {
      return reply.code(404).send({ message: "Project workspace not found" });
    }

    await apiStore.reorderConditions(projectId, workspace.currentRevision.id, parsed.data.orderedIds);
    const payload = await buildWorkspaceResponse(projectId);
    if (!payload) {
      return reply.code(404).send({ message: "Project workspace not found" });
    }
    return payload;
  });

  // ── Additional Line Item routes ────────────────────────────────────

  app.get("/projects/:projectId/ali", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const project = await apiStore.getProject(projectId);
    if (!project) {
      return reply.code(404).send({ message: "Project not found" });
    }
    return apiStore.listAdditionalLineItems(projectId);
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

    const workspace = await apiStore.getWorkspace(projectId);
    if (!workspace) {
      return reply.code(404).send({ message: "Project workspace not found" });
    }

    await apiStore.createAdditionalLineItem(projectId, workspace.currentRevision.id, parsed.data satisfies CreateAdditionalLineItemInput);
    const payload = await buildWorkspaceResponse(projectId);
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

    await apiStore.updateAdditionalLineItem(projectId, aliId, parsed.data satisfies AdditionalLineItemPatchInput);
    const payload = await buildWorkspaceResponse(projectId);
    if (!payload) {
      return reply.code(404).send({ message: "Project workspace not found" });
    }
    return payload;
  });

  app.delete("/projects/:projectId/ali/:aliId", async (request, reply) => {
    const { projectId, aliId } = request.params as { projectId: string; aliId: string };
    await apiStore.deleteAdditionalLineItem(projectId, aliId);
    const payload = await buildWorkspaceResponse(projectId);
    if (!payload) {
      return reply.code(404).send({ message: "Project workspace not found" });
    }
    return payload;
  });

  // ── Labour Rate routes ─────────────────────────────────────────────

  app.get("/projects/:projectId/rates", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const project = await apiStore.getProject(projectId);
    if (!project) {
      return reply.code(404).send({ message: "Project not found" });
    }
    return apiStore.listLabourRates(projectId);
  });

  app.post("/projects/:projectId/rates", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const parsed = createLabourRateSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({
        message: "Invalid labour rate payload",
        issues: parsed.error.flatten()
      });
    }

    const workspace = await apiStore.getWorkspace(projectId);
    if (!workspace) {
      return reply.code(404).send({ message: "Project workspace not found" });
    }

    await apiStore.createLabourRate(projectId, workspace.currentRevision.id, parsed.data satisfies CreateLabourRateInput);
    const payload = await buildWorkspaceResponse(projectId);
    if (!payload) {
      return reply.code(404).send({ message: "Project workspace not found" });
    }
    reply.code(201);
    return payload;
  });

  app.patch("/projects/:projectId/rates/:rateId", async (request, reply) => {
    const { projectId, rateId } = request.params as { projectId: string; rateId: string };
    const parsed = labourRatePatchSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({
        message: "Invalid labour rate payload",
        issues: parsed.error.flatten()
      });
    }

    await apiStore.updateLabourRate(projectId, rateId, parsed.data satisfies LabourRatePatchInput);
    const payload = await buildWorkspaceResponse(projectId);
    if (!payload) {
      return reply.code(404).send({ message: "Project workspace not found" });
    }
    return payload;
  });

  app.delete("/projects/:projectId/rates/:rateId", async (request, reply) => {
    const { projectId, rateId } = request.params as { projectId: string; rateId: string };
    await apiStore.deleteLabourRate(projectId, rateId);
    const payload = await buildWorkspaceResponse(projectId);
    if (!payload) {
      return reply.code(404).send({ message: "Project workspace not found" });
    }
    return payload;
  });

  // ── Revision routes ────────────────────────────────────────────────

  app.post("/projects/:projectId/revisions", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const workspace = await apiStore.getWorkspace(projectId);
    if (!workspace) {
      return reply.code(404).send({ message: "Project workspace not found" });
    }

    await apiStore.createRevision(projectId, workspace.quote.id);
    const payload = await buildWorkspaceResponse(projectId);
    if (!payload) {
      return reply.code(404).send({ message: "Project workspace not found" });
    }
    reply.code(201);
    return payload;
  });

  app.delete("/projects/:projectId/revisions/:revisionId", async (request, reply) => {
    const { projectId, revisionId } = request.params as { projectId: string; revisionId: string };
    await apiStore.deleteRevision(projectId, revisionId);
    const payload = await buildWorkspaceResponse(projectId);
    if (!payload) {
      return reply.code(404).send({ message: "Project workspace not found" });
    }
    return payload;
  });

  app.post("/projects/:projectId/revisions/:revisionId/activate", async (request, reply) => {
    const { projectId, revisionId } = request.params as { projectId: string; revisionId: string };
    await apiStore.switchRevision(projectId, revisionId);
    const payload = await buildWorkspaceResponse(projectId);
    if (!payload) {
      return reply.code(404).send({ message: "Project workspace not found" });
    }
    return payload;
  });

  app.post("/projects/:projectId/copy", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const result = await apiStore.copyQuote(projectId);
    const payload = await buildWorkspaceResponse(result.project.id);
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

    await apiStore.updateQuote(projectId, parsed.data satisfies QuotePatchInput);
    const payload = await buildWorkspaceResponse(projectId);
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
    await apiStore.makeCurrentRevisionZero(projectId);
    const payload = await buildWorkspaceResponse(projectId);
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
    const project = await apiStore.getProject(projectId);
    if (!project) {
      return reply.code(404).send({ message: "Project not found" });
    }
    return apiStore.listActivities(projectId);
  });

  // ── Report Section routes ──────────────────────────────────────────

  app.get("/projects/:projectId/report-sections", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const project = await apiStore.getProject(projectId);
    if (!project) {
      return reply.code(404).send({ message: "Project not found" });
    }
    return apiStore.listReportSections(projectId);
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

    const workspace = await apiStore.getWorkspace(projectId);
    if (!workspace) {
      return reply.code(404).send({ message: "Project workspace not found" });
    }

    await apiStore.createReportSection(projectId, workspace.currentRevision.id, parsed.data satisfies CreateReportSectionInput);
    const payload = await buildWorkspaceResponse(projectId);
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

    await apiStore.updateReportSection(projectId, sectionId, parsed.data satisfies ReportSectionPatchInput);
    const payload = await buildWorkspaceResponse(projectId);
    if (!payload) {
      return reply.code(404).send({ message: "Project workspace not found" });
    }
    return payload;
  });

  app.delete("/projects/:projectId/report-sections/:sectionId", async (request, reply) => {
    const { projectId, sectionId } = request.params as { projectId: string; sectionId: string };
    await apiStore.deleteReportSection(projectId, sectionId);
    const payload = await buildWorkspaceResponse(projectId);
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

    const workspace = await apiStore.getWorkspace(projectId);
    if (!workspace) {
      return reply.code(404).send({ message: "Project workspace not found" });
    }

    await apiStore.reorderReportSections(projectId, workspace.currentRevision.id, parsed.data.orderedIds);
    const payload = await buildWorkspaceResponse(projectId);
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

    await apiStore.updateProjectStatus(projectId, parsed.data satisfies StatusPatchInput);
    const payload = await buildWorkspaceResponse(projectId);
    if (!payload) {
      return reply.code(404).send({ message: "Project workspace not found" });
    }
    return payload;
  });

  app.get("/packages/:packageId", async (request, reply) => {
    const { packageId } = request.params as { packageId: string };
    const packageRecord = await apiStore.getPackage(packageId);

    if (!packageRecord) {
      return reply.code(404).send({
        message: "Package not found"
      });
    }

    return packageRecord;
  });

  app.get("/jobs/:jobId", async (request, reply) => {
    const { jobId } = request.params as { jobId: string };
    const job = await apiStore.getJob(jobId);

    if (!job) {
      return reply.code(404).send({
        message: "Job not found"
      });
    }

    return job;
  });

  app.get("/catalogs", async () => apiStore.listCatalogs());

  app.post("/catalogs", async (request, reply) => {
    const parsed = createCatalogSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ message: "Invalid catalog payload", issues: parsed.error.flatten() });
    }
    const catalog = await apiStore.createCatalog(parsed.data satisfies CreateCatalogInput);
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
      return await apiStore.updateCatalog(catalogId, parsed.data satisfies CatalogPatchInput);
    } catch {
      return reply.code(404).send({ message: "Catalog not found" });
    }
  });

  app.delete("/catalogs/:catalogId", async (request, reply) => {
    const { catalogId } = request.params as { catalogId: string };
    try {
      return await apiStore.deleteCatalog(catalogId);
    } catch {
      return reply.code(404).send({ message: "Catalog not found" });
    }
  });

  app.get("/catalogs/:catalogId/items", async (request) => {
    const { catalogId } = request.params as { catalogId: string };
    return apiStore.listCatalogItems(catalogId);
  });

  app.post("/catalogs/:catalogId/items", async (request, reply) => {
    const { catalogId } = request.params as { catalogId: string };
    const parsed = createCatalogItemSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ message: "Invalid catalog item payload", issues: parsed.error.flatten() });
    }
    try {
      const item = await apiStore.createCatalogItem(catalogId, parsed.data satisfies CreateCatalogItemInput);
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
      return await apiStore.updateCatalogItem(itemId, parsed.data satisfies CatalogItemPatchInput);
    } catch {
      return reply.code(404).send({ message: "Catalog item not found" });
    }
  });

  app.delete("/catalogs/:catalogId/items/:itemId", async (request, reply) => {
    const { itemId } = request.params as { catalogId: string; itemId: string };
    try {
      return await apiStore.deleteCatalogItem(itemId);
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
    return apiStore.searchCatalogItems(query.data.q, query.data.catalogId);
  });

  app.get("/catalog/rates", async () => apiStore.listCatalogRates());

  // ── File Node routes ──────────────────────────────────────────────

  app.get("/projects/:projectId/files", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const project = await apiStore.getProject(projectId);
    if (!project) return reply.code(404).send({ message: "Project not found" });
    const query = z.object({ parentId: z.string().optional() }).safeParse(request.query ?? {});
    const parentId = query.success ? query.data.parentId : undefined;
    return apiStore.listFileNodes(projectId, parentId);
  });

  app.get("/projects/:projectId/files/tree", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const project = await apiStore.getProject(projectId);
    if (!project) return reply.code(404).send({ message: "Project not found" });
    return apiStore.getFileTree(projectId);
  });

  app.post("/projects/:projectId/files", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const parsed = createFileNodeSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ message: "Invalid file node payload", issues: parsed.error.flatten() });
    }
    try {
      const node = await apiStore.createFileNode(projectId, parsed.data satisfies CreateFileNodeInput);
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
      return await apiStore.updateFileNode(nodeId, parsed.data satisfies FileNodePatchInput);
    } catch {
      return reply.code(404).send({ message: "File node not found" });
    }
  });

  app.delete("/projects/:projectId/files/:nodeId", async (request, reply) => {
    const { nodeId } = request.params as { projectId: string; nodeId: string };
    try {
      return await apiStore.deleteFileNode(nodeId);
    } catch {
      return reply.code(404).send({ message: "File node not found" });
    }
  });

  app.get("/ai/runs", async (request) => {
    const query = z.object({
      projectId: z.string().optional()
    }).safeParse(request.query ?? {});

    if (!query.success) {
      return apiStore.listAiRuns();
    }

    return apiStore.listAiRuns(query.data.projectId);
  });

  app.post("/projects/:projectId/packages/upload", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const result = await ingestUploadForProject(request, reply, projectId);

    return result;
  });

  app.post("/ingestion/package", async (request, reply) => {
    return ingestUploadForProject(request, reply);
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

    const project = await apiStore.getProject(projectId);
    if (!project) {
      return reply.code(404).send({
        message: "Project not found"
      });
    }

    const packages = await apiStore.listPackages(projectId);
    const targetPackage =
      parsed.data.packageId ? packages.find((entry) => entry.id === parsed.data.packageId) : packages[0];

    if (!targetPackage) {
      return reply.code(404).send({
        message: "No package available to ingest"
      });
    }

    const outcome = await apiStore.ingestUploadedPackage(targetPackage.id);
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
    const workspace = await apiStore.getWorkspace(projectId);
    if (!workspace) {
      return reply.code(404).send({ message: "Project not found" });
    }
    const pdfData = buildPdfDataPackage(workspace);
    const html = generatePdfHtml(pdfData, templateType);
    return reply.type("text/html").send(html);
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

    const workspace = await apiStore.getWorkspace(projectId);
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

    await apiStore.logActivity(projectId, workspace.currentRevision?.id ?? null, "quote_sent", {
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
    const project = await apiStore.getProject(projectId);
    if (!project) {
      return reply.code(404).send({ message: "Project not found" });
    }

    return apiStore.deleteProject(projectId);
  });

  // -------------------------------------------------------------------------
  // AI endpoints
  // -------------------------------------------------------------------------

  app.post("/projects/:projectId/ai/description", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const workspace = await apiStore.getWorkspace(projectId);
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
    const workspace = await apiStore.getWorkspace(projectId);
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
    const workspace = await apiStore.getWorkspace(projectId);
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

    const workspace = await apiStore.getWorkspace(projectId);
    if (!workspace) {
      return reply.code(404).send({ message: "Project not found" });
    }

    const revisionId = workspace.currentRevision?.id;
    if (!revisionId) {
      return reply.code(400).send({ message: "No active revision" });
    }

    for (const phase of phases) {
      await apiStore.createPhase(projectId, revisionId, {
        number: phase.number,
        name: phase.name,
        description: phase.description,
      });
    }

    await apiStore.logActivity(projectId, revisionId, "ai_phases_accepted", {
      phaseCount: phases.length,
    });

    const response = await buildWorkspaceResponse(projectId);
    if (!response) {
      return reply.code(404).send({ message: "Failed to build workspace" });
    }
    return response;
  });

  app.post("/projects/:projectId/ai/equipment", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const workspace = await apiStore.getWorkspace(projectId);
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

    const workspace = await apiStore.getWorkspace(projectId);
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
      await apiStore.createWorksheetItem(projectId, targetWorksheetId, {
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

    await apiStore.logActivity(projectId, revisionId, "ai_equipment_accepted", {
      equipmentCount: equipment.length,
    });

    const response = await buildWorkspaceResponse(projectId);
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

    const workspace = await apiStore.getWorkspace(projectId);
    if (!workspace) {
      return reply.code(404).send({ message: "Project workspace not found" });
    }

    const job = await apiStore.createJob(projectId, workspace.currentRevision.id, parsed.data satisfies CreateJobInput);
    reply.code(201);
    return job;
  });

  app.get("/jobs", async () => apiStore.listAllJobs());

  // ── Import BOM routes ─────────────────────────────────────────────

  app.post("/projects/:projectId/import-preview", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const project = await apiStore.getProject(projectId);
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

    const parsed = apiStore.parseCSV(csvText);
    const fileId = `import-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    apiStore.storeImportPreview(fileId, parsed);

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

    const project = await apiStore.getProject(projectId);
    if (!project) {
      return reply.code(404).send({ message: "Project not found" });
    }

    await apiStore.processImport(
      projectId,
      parsed.data.worksheetId,
      parsed.data.fileId,
      parsed.data.mapping
    );

    const payload = await buildWorkspaceResponse(projectId);
    if (!payload) {
      return reply.code(404).send({ message: "Project workspace not found" });
    }

    return payload;
  });

  // ── Plugin Routes ──────────────────────────────────────────────────

  app.get("/plugins", async () => apiStore.listPlugins());

  app.get("/plugins/:pluginId", async (request, reply) => {
    const { pluginId } = request.params as { pluginId: string };
    const plugin = await apiStore.getPlugin(pluginId);
    if (!plugin) {
      return reply.code(404).send({ message: "Plugin not found" });
    }
    return plugin;
  });

  app.post("/plugins", async (request, reply) => {
    const body = request.body as CreatePluginInput;
    const plugin = await apiStore.createPlugin(body);
    reply.code(201);
    return plugin;
  });

  app.patch("/plugins/:pluginId", async (request, reply) => {
    const { pluginId } = request.params as { pluginId: string };
    const patch = request.body as PluginPatchInput;
    try {
      const plugin = await apiStore.updatePlugin(pluginId, patch);
      return plugin;
    } catch {
      return reply.code(404).send({ message: "Plugin not found" });
    }
  });

  app.delete("/plugins/:pluginId", async (request, reply) => {
    const { pluginId } = request.params as { pluginId: string };
    try {
      const plugin = await apiStore.deletePlugin(pluginId);
      return plugin;
    } catch {
      return reply.code(404).send({ message: "Plugin not found" });
    }
  });

  app.post("/plugins/:pluginId/execute", async (request, reply) => {
    const { pluginId } = request.params as { pluginId: string };
    const { projectId, revisionId, input } = request.body as { projectId: string; revisionId: string; input: Record<string, unknown> };
    try {
      const execution = await apiStore.executePlugin(pluginId, projectId, revisionId, input ?? {});
      reply.code(201);
      return execution;
    } catch (error) {
      return reply.code(400).send({ message: error instanceof Error ? error.message : "Execution failed" });
    }
  });

  app.get("/projects/:projectId/plugin-executions", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const project = await apiStore.getProject(projectId);
    if (!project) {
      return reply.code(404).send({ message: "Project not found" });
    }
    return apiStore.listPluginExecutions(projectId);
  });

  // ── Knowledge Book Routes ──────────────────────────────────────────

  app.get("/knowledge/books", async (request) => {
    const { projectId } = (request.query ?? {}) as { projectId?: string };
    return apiStore.listKnowledgeBooks(projectId);
  });

  app.get("/knowledge/books/:bookId", async (request, reply) => {
    const { bookId } = request.params as { bookId: string };
    const book = await apiStore.getKnowledgeBook(bookId);
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
    const book = await apiStore.createKnowledgeBook(body as Parameters<typeof apiStore.createKnowledgeBook>[0]);
    reply.code(201);
    return book;
  });

  app.patch("/knowledge/books/:bookId", async (request, reply) => {
    const { bookId } = request.params as { bookId: string };
    const patch = request.body as Record<string, unknown>;
    try {
      return await apiStore.updateKnowledgeBook(bookId, patch as Parameters<typeof apiStore.updateKnowledgeBook>[1]);
    } catch {
      return reply.code(404).send({ message: "Knowledge book not found" });
    }
  });

  app.delete("/knowledge/books/:bookId", async (request, reply) => {
    const { bookId } = request.params as { bookId: string };
    try {
      return await apiStore.deleteKnowledgeBook(bookId);
    } catch {
      return reply.code(404).send({ message: "Knowledge book not found" });
    }
  });

  app.get("/knowledge/books/:bookId/chunks", async (request, reply) => {
    const { bookId } = request.params as { bookId: string };
    const book = await apiStore.getKnowledgeBook(bookId);
    if (!book) return reply.code(404).send({ message: "Knowledge book not found" });
    return apiStore.listKnowledgeChunks(bookId);
  });

  app.post("/knowledge/books/:bookId/chunks", async (request, reply) => {
    const { bookId } = request.params as { bookId: string };
    const body = request.body as { pageNumber?: number | null; sectionTitle: string; text: string; tokenCount?: number; order?: number };
    try {
      const chunk = await apiStore.createKnowledgeChunk(bookId, body);
      reply.code(201);
      return chunk;
    } catch {
      return reply.code(404).send({ message: "Knowledge book not found" });
    }
  });

  app.post("/knowledge/books/:bookId/chunks/batch", async (request, reply) => {
    const { bookId } = request.params as { bookId: string };
    const body = request.body as Array<{ pageNumber?: number | null; sectionTitle: string; text: string; tokenCount?: number; order?: number }>;
    const book = await apiStore.getKnowledgeBook(bookId);
    if (!book) return reply.code(404).send({ message: "Knowledge book not found" });
    const results = [];
    for (const item of body) {
      const chunk = await apiStore.createKnowledgeChunk(bookId, item);
      results.push(chunk);
    }
    reply.code(201);
    return results;
  });

  app.get("/knowledge/search", async (request) => {
    const { q, bookId, limit } = (request.query ?? {}) as { q?: string; bookId?: string; limit?: string };
    return apiStore.searchKnowledgeChunks(q ?? "", bookId, limit ? parseInt(limit, 10) : undefined);
  });

  // ── Dataset Routes ────────────────────────────────────────────────

  app.get("/datasets", async (request) => {
    const { projectId } = (request.query ?? {}) as { projectId?: string };
    return apiStore.listDatasets(projectId);
  });

  app.get("/datasets/:datasetId", async (request, reply) => {
    const { datasetId } = request.params as { datasetId: string };
    const dataset = await apiStore.getDataset(datasetId);
    if (!dataset) return reply.code(404).send({ message: "Dataset not found" });
    return dataset;
  });

  app.post("/datasets", async (request, reply) => {
    const body = request.body as Parameters<typeof apiStore.createDataset>[0];
    const dataset = await apiStore.createDataset(body);
    reply.code(201);
    return dataset;
  });

  app.patch("/datasets/:datasetId", async (request, reply) => {
    const { datasetId } = request.params as { datasetId: string };
    const patch = request.body as Record<string, unknown>;
    try {
      return await apiStore.updateDataset(datasetId, patch as Parameters<typeof apiStore.updateDataset>[1]);
    } catch {
      return reply.code(404).send({ message: "Dataset not found" });
    }
  });

  app.delete("/datasets/:datasetId", async (request, reply) => {
    const { datasetId } = request.params as { datasetId: string };
    try {
      return await apiStore.deleteDataset(datasetId);
    } catch {
      return reply.code(404).send({ message: "Dataset not found" });
    }
  });

  app.get("/datasets/:datasetId/rows", async (request, reply) => {
    const { datasetId } = request.params as { datasetId: string };
    const { filter, sort, limit, offset } = (request.query ?? {}) as { filter?: string; sort?: string; limit?: string; offset?: string };
    const dataset = await apiStore.getDataset(datasetId);
    if (!dataset) return reply.code(404).send({ message: "Dataset not found" });
    return apiStore.listDatasetRows(datasetId, filter, sort, limit ? parseInt(limit, 10) : undefined, offset ? parseInt(offset, 10) : undefined);
  });

  app.post("/datasets/:datasetId/rows", async (request, reply) => {
    const { datasetId } = request.params as { datasetId: string };
    const body = request.body as { data: Record<string, unknown> };
    try {
      const row = await apiStore.createDatasetRow(datasetId, body.data ?? body);
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
      const rows = await apiStore.createDatasetRowsBatch(datasetId, body.rows ?? body);
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
      return await apiStore.updateDatasetRow(rowId, body.data ?? body);
    } catch {
      return reply.code(404).send({ message: "Dataset row not found" });
    }
  });

  app.delete("/datasets/:datasetId/rows/:rowId", async (request, reply) => {
    const { rowId } = request.params as { datasetId: string; rowId: string };
    try {
      return await apiStore.deleteDatasetRow(rowId);
    } catch {
      return reply.code(404).send({ message: "Dataset row not found" });
    }
  });

  app.get("/datasets/:datasetId/search", async (request, reply) => {
    const { datasetId } = request.params as { datasetId: string };
    const { q } = (request.query ?? {}) as { q?: string };
    const dataset = await apiStore.getDataset(datasetId);
    if (!dataset) return reply.code(404).send({ message: "Dataset not found" });
    return apiStore.searchDatasetRows(datasetId, q ?? "");
  });

  app.post("/datasets/:datasetId/query", async (request, reply) => {
    const { datasetId } = request.params as { datasetId: string };
    const { filters } = request.body as { filters: Array<{ column: string; op: string; value: unknown }> };
    const dataset = await apiStore.getDataset(datasetId);
    if (!dataset) return reply.code(404).send({ message: "Dataset not found" });
    return apiStore.queryDataset(datasetId, filters as Parameters<typeof apiStore.queryDataset>[1]);
  });

  // ── Settings Routes ──────────────────────────────────────────────────

  app.get("/settings", async () => apiStore.getSettings());

  app.patch("/settings", async (request) => {
    const patch = request.body as Record<string, unknown>;
    return apiStore.updateSettings(patch as Parameters<typeof apiStore.updateSettings>[0]);
  });

  // ── Auth Routes ──────────────────────────────────────────────────────

  app.post("/auth/login", async (request, reply) => {
    const { email, password } = request.body as { email: string; password?: string };
    if (!email) return reply.code(400).send({ message: "Email is required" });
    try {
      const result = await apiStore.login(email, password);
      return result;
    } catch (error) {
      return reply.code(401).send({ message: error instanceof Error ? error.message : "Login failed" });
    }
  });

  app.post("/auth/logout", async (request, reply) => {
    const { token } = request.body as { token?: string };
    const headerToken = (request.headers.authorization ?? "").replace("Bearer ", "");
    const resolvedToken = token || headerToken;
    if (!resolvedToken) return reply.code(400).send({ message: "Token is required" });
    await apiStore.logout(resolvedToken);
    return { ok: true };
  });

  app.get("/auth/me", async (request, reply) => {
    const token = (request.headers.authorization ?? "").replace("Bearer ", "");
    if (!token) return reply.code(401).send({ message: "Not authenticated" });
    const user = await apiStore.validateToken(token);
    if (!user) return reply.code(401).send({ message: "Invalid or expired token" });
    return user;
  });

  // ── User Routes ─────────────────────────────────────────────────────

  app.get("/users", async () => {
    const users = await apiStore.listUsers();
    return users.map(({ passwordHash, ...u }: any) => u);
  });

  app.post("/users", async (request, reply) => {
    const body = request.body as CreateUserInput;
    if (!body.email || !body.name || !body.role) {
      return reply.code(400).send({ message: "email, name, and role are required" });
    }
    try {
      const user = await apiStore.createUser(body);
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
      const user = await apiStore.updateUser(userId, patch);
      const { passwordHash, ...safeUser } = user as any;
      return safeUser;
    } catch (error) {
      return reply.code(404).send({ message: error instanceof Error ? error.message : "User not found" });
    }
  });

  app.delete("/users/:userId", async (request, reply) => {
    const { userId } = request.params as { userId: string };
    try {
      const user = await apiStore.deleteUser(userId);
      const { passwordHash, ...safeUser } = user as any;
      return safeUser;
    } catch (error) {
      return reply.code(404).send({ message: error instanceof Error ? error.message : "User not found" });
    }
  });

  app.register(agentRoutes);

  return app;
}

export const createBidwrightServer = buildServer;
