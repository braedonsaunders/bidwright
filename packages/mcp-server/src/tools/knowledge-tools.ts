import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiGet, apiPost, projectPath, getProjectId } from "../api-client.js";

export function registerKnowledgeTools(server: McpServer) {

  // ── queryKnowledge ────────────────────────────────────────
  server.tool(
    "queryKnowledge",
    `Search the knowledge base for information. Searches both project documents and the global library (estimating manuals, rate books, standards). Use this to find man-hour estimates, material specs, labour productivity data, pricing references, and any domain knowledge. Returns text snippets with source, page number, and section title.`,
    {
      query: z.string().describe("Search query — be specific about what you need"),
      scope: z.enum(["project", "library", "all"]).default("all").describe("Search scope: project docs only, global library only, or all"),
      limit: z.number().default(10).describe("Max results to return"),
    },
    async ({ query, scope, limit }) => {
      // Use the text-based search which outperforms vector search for this use case
      const params = new URLSearchParams({ q: query, limit: String(limit), scope });
      const data = await apiGet(`/knowledge/search?${params}`);
      const results = Array.isArray(data) ? data : (data.results || []);
      const hits = results.map((h: any) => ({
        text: h.text?.substring(0, 600),
        source: h.source || h.bookName,
        sourceType: h.sourceType,
        bookName: h.bookName,
        documentTitle: h.documentTitle,
        pageTitle: h.pageTitle,
        documentId: h.documentId,
        pageId: h.pageId,
        sectionTitle: h.sectionTitle,
        pageNumber: h.pageNumber,
        score: h.score,
      }));
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ query, scope, resultCount: hits.length, hits }, null, 2) }],
      };
    }
  );

  // ── queryGlobalLibrary ────────────────────────────────────
  server.tool(
    "queryGlobalLibrary",
    "Search the global knowledge library only — estimating manuals, labour productivity data, rate books, material specs, industry standards. Use this for domain knowledge like pipe installation hours per foot, equipment rental rates, etc. Returns text snippets with source, page, and section.",
    {
      query: z.string().describe("What to search for — e.g. 'carbon steel butt weld pipe fittings labor hours'"),
      limit: z.number().default(10),
    },
    async ({ query, limit }) => {
      const params = new URLSearchParams({ q: query, scope: "global", limit: String(limit) });
      const data = await apiGet(`/knowledge/search?${params}`);
      const results = Array.isArray(data) ? data : (data.results || []);
      const hits = results.map((h: any) => ({
        text: h.text?.substring(0, 600),
        source: h.source || h.bookName,
        sourceType: h.sourceType,
        bookName: h.bookName,
        documentTitle: h.documentTitle,
        pageTitle: h.pageTitle,
        documentId: h.documentId,
        pageId: h.pageId,
        sectionTitle: h.sectionTitle,
        pageNumber: h.pageNumber,
        score: h.score,
      }));
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ query, resultCount: hits.length, hits }, null, 2) }],
      };
    }
  );

  // ── queryDatasets ─────────────────────────────────────────
  server.tool(
    "queryDatasets",
    "Search structured datasets for precise values — man hours, material weights, labour rates, equipment specs. Returns matching datasets with context (description, tags, notes) and sample rows. Use for concrete numbers when estimating.",
    {
      query: z.string().describe("Search query — e.g. 'weld neck flange 6 inch 150 lb man hours'"),
      datasetId: z.string().optional().describe("Search within a specific dataset ID (if known from previous query)"),
      limit: z.number().optional().default(5).describe("Max datasets to return"),
    },
    async ({ query, datasetId, limit }) => {
      if (datasetId) {
        // Search within specific dataset — returns rows
        const params = new URLSearchParams({ q: query });
        const data = await apiGet(`/datasets/${datasetId}/search?${params}`);
        const dataset = await apiGet(`/datasets/${datasetId}`);
        return { content: [{ type: "text" as const, text: JSON.stringify({
          dataset: {
            id: dataset.id,
            name: dataset.name,
            description: dataset.description,
            tags: dataset.tags,
            columns: dataset.columns,
          },
          rows: data.rows || data,
          note: "Use the description and tags to understand context. Column names show units and conditions.",
        }, null, 2) }] };
      }

      // Global search — returns matching datasets with sample rows
      const params = new URLSearchParams({ q: query, limit: String(limit || 5) });
      const data = await apiGet(`/datasets/search/global?${params}`);
      const results = (data.results || []).map((r: any) => ({
        datasetId: r.datasetId,
        name: r.datasetName,
        description: r.description,
        tags: r.tags,
        columns: r.columns?.map((c: any) => ({ key: c.key, name: c.name || c.label, type: c.type })),
        rowCount: r.rowCount,
        sampleRows: r.sampleRows,
        note: "Call queryDatasets again with datasetId to get all rows, or use these sample rows if sufficient.",
      }));
      return { content: [{ type: "text" as const, text: JSON.stringify({
        query,
        matchedDatasets: results.length,
        datasets: results,
      }, null, 2) }] };
    }
  );

  // ── createDataset ────────────────────────────────────────
  server.tool(
    "createDataset",
    "Create a new structured dataset with columns and rows. Use this to store extracted table data from knowledge books. Include rich tags for searchability.",
    {
      name: z.string().describe("Descriptive dataset name"),
      description: z.string().describe("What this dataset contains, source section, any conditions/notes"),
      category: z.enum(["estimating", "labour", "equipment", "materials", "safety", "standards", "custom"]).default("estimating"),
      tags: z.array(z.string()).describe("Rich search tags: material type, operation, units, etc."),
      sourceBookId: z.string().optional().describe("Knowledge book ID this was extracted from"),
      sourcePages: z.string().optional().describe("Page range(s) e.g. '85-87, 100'"),
      columns: z.array(z.object({
        key: z.string().describe("Column key (snake_case)"),
        label: z.string().describe("Human-readable column name"),
        type: z.enum(["string", "number", "date", "boolean"]).default("string"),
      })).describe("Column definitions"),
      rows: z.array(z.record(z.string(), z.any())).describe("Array of row objects with column keys as keys"),
    },
    async ({ name, description, category, tags, sourceBookId, sourcePages, columns, rows }) => {
      // Normalize columns: domain model uses 'name', agent sends 'label'
      const normalizedColumns = columns.map((col: any) => ({
        key: col.key,
        name: col.label || col.name || col.key,
        type: col.type === "string" ? "text" : col.type === "number" ? "number" : col.type || "text",
        required: false,
      }));

      // Create the dataset
      const dataset = await apiPost(`/datasets`, {
        name,
        description,
        category,
        scope: "global",
        columns: normalizedColumns,
        source: "book-extraction",
        sourceDescription: sourceBookId ? `Extracted from knowledge book ${sourceBookId}` : "AI extraction",
        sourceBookId,
        sourcePages: sourcePages || "",
        tags,
      });

      // Insert rows in batch
      if (rows.length > 0) {
        await apiPost(`/datasets/${dataset.id}/rows/batch`, { rows });
      }

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            success: true,
            datasetId: dataset.id,
            name,
            rowCount: rows.length,
            columnCount: columns.length,
            tags,
          }, null, 2),
        }],
      };
    }
  );

  // ── listDatasets ────────────────────────────────────────
  server.tool(
    "listDatasets",
    "List all existing datasets in the organization. Returns name, description, tags, row count, and column info.",
    {},
    async () => {
      const data = await apiGet(`/datasets`);
      const datasets = (Array.isArray(data) ? data : data.datasets || []).map((d: any) => ({
        id: d.id,
        name: d.name,
        description: d.description?.substring(0, 100),
        category: d.category,
        tags: d.tags,
        rowCount: d.rowCount,
        columns: d.columns?.map((c: any) => c.label || c.key),
        source: d.source,
      }));
      return { content: [{ type: "text" as const, text: JSON.stringify(datasets, null, 2) }] };
    }
  );

  // ── getDocumentStructured ─────────────────────────────────
  server.tool(
    "listKnowledgeBooks",
    "List the available knowledge books for this project and organization. Use this before reading handbook/reference content so you know the IDs to pass into readDocumentText.",
    {},
    async () => {
      const params = new URLSearchParams({ projectId: getProjectId() });
      const data = await apiGet(`/knowledge/books?${params}`);
      const books = (Array.isArray(data) ? data : []).map((book: any) => ({
        id: book.id,
        name: book.name,
        sourceFileName: book.sourceFileName,
        category: book.category,
        pageCount: book.pageCount,
        scope: book.scope,
        projectId: book.projectId,
      }));
      return { content: [{ type: "text" as const, text: JSON.stringify(books, null, 2) }] };
    }
  );

  server.tool(
    "listKnowledgeDocuments",
    "List manually-authored knowledge page libraries in the organization. Use these IDs with readDocumentText when you need full markdown content from a knowledge page search result.",
    {},
    async () => {
      const params = new URLSearchParams({ projectId: getProjectId() });
      const data = await apiGet(`/knowledge/documents?${params}`);
      const documents = (Array.isArray(data) ? data : []).map((document: any) => ({
        id: document.id,
        title: document.title,
        description: document.description,
        category: document.category,
        tags: document.tags,
        pageCount: document.pageCount,
        chunkCount: document.chunkCount,
        scope: document.scope,
        status: document.status,
      }));
      return { content: [{ type: "text" as const, text: JSON.stringify(documents, null, 2) }] };
    }
  );

  server.tool(
    "readDocumentText",
    "Read extracted text for a project document, knowledge book, or manually-authored knowledge page library by ID. Use IDs from the project manifest, listKnowledgeBooks, or listKnowledgeDocuments. For spreadsheets, use readSpreadsheet instead. For table-heavy PDFs, pair this with getDocumentStructured.",
    {
      documentId: z.string().describe("SourceDocument ID, KnowledgeBook ID, or KnowledgeDocument ID"),
      pages: z.string().optional().describe("Optional page range like '1-5' or single page like '12'"),
    },
    async ({ documentId, pages }) => {
      const params = pages ? `?pages=${encodeURIComponent(pages)}` : "";
      const data = await apiGet(`/api/knowledge/documents/${getProjectId()}/${documentId}${params}`);
      const doc = data.document || data;
      const sections = Array.isArray(doc.chunks)
        ? [...new Set(doc.chunks.map((chunk: any) => chunk.sectionTitle).filter(Boolean))]
        : [];
      const header = [
        `File: ${doc.fileName || doc.bookName || doc.documentTitle || documentId}`,
        doc.sourceType ? `Source type: ${doc.sourceType}` : null,
        doc.documentType ? `Type: ${doc.documentType}` : null,
        doc.category ? `Category: ${doc.category}` : null,
        doc.pageCount ? `Pages: ${doc.pageCount}` : null,
        pages ? `Requested pages: ${pages}` : null,
      ].filter(Boolean).join("\n");
      const content = typeof doc.content === "string" ? doc.content.trim() : "";

      let output = `${header}\n\n`;
      if (sections.length > 0) {
        output += `Sections: ${sections.join(", ")}\n\n`;
      }
      output += content || "(No extracted text available for this document.)";

      return { content: [{ type: "text" as const, text: output }] };
    }
  );

  server.tool(
    "getDocumentStructured",
    "Get the Azure Document Intelligence structured extraction for a project document — tables (as markdown), key-value pairs, section headings, page-by-page text. Use this when you need parsed table data or form fields from a PDF.",
    {
      documentId: z.string().describe("SourceDocument ID"),
    },
    async ({ documentId }) => {
      const data = await apiGet(`/api/knowledge/documents/${getProjectId()}/${documentId}`);
      // Return structured data if available
      const doc = data.document || data;
      const result: any = {
        fileName: doc.fileName,
        pageCount: doc.pageCount,
        documentType: doc.documentType,
      };
      if (doc.structuredData) {
        result.tables = doc.structuredData.tables;
        result.keyValuePairs = doc.structuredData.keyValuePairs;
      }
      // Include section headings from chunks if available
      if (doc.chunks) {
        result.sections = [...new Set(doc.chunks.map((c: any) => c.sectionTitle).filter(Boolean))];
      }
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  // ── readSpreadsheet ─────────────────────────────────────
  server.tool(
    "readSpreadsheet",
    "Read an xlsx/xls/csv spreadsheet and return its contents as markdown tables. Use this for ANY spreadsheet document — Claude Code cannot natively parse binary xlsx files. Returns all sheets (or a specific sheet) as readable markdown tables with headers.",
    {
      documentId: z.string().describe("SourceDocument ID of the spreadsheet file (from the document manifest in CLAUDE.md)"),
      sheet: z.string().optional().describe("Optional sheet name to read. If omitted, returns all sheets."),
    },
    async ({ documentId, sheet }) => {
      try {
        const params = sheet ? `?sheet=${encodeURIComponent(sheet)}` : "";
        const data = await apiGet(`/api/knowledge/read-spreadsheet/${documentId}${params}`);
        const result = data as any;

        // Build a readable text output
        let output = `📊 Spreadsheet: ${result.fileName}\n`;
        output += `Sheets: ${result.allSheetNames.join(", ")} (${result.sheetCount} total)\n\n`;

        for (const s of result.sheets) {
          output += `## Sheet: ${s.name} (${s.rowCount} rows)\n\n`;
          output += s.markdown + "\n\n";
        }

        return { content: [{ type: "text" as const, text: output }] };
      } catch (err: any) {
        return {
          content: [{ type: "text" as const, text: `ERROR reading spreadsheet: ${err?.message || String(err)}. This may not be a spreadsheet file, or the document ID may be wrong. Check the document manifest for the correct ID.` }],
          isError: true,
        };
      }
    }
  );

  // ── getBookPage ──────────────────────────────────────────
  server.tool(
    "getBookPage",
    "Get the file path and page details for a knowledge book page so you can read it directly. When search results reference a book and page number, use this to get the actual file path, then use the Read tool to view the real PDF page (with vision). This lets you see the original tables, diagrams, and formatting that OCR may have garbled.",
    {
      bookId: z.string().describe("Knowledge book ID (from search results)"),
      pageNumber: z.number().describe("Page number to view"),
    },
    async ({ bookId, pageNumber }) => {
      const data = await apiGet(`/knowledge/books/${bookId}/info`);
      const book = data.book || data;
      if (!book || !book.storagePath) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: "Book not found or no file stored" }) }] };
      }
      // Return the file path relative to the project working directory
      // The CLI agent can use Read tool with pages parameter to view it
      return {
        content: [{ type: "text" as const, text: JSON.stringify({
          bookName: book.name,
          fileName: book.sourceFileName,
          filePath: `../../${book.storagePath}`, // Relative to project workdir
          pageNumber,
          totalPages: book.pageCount,
          hint: `Use the Read tool on the filePath with pages="${pageNumber}" to view this page visually. The PDF page will be rendered as an image so you can read tables and diagrams directly.`,
        }, null, 2) }],
      };
    }
  );

  // ── searchCatalogs ────────────────────────────────────────
  server.tool(
    "searchCatalogs",
    "Search the equipment and material catalogs for items with pricing. Returns catalog items with name, code, unit, unitCost, unitPrice.",
    {
      query: z.string().describe("Search query — e.g. 'fork truck' or 'welder'"),
    },
    async ({ query }) => {
      const params = new URLSearchParams({ q: query });
      const data = await apiGet(`/catalogs/search?${params}`);
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );

  // ── listDocuments ─────────────────────────────────────────
  server.tool(
    "listDocuments",
    "List all project documents with their metadata — fileName, fileType, documentType, pageCount, whether structured data is available. Use this to understand what documents you have before reading them.",
    {},
    async () => {
      const data = await apiGet(`/api/knowledge/documents/${getProjectId()}/enhanced`);
      const docs = (data.documents || data || []).map((d: any) => ({
        id: d.id,
        fileName: d.fileName,
        fileType: d.fileType,
        documentType: d.documentType,
        pageCount: d.pageCount,
        hasStructuredData: !!d.structuredData,
        indexingStatus: d.indexingStatus,
      }));
      return { content: [{ type: "text" as const, text: JSON.stringify(docs, null, 2) }] };
    }
  );
}
