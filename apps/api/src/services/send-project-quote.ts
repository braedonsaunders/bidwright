import type { PrismaApiStore } from "../prisma-store.js";
import type { PdfLayoutOptions } from "./pdf-service.js";
import { renderQuotePdf } from "./quote-pdf.js";
import { sendQuoteEmail } from "./email-service.js";

type QuoteStore = Pick<PrismaApiStore, "getSettings" | "getFileNode" | "getDocument" | "listReportSections" | "logActivity">;
type Workspace = NonNullable<Awaited<ReturnType<PrismaApiStore["getWorkspace"]>>>;

export async function sendProjectQuote(
  store: QuoteStore,
  projectId: string,
  workspace: Workspace,
  input: { contacts: string[]; message: string },
  { render = renderQuotePdf, send = sendQuoteEmail } = {},
) {
  const revision = workspace.currentRevision;
  if (!revision) throw new Error("No current quote revision");
  const quoteNumber = workspace.quote?.quoteNumber ?? projectId;
  const preferences = revision.pdfPreferences ?? {};
  // Email always uses the customer proposal, even when PDF Studio last showed an internal report.
  const layouts = preferences.layouts as Record<string, Partial<PdfLayoutOptions>> | undefined;
  const layout = layouts?.main ?? (layouts || (preferences.activeTemplate && preferences.activeTemplate !== "main")
    ? undefined : preferences as Partial<PdfLayoutOptions>);
  const pdf = await render(store, projectId, workspace, "main", layout);
  // Do not send an incomplete quote if a selected appendix could not be loaded.
  if (pdf.warnings.length) throw new Error(`Quote PDF could not be completed: ${pdf.warnings.join("; ")}`);
  if (pdf.contentType !== "application/pdf" || pdf.buffer.subarray(0, 5).toString() !== "%PDF-") {
    throw new Error("Quote PDF generation returned invalid PDF bytes");
  }
  const filename = `Quote-${quoteNumber}-Rev-${revision.revisionNumber}.pdf`.replace(/[^a-zA-Z0-9._-]/g, "_");
  const result = await send({
    to: input.contacts,
    subject: `Quote ${quoteNumber} – ${revision.title ?? workspace.project?.name ?? ""}`,
    message: input.message,
    quoteNumber,
    pdf: { filename, content: pdf.buffer },
  });
  if (result.sent) {
    await store.logActivity(projectId, revision.id, "quote_sent", {
      recipients: input.contacts,
      quoteNumber,
      filename,
    });
  }
  return result;
}
