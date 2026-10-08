import type { PrismaApiStore } from "../prisma-store.js";
import { resolveApiPath } from "../paths.js";
import { buildPdfDataPackage, generatePdfHtml, generatePdfBuffer, buildSchedulePdfData, generateSchedulePdfHtml, type PdfLayoutOptions } from "./pdf-service.js";
import { loadQuotePdfAttachmentBytes, mergePdfBuffers, quotePdfSegmentsFromLayout } from "./pdf-attachments.js";

type QuotePdfStore = Pick<PrismaApiStore, "listReportSections" | "getFileNode" | "getDocument" | "getSettings">;
type Workspace = NonNullable<Awaited<ReturnType<PrismaApiStore["getWorkspace"]>>>;

/** Shared by PDF download and email; render from the caller's single revision snapshot. */
export async function renderQuotePdf(
  store: QuotePdfStore,
  projectId: string,
  workspace: Workspace,
  templateType: string,
  layoutOptions?: Partial<PdfLayoutOptions>,
  render = generatePdfBuffer,
): Promise<{ buffer: Buffer; contentType: string; warnings: string[] }> {
  const reportSections = await store.listReportSections(projectId);

  // Resolve image file paths for report sections so the PDF renderer can embed them
  for (const section of reportSections) {
    if (section.sectionType === "image" && section.content) {
      try {
        const parsed = JSON.parse(section.content);
        if (parsed.fileNodeId) {
          const node = await store.getFileNode(parsed.fileNodeId);
          if (node?.storagePath && node.projectId === projectId) {
            parsed.resolvedImagePath = resolveApiPath(node.storagePath);
            section.content = JSON.stringify(parsed);
          }
        }
      } catch { /* not JSON, skip */ }
    }
  }

  const orgSettings = await store.getSettings();
  const pdfData = buildPdfDataPackage(workspace, reportSections, {
    termsAndConditions: orgSettings.termsAndConditions || "",
    companyName: orgSettings.general?.orgName || orgSettings.brand?.companyName || "",
    logoUrl: orgSettings.general?.logoUrl || orgSettings.brand?.logoUrl || "",
    website: orgSettings.general?.website || orgSettings.brand?.websiteUrl || "",
  });

  const { segments } = quotePdfSegmentsFromLayout(layoutOptions);
  const warnings: string[] = [];
  const parts: Buffer[] = [];
  const needsMerge = segments.some((segment) => segment.kind !== "html");

  if (!needsMerge) {
    const html = generatePdfHtml(pdfData, templateType, layoutOptions);
    const { buffer, contentType } = await render(html, layoutOptions);
    return { buffer, contentType, warnings };
  }

  for (const segment of segments) {
    if (segment.kind === "html") {
      const html = generatePdfHtml(pdfData, templateType, {
        ...layoutOptions,
        sectionOrder: segment.sectionKeys,
        freezeSectionOrder: true,
      });
      const { buffer } = await render(html, layoutOptions);
      parts.push(buffer);
      continue;
    }
    if (segment.kind === "schedule") {
      const scheduleHtml = generateSchedulePdfHtml(buildSchedulePdfData(workspace));
      const { buffer } = await render(scheduleHtml, {
        pageSetup: {
          orientation: "landscape",
          pageSize: layoutOptions?.pageSetup?.pageSize ?? "letter",
        },
      });
      parts.push(buffer);
      continue;
    }
    const loaded = await loadQuotePdfAttachmentBytes(store, projectId, segment.attachment);
    if (loaded.bytes) parts.push(loaded.bytes);
    else if (loaded.warning) warnings.push(loaded.warning);
  }

  if (parts.length === 0) {
    throw new Error(warnings[0] ?? "PDF generation produced no pages.");
  }
  const buffer = await mergePdfBuffers(parts);
  return { buffer, contentType: "application/pdf", warnings };
}
