import { prisma } from "@bidwright/db";
import { summarizeDocumentCoverage, type SourceReadRecord } from "@bidwright/domain";

export async function getDocumentCoverage(projectId: string, db: Pick<typeof prisma, "sourceDocument" | "activity" | "evidenceView" | "fileNode"> = prisma) {
  const [documents, activity, views, files] = await Promise.all([
    db.sourceDocument.findMany({ where: { projectId }, select: { id: true, fileName: true, pageCount: true, checksum: true } }),
    db.activity.findMany({ where: { projectId, type: "source_read" }, select: { data: true }, orderBy: { createdAt: "desc" }, take: 5000 }),
    db.evidenceView.findMany({ where: { projectId }, select: { documentId: true, pageNumber: true, tool: true, sourceChecksum: true }, take: 5000, orderBy: { createdAt: "desc" } }),
    db.fileNode.findMany({ where: { projectId, scope: "project", type: "file" }, select: { id: true, name: true, documentId: true, metadata: true } }),
  ]);
  // createProjectFile deliverables carry this flag; extracted source imports do not.
  // Also omit linked extractions of outputs, without guessing from names/extensions.
  const outputs = files.filter(f => (f.metadata as any)?.createdByAgent === true);
  const outputDocuments = new Set(outputs.map(f => f.documentId ?? String((f.metadata as any)?.sourceDocumentId ?? "")));
  const sourceDocuments = documents.filter(d => !outputDocuments.has(d.id));
  const sourceFiles = files.filter(f => (f.metadata as any)?.createdByAgent !== true);
  const documentIds = new Set(documents.map(d => d.id));
  const sources = [...sourceDocuments.map(d => ({ ...d, name: d.fileName })), ...sourceFiles.filter(f => !documentIds.has(f.documentId ?? String((f.metadata as any)?.sourceDocumentId ?? ""))).map(f => ({ id: f.id, name: f.name, pageCount: null, checksum: null }))];
  const aliases = new Map(files.flatMap(f => {
    const id = f.documentId ?? String((f.metadata as any)?.sourceDocumentId ?? f.id);
    return [[f.id, id], [`file-${f.id}`, id]] as Array<[string, string]>;
  }));
  const normalize = (id?: string | null) => id ? aliases.get(id) ?? id : id;
  return { ...summarizeDocumentCoverage(sources, activity.map(a => { const r = a.data as unknown as SourceReadRecord; return { ...r, documentId: normalize(r.documentId)! }; }), views.map(v => ({ ...v, documentId: normalize(v.documentId) }))), historyLimited: activity.length === 5000 || views.length === 5000 };
}
