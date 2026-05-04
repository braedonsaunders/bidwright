"use client";

import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from "pdfjs-dist/types/src/display/api";
import type * as PdfJsRuntime from "pdfjs-dist/types/src/pdf";

export type PdfJsModule = typeof PdfJsRuntime;
export type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask };

let pdfjsPromise: Promise<PdfJsModule> | null = null;

export function loadPdfJs(): Promise<PdfJsModule> {
  if (!pdfjsPromise) {
    pdfjsPromise = import("pdfjs-dist/legacy/build/pdf.mjs").then((module) => {
      const pdfjs = module as unknown as PdfJsModule;
      if (typeof window !== "undefined" && !pdfjs.GlobalWorkerOptions.workerSrc) {
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          "pdfjs-dist/legacy/build/pdf.worker.min.mjs",
          import.meta.url,
        ).toString();
      }
      return pdfjs;
    });
  }

  return pdfjsPromise;
}
