import { prisma } from "@bidwright/db";
import { generateFileIngestManifest, getFileIngestCapabilities } from "./file-ingest/orchestrator.js";
import type { FileIngestSettings, FileIngestSource, FileIngestSourceKind } from "./file-ingest/types.js";

async function getProjectFileIngestSettings(projectId: string): Promise<FileIngestSettings> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { organizationId: true },
  });
  if (!project) throw new Error(`Project ${projectId} not found`);
  const settings = await prisma.organizationSettings.findUnique({
    where: { organizationId: project.organizationId },
    select: { integrations: true },
  });
  const integrations = settings?.integrations;
  return integrations && typeof integrations === "object" && !Array.isArray(integrations)
    ? { integrations: integrations as Record<string, unknown> }
    : {};
}

export async function getProjectFileIngestCapabilities(projectId: string, format?: string) {
  const settings = await getProjectFileIngestSettings(projectId);
  return {
    capabilities: await getFileIngestCapabilities(format, settings),
  };
}

export async function resolveProjectFileIngestSource(
  projectId: string,
  sourceKind: Exclude<FileIngestSourceKind, "raw_file">,
  sourceId: string,
): Promise<FileIngestSource> {
  if (sourceKind === "source_document") {
    const doc = await prisma.sourceDocument.findFirst({ where: { id: sourceId, projectId } });
    if (!doc) throw new Error(`Source document ${sourceId} not found`);
    return {
      id: doc.id,
      source: "source_document",
      projectId: doc.projectId,
      fileName: doc.fileName,
      fileType: doc.fileType,
      storagePath: doc.storagePath,
      checksum: doc.checksum,
      size: null,
      metadata: {
        documentType: doc.documentType,
        pageCount: doc.pageCount,
        hasExtractedText: Boolean(doc.extractedText),
        hasStructuredData: Boolean(doc.structuredData),
      },
    };
  }

  const node = await prisma.fileNode.findFirst({ where: { id: sourceId, projectId, type: "file" } });
  if (!node) throw new Error(`File node ${sourceId} not found`);
  return {
    id: node.id,
    source: "file_node",
    projectId: node.projectId,
    fileName: node.name,
    fileType: node.fileType,
    storagePath: node.storagePath,
    checksum: null,
    size: node.size,
    metadata: node.metadata,
  };
}

export async function ingestProjectFileSource(args: {
  projectId: string;
  sourceKind: Exclude<FileIngestSourceKind, "raw_file">;
  sourceId: string;
}) {
  const source = await resolveProjectFileIngestSource(args.projectId, args.sourceKind, args.sourceId);
  const settings = await getProjectFileIngestSettings(args.projectId);
  return generateFileIngestManifest(source, settings);
}
