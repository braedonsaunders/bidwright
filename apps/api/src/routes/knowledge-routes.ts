import type { FastifyInstance } from "fastify";
import { knowledgeService } from "../services/knowledge-service.js";
import { createPdfParser } from "@bidwright/ingestion";
import { prisma } from "@bidwright/db";
import { resolveApiPath } from "../paths.js";
import { readFile } from "node:fs/promises";
import * as XLSX from "xlsx";
import { analyzeImport } from "../services/catalog-import-service.js";

/**
 * Knowledge API routes — Fastify plugin.
 *
 * Provides enhanced document ingestion, search, and analysis endpoints
 * that orchestrate the full knowledge pipeline.
 */
export async function knowledgeRoutes(app: FastifyInstance) {
  // ── POST /api/knowledge/ingest-file ─────────────────────────────────
  // Upload and ingest a file via multipart/form-data.
  // Fields: file (binary), title, category, scope, projectId?, chunkStrategy?, chunkSize?
  app.post("/knowledge/ingest-file", async (request, reply) => {
    try {
      const parts = request.parts();
      let fileBuffer: Buffer | undefined;
      let fileName = "";
      let mimeType = "";
      const fields: Record<string, string> = {};

      for await (const part of parts) {
        if (part.type === "file") {
          const chunks: Buffer[] = [];
          for await (const chunk of part.file) {
            chunks.push(chunk);
          }
          fileBuffer = Buffer.concat(chunks);
          fileName = part.filename ?? "upload";
          mimeType = part.mimetype ?? "application/octet-stream";
        } else {
          fields[part.fieldname] = (part as unknown as { value: string }).value;
        }
      }

      if (!fileBuffer || fileBuffer.length === 0) {
        return reply.code(400).send({ message: "No file provided" });
      }

      if (!fields.title) {
        return reply.code(400).send({ message: "Title is required" });
      }

      if (!fields.category) {
        return reply.code(400).send({ message: "Category is required" });
      }

      const ingestionRequest = {
        file: { buffer: fileBuffer, filename: fileName, mimeType },
        title: fields.title,
        category: fields.category as "estimating" | "labour" | "equipment" | "materials" | "safety" | "standards" | "general",
        scope: (fields.scope as "global" | "project") ?? "global",
        projectId: fields.projectId || undefined,
        cabinetId: fields.cabinetId || undefined,
        organizationId: request.user?.organizationId ?? undefined,
        options: {
          chunkStrategy: (fields.chunkStrategy as "recursive" | "section-aware" | "page") || undefined,
          chunkSize: fields.chunkSize ? parseInt(fields.chunkSize, 10) : undefined,
          enableContextualEnrichment: fields.enableContextualEnrichment === "true",
          enableEmbeddings: fields.enableEmbeddings === "false" ? false : true,
        },
      };

      // Create the book record quickly and respond immediately
      const { bookId } = await knowledgeService.createBookRecord(ingestionRequest, request.store!);

      // Fire-and-forget: process text extraction, chunking, embeddings in background
      knowledgeService.processBookBackground(bookId, ingestionRequest, request.store!).catch((err) => {
        request.log.error(err, `Background processing failed for book ${bookId}`);
      });

      // Return the newly created book so the UI can display it
      const book = await prisma.knowledgeBook.findUnique({ where: { id: bookId } });
      reply.code(201);
      return book;
    } catch (err) {
      request.log.error(err, "Knowledge ingest-file failed");
      return reply.code(500).send({
        message: "Ingestion failed",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  // ── POST /api/knowledge/ingest-text ─────────────────────────────────
  // Ingest raw text content.
  app.post("/api/knowledge/ingest-text", async (request, reply) => {
    try {
      const body = request.body as {
        title: string;
        content: string;
        category: string;
        scope?: string;
        projectId?: string;
        cabinetId?: string;
        options?: {
          chunkStrategy?: string;
          chunkSize?: number;
          enableContextualEnrichment?: boolean;
          enableEmbeddings?: boolean;
        };
      };

      if (!body.title) {
        return reply.code(400).send({ message: "Title is required" });
      }
      if (!body.content) {
        return reply.code(400).send({ message: "Content is required" });
      }
      if (!body.category) {
        return reply.code(400).send({ message: "Category is required" });
      }

      const result = await knowledgeService.ingestDocument({
        content: body.content,
        title: body.title,
        category: body.category as "estimating" | "labour" | "equipment" | "materials" | "safety" | "standards" | "general",
        scope: (body.scope as "global" | "project") ?? "global",
        projectId: body.projectId || undefined,
        cabinetId: body.cabinetId || undefined,
        organizationId: request.user?.organizationId ?? undefined,
        options: {
          chunkStrategy: (body.options?.chunkStrategy as "recursive" | "section-aware" | "page") || undefined,
          chunkSize: body.options?.chunkSize,
          enableContextualEnrichment: body.options?.enableContextualEnrichment,
          enableEmbeddings: body.options?.enableEmbeddings,
        },
      }, request.store!);

      reply.code(201);
      return result;
    } catch (err) {
      request.log.error(err, "Knowledge ingest-text failed");
      return reply.code(500).send({
        message: "Ingestion failed",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  // ── GET /api/knowledge/search/enhanced ──────────────────────────────
  // Enhanced knowledge search with hybrid scoring.
  app.get("/api/knowledge/search/enhanced", async (request, reply) => {
    try {
      const query = request.query as {
        q?: string;
        projectId?: string;
        bookId?: string;
        documentId?: string;
        scope?: string;
        limit?: string;
        includeProjectDocs?: string;
      };

      if (!query.q) {
        return reply.code(400).send({ message: "Query parameter 'q' is required" });
      }

      const results = await knowledgeService.search(query.q, {
        organizationId: request.user?.organizationId ?? undefined,
        projectId: query.projectId,
        bookId: query.bookId,
        documentId: query.documentId,
        scope: (query.scope as "global" | "project" | "all") || undefined,
        limit: query.limit ? parseInt(query.limit, 10) : undefined,
        includeProjectDocs: query.includeProjectDocs === "true",
      }, request.store!);

      return {
        hits: results,
        query: query.q,
        count: results.length,
      };
    } catch (err) {
      request.log.error(err, "Knowledge enhanced search failed");
      return reply.code(500).send({
        message: "Search failed",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  // ── POST /api/knowledge/analyze ─────────────────────────────────────
  // Analyze a document using AI.
  app.post("/api/knowledge/analyze", async (request, reply) => {
    try {
      const body = request.body as {
        documentId: string;
        projectId: string;
        analysisType: string;
        focusArea?: string;
      };

      if (!body.documentId) {
        return reply.code(400).send({ message: "documentId is required" });
      }
      if (!body.projectId) {
        return reply.code(400).send({ message: "projectId is required" });
      }
      if (!body.analysisType) {
        return reply.code(400).send({ message: "analysisType is required" });
      }

      const result = await knowledgeService.analyzeDocument(
        body.documentId,
        body.projectId,
        body.analysisType,
        body.focusArea,
        request.store!,
      );

      return result;
    } catch (err) {
      request.log.error(err, "Knowledge analysis failed");
      return reply.code(500).send({
        message: "Analysis failed",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  // ── GET /api/knowledge/documents/:projectId/enhanced ──────────────────
  // List project documents with enhanced metadata (status, type, chunk count).
  app.get("/api/knowledge/documents/:projectId/enhanced", async (request, reply) => {
    try {
      const { projectId } = request.params as { projectId: string };

      // Get source documents
      const docs = await request.store!.listDocuments(projectId);

      // Get knowledge library items scoped to this project
      const [books, knowledgeDocuments] = await Promise.all([
        request.store!.listKnowledgeBooks(projectId),
        request.store!.listKnowledgeDocuments(projectId),
      ]);

      // Build enhanced list
      const enhanced = docs.map((doc: any) => {
        const matchingBook = books.find(
          (b) => b.sourceFileName === doc.fileName || b.name === doc.fileName
        );

        return {
          id: doc.id,
          fileName: doc.fileName,
          fileType: doc.fileType,
          documentType: doc.documentType,
          pageCount: doc.pageCount,
          hasExtractedText: !!doc.extractedText,
          hasStructuredData: !!(doc.structuredData && (
            (doc.structuredData as any).tables?.length > 0 ||
            (doc.structuredData as any).keyValuePairs?.length > 0
          )),
          createdAt: doc.createdAt,
          knowledgeBookId: matchingBook?.id ?? null,
          indexingStatus: matchingBook?.status ?? "unprocessed",
          chunkCount: matchingBook?.chunkCount ?? 0,
          category: matchingBook?.category ?? null,
        };
      });

      const manualPages = knowledgeDocuments.map((doc: any) => ({
        id: doc.id,
        fileName: doc.title,
        fileType: "markdown",
        documentType: "knowledge_page",
        pageCount: doc.pageCount,
        hasExtractedText: doc.chunkCount > 0,
        hasStructuredData: false,
        createdAt: doc.createdAt,
        knowledgeDocumentId: doc.id,
        indexingStatus: doc.status,
        chunkCount: doc.chunkCount,
        category: doc.category,
        sourceType: "knowledge_document",
      }));

      return { documents: [...enhanced, ...manualPages], projectId };
    } catch (err) {
      request.log.error(err, "List documents failed");
      return reply.code(500).send({
        message: "Failed to list documents",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  // ── GET /api/knowledge/documents/:projectId/:documentId ─────────────
  // Read a specific document with optional page range.
  app.get("/api/knowledge/documents/:projectId/:documentId", async (request, reply) => {
    try {
      const { projectId, documentId } = request.params as { projectId: string; documentId: string };
      const { pages } = (request.query ?? {}) as { pages?: string };

      // Try source documents first
      const docs = await request.store!.listDocuments(projectId);
      const doc = docs.find((d: any) => d.id === documentId);

      if (doc) {
        let content = doc.extractedText ?? "";

        // If pages specified, try to extract page range
        if (pages && content) {
          const pageSegments = content.split(/\f|---\s*Page\s+\d+\s*---/i);
          const [startStr, endStr] = pages.split("-");
          const start = Math.max(1, parseInt(startStr, 10) || 1);
          const end = endStr ? Math.min(pageSegments.length, parseInt(endStr, 10)) : start;
          content = pageSegments.slice(start - 1, end).join("\n\n");
        }

        return {
          id: doc.id,
          fileName: doc.fileName,
          fileType: doc.fileType,
          documentType: doc.documentType,
          pageCount: doc.pageCount,
          content,
          structuredData: doc.structuredData ?? null,
        };
      }

      // Try knowledge books
      const book = await request.store!.getKnowledgeBook(documentId);
      if (book) {
        const chunks = await request.store!.listKnowledgeChunks(documentId);

        let filteredChunks = chunks;
        if (pages) {
          const [startStr, endStr] = pages.split("-");
          const start = parseInt(startStr, 10) || 1;
          const end = endStr ? parseInt(endStr, 10) : start;
          filteredChunks = chunks.filter(
            (c) => c.pageNumber !== null && c.pageNumber >= start && c.pageNumber <= end
          );
        }

        return {
          id: book.id,
          fileName: book.sourceFileName,
          bookName: book.name,
          category: book.category,
          pageCount: book.pageCount,
          chunkCount: book.chunkCount,
          content: filteredChunks.map((c) => c.text).join("\n\n"),
          chunks: filteredChunks.map((c) => ({
            id: c.id,
            sectionTitle: c.sectionTitle,
            pageNumber: c.pageNumber,
            text: c.text,
            tokenCount: c.tokenCount,
          })),
        };
      }

      const knowledgeDocument = await request.store!.getKnowledgeDocument(documentId);
      if (knowledgeDocument) {
        let pagesToRead = await request.store!.listKnowledgeDocumentPages(documentId);
        if (pages) {
          const [startStr, endStr] = pages.split("-");
          const start = Math.max(1, parseInt(startStr, 10) || 1);
          const end = endStr ? parseInt(endStr, 10) : start;
          pagesToRead = pagesToRead.filter((page: any) => page.order + 1 >= start && page.order + 1 <= end);
        }

        const chunks = await request.store!.listKnowledgeDocumentChunks(documentId);
        const pageIds = new Set(pagesToRead.map((page: any) => page.id));
        const filteredChunks = chunks.filter((chunk: any) => !chunk.pageId || pageIds.has(chunk.pageId));

        return {
          id: knowledgeDocument.id,
          fileName: knowledgeDocument.title,
          documentTitle: knowledgeDocument.title,
          category: knowledgeDocument.category,
          pageCount: knowledgeDocument.pageCount,
          chunkCount: knowledgeDocument.chunkCount,
          sourceType: "knowledge_document",
          content: pagesToRead.map((page: any) => `# ${page.title}\n\n${page.contentMarkdown || page.plainText}`).join("\n\n---\n\n"),
          pages: pagesToRead.map((page: any) => ({
            id: page.id,
            title: page.title,
            order: page.order,
            contentMarkdown: page.contentMarkdown,
          })),
          chunks: filteredChunks.map((chunk: any) => ({
            id: chunk.id,
            pageId: chunk.pageId,
            sectionTitle: chunk.sectionTitle,
            text: chunk.text,
            tokenCount: chunk.tokenCount,
          })),
        };
      }

      return reply.code(404).send({ message: "Document not found" });
    } catch (err) {
      request.log.error(err, "Read document failed");
      return reply.code(500).send({
        message: "Failed to read document",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  // ── POST /api/knowledge/extract-structured ───────────────────────────
  // Run Azure Document Intelligence on a document for structured extraction.
  app.post("/api/knowledge/extract-structured", async (request, reply) => {
    try {
      const body = request.body as {
        documentId: string;
        projectId?: string;
        model?: "prebuilt-layout" | "prebuilt-document" | "prebuilt-invoice" | "prebuilt-read";
        updateDocument?: boolean;
      };

      if (!body.documentId) {
        return reply.code(400).send({ message: "documentId is required" });
      }

      // Resolve Azure DI credentials: org settings first, then env vars
      const settings = await request.store!.getSettings();
      const integrations = settings.integrations ?? {} as any;
      const azureEndpoint = integrations.azureDiEndpoint || process.env.AZURE_DI_ENDPOINT;
      const azureKey = integrations.azureDiKey || process.env.AZURE_DI_KEY;
      if (!azureEndpoint || !azureKey) {
        return reply.code(503).send({
          message: "Azure Document Intelligence not configured. Add credentials in Settings > Integrations > API Keys.",
        });
      }

      // Try to find the document as a KnowledgeBook first, then as a SourceDocument
      let fileBuffer: Buffer | undefined;
      let fileName = "document.pdf";

      const book = await prisma.knowledgeBook.findUnique({ where: { id: body.documentId } });
      if (book?.storagePath) {
        const absPath = resolveApiPath(book.storagePath);
        fileBuffer = await readFile(absPath);
        fileName = book.sourceFileName ?? fileName;
      }

      if (!fileBuffer) {
        const sourceDoc = await prisma.sourceDocument.findUnique({ where: { id: body.documentId } });
        if (sourceDoc?.storagePath) {
          const absPath = resolveApiPath(sourceDoc.storagePath);
          fileBuffer = await readFile(absPath);
          fileName = sourceDoc.fileName ?? fileName;
        }
      }

      if (!fileBuffer) {
        return reply.code(404).send({ message: "Document file not found on disk" });
      }

      // Run Azure Document Intelligence
      const parser = createPdfParser({
        provider: "azure",
        azureEndpoint,
        azureKey,
        azureModel: body.model ?? "prebuilt-layout",
      });

      const doc = await parser.parse(fileBuffer, fileName);

      // Optionally update the stored document with richer extraction
      if (body.updateDocument && book) {
        const enrichedText = doc.pages.map((p) => p.content).join("\n\n--- Page Break ---\n\n");
        await prisma.knowledgeBook.update({
          where: { id: book.id },
          data: {
            metadata: {
              ...(typeof book.metadata === "object" && book.metadata !== null ? book.metadata : {}),
              azureExtracted: true,
              keyValuePairs: doc.metadata.keyValuePairs ?? [],
              selectionMarks: doc.metadata.selectionMarks ?? [],
              tableCount: doc.tables.length,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } as any,
          },
        });
      }

      return {
        success: true,
        data: {
          content: doc.content,
          pageCount: doc.metadata.pageCount,
          tables: doc.tables,
          keyValuePairs: doc.metadata.keyValuePairs ?? [],
          selectionMarks: doc.metadata.selectionMarks ?? [],
          pages: doc.pages.map((p) => ({
            pageNumber: p.pageNumber,
            content: p.content,
            sectionCount: p.sections.length,
          })),
          warnings: doc.warnings,
        },
      };
    } catch (err) {
      request.log.error(err, "Structured extraction failed");
      return reply.code(500).send({
        message: "Structured extraction failed",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  // ── GET /api/knowledge/read-spreadsheet/:documentId ─────────────────
  // Read an xlsx/xls/csv file and return its contents as markdown tables.
  // Used by CLI agent tools to read spreadsheet documents that Claude Code
  // cannot natively parse (xlsx is binary).
  app.get("/api/knowledge/read-spreadsheet/:documentId", async (request, reply) => {
    try {
      const { documentId } = request.params as { documentId: string };
      const sheetName = (request.query as any)?.sheet as string | undefined;

      // Find the document (project SourceDocument or KnowledgeBook)
      let fileBuffer: Buffer | undefined;
      let fileName = "spreadsheet.xlsx";

      const sourceDoc = await prisma.sourceDocument.findUnique({ where: { id: documentId } });
      if (sourceDoc?.storagePath) {
        const absPath = resolveApiPath(sourceDoc.storagePath);
        fileBuffer = await readFile(absPath);
        fileName = sourceDoc.fileName ?? fileName;
      }

      if (!fileBuffer) {
        const book = await prisma.knowledgeBook.findUnique({ where: { id: documentId } });
        if (book?.storagePath) {
          const absPath = resolveApiPath(book.storagePath);
          fileBuffer = await readFile(absPath);
          fileName = book.sourceFileName ?? fileName;
        }
      }

      if (!fileBuffer) {
        return reply.code(404).send({ message: "Document file not found on disk" });
      }

      // Parse the spreadsheet
      const workbook = XLSX.read(fileBuffer, { type: "buffer" });
      const sheetNames = workbook.SheetNames;

      // If a specific sheet is requested, return just that one
      const sheetsToProcess = sheetName
        ? sheetNames.filter(s => s.toLowerCase() === sheetName.toLowerCase())
        : sheetNames;

      if (sheetName && sheetsToProcess.length === 0) {
        return reply.code(404).send({
          message: `Sheet "${sheetName}" not found. Available sheets: ${sheetNames.join(", ")}`,
        });
      }

      // Convert each sheet to markdown table
      const sheets: Array<{ name: string; rowCount: number; markdown: string }> = [];
      for (const name of sheetsToProcess) {
        const ws = workbook.Sheets[name];
        if (!ws) continue;

        // Get as array of arrays for markdown conversion
        const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
        if (rows.length === 0) {
          sheets.push({ name, rowCount: 0, markdown: "(empty sheet)" });
          continue;
        }

        // Build markdown table
        const header = rows[0].map((c: any) => String(c ?? "").trim());
        const separator = header.map(() => "---");
        const dataRows = rows.slice(1).map(row =>
          row.map((c: any) => String(c ?? "").trim())
        );

        // Pad rows to header length
        const colCount = header.length;
        const mdRows = [
          `| ${header.join(" | ")} |`,
          `| ${separator.join(" | ")} |`,
          ...dataRows.map(r => {
            while (r.length < colCount) r.push("");
            return `| ${r.slice(0, colCount).join(" | ")} |`;
          }),
        ];

        sheets.push({ name, rowCount: dataRows.length, markdown: mdRows.join("\n") });
      }

      return {
        fileName,
        sheetCount: sheetNames.length,
        allSheetNames: sheetNames,
        sheets,
      };
    } catch (err) {
      request.log.error(err, "Spreadsheet reading failed");
      return reply.code(500).send({
        message: "Spreadsheet reading failed",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  // ── POST /api/knowledge/books/:bookId/analyze-import ────────────────
  // Reads the original uploaded file for a knowledge book and runs the
  // catalog-import analyzer so the user can pull rate sheets / supplier
  // price lists into a catalog without re-uploading.
  app.post("/knowledge/books/:bookId/analyze-import", async (request, reply) => {
    const { bookId } = request.params as { bookId: string };
    try {
      const book = await prisma.knowledgeBook.findUnique({ where: { id: bookId } });
      if (!book?.storagePath) {
        return reply.code(404).send({ message: "Source file not available for this book" });
      }
      const absPath = resolveApiPath(book.storagePath);
      const buffer = await readFile(absPath);
      const apiKey = process.env.ANTHROPIC_API_KEY ?? process.env.OPENAI_API_KEY ?? "";
      const provider = process.env.ANTHROPIC_API_KEY ? "anthropic" : "openai";
      const model = process.env.LLM_MODEL ?? (provider === "anthropic" ? "claude-sonnet-4-20250514" : "gpt-4o");
      const analysis = await analyzeImport({
        buffer,
        filename: book.sourceFileName || "upload",
        aiConfig: apiKey ? { provider, apiKey, model } : undefined,
      });
      return analysis;
    } catch (err) {
      request.log.error(err, "Knowledge book analyze-import failed");
      return reply.code(500).send({ message: err instanceof Error ? err.message : "Analyze failed" });
    }
  });
}
