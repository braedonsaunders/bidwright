import { readFile } from "node:fs/promises";

export interface NativePdfPageCountResult {
  pageCount: number | null;
  source: "pdf-native";
  error?: string;
}

function normalized(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

export function isPdfFileNameOrType(fileNameOrType: unknown, fileType?: unknown) {
  const name = normalized(fileNameOrType);
  const type = normalized(fileType);
  return type === "pdf" || type === "application/pdf" || name.endsWith(".pdf");
}

export async function getNativePdfPageCountFromBuffer(
  input: Buffer | Uint8Array | ArrayBuffer,
): Promise<NativePdfPageCountResult> {
  try {
    const pdfjs: any = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const bytes = input instanceof ArrayBuffer
      ? new Uint8Array(input)
      : new Uint8Array(input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength));
    const loadingTask = pdfjs.getDocument({
      data: bytes,
      disableWorker: true,
      useSystemFonts: true,
    });
    const pdf = await loadingTask.promise;
    const pageCount = Number(pdf.numPages);
    await pdf.destroy?.();
    return {
      pageCount: Number.isFinite(pageCount) && pageCount > 0 ? Math.floor(pageCount) : null,
      source: "pdf-native",
    };
  } catch (error) {
    return {
      pageCount: null,
      source: "pdf-native",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function getNativePdfPageCountFromFile(absPath: string): Promise<NativePdfPageCountResult> {
  try {
    return await getNativePdfPageCountFromBuffer(await readFile(absPath));
  } catch (error) {
    return {
      pageCount: null,
      source: "pdf-native",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function choosePdfPageCount(args: {
  fileName?: unknown;
  fileType?: unknown;
  extractionPageCount: number;
  nativePageCount?: number | null;
}) {
  const extractionPageCount = Math.max(1, Math.floor(Number(args.extractionPageCount) || 1));
  if (!isPdfFileNameOrType(args.fileName, args.fileType)) return extractionPageCount;
  const nativePageCount = Number(args.nativePageCount);
  return Number.isFinite(nativePageCount) && nativePageCount > 0
    ? Math.floor(nativePageCount)
    : extractionPageCount;
}

export function attachNativePdfMetadata(
  structuredData: unknown,
  nativeResult: NativePdfPageCountResult | null | undefined,
  extractionPageCount: number,
): Record<string, unknown> | null {
  if (!nativeResult) return structuredData && typeof structuredData === "object" ? structuredData as Record<string, unknown> : null;
  return {
    ...((structuredData && typeof structuredData === "object") ? structuredData : {}),
    nativePdf: {
      pageCount: nativeResult.pageCount,
      pageCountSource: nativeResult.pageCount ? "pdf-native" as const : "extraction-fallback" as const,
      extractionPageCount,
      error: nativeResult.error,
    },
  };
}
