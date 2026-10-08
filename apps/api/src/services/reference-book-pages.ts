import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import { promisify } from "node:util";
import { buildEstimatorSearchProfile, rankEstimatorSearchItems } from "./estimator-search.js";
import { searchExcerpt } from "./indexed-search.js";

const run = promisify(execFile);
const pagesByFile = new Map<string, { version: string; size: number; pages: Promise<string[]> }>();

/** Local extraction only; never sends a reference book to an external model. */
export async function referenceBookPages(pdfPath: string) {
  const info = await stat(pdfPath);
  const version = `${info.ino}:${info.size}:${info.mtimeMs}`;
  const cached = pagesByFile.get(pdfPath);
  if (cached?.version === version) return cached.pages;
  const entry = { version, size: 0, pages: Promise.resolve([] as string[]) };
  entry.pages = run("pdftotext", ["-layout", pdfPath, "-"], { timeout: 60000, maxBuffer: 64 * 1024 * 1024 })
    .then(({ stdout }) => {
      entry.size = Buffer.byteLength(stdout);
      while (pagesByFile.size > 8 || [...pagesByFile.values()].reduce((sum, item) => sum + item.size, 0) > 32 * 1024 * 1024) {
        const oldest = pagesByFile.keys().next().value;
        if (!oldest) break;
        pagesByFile.delete(oldest);
      }
      const pages = stdout.split("\f");
      if (!pages.at(-1)?.trim()) pages.pop();
      return pages;
    }).catch((error) => { if (pagesByFile.get(pdfPath) === entry) pagesByFile.delete(pdfPath); throw error; });
  pagesByFile.set(pdfPath, entry);
  return entry.pages;
}

export function searchReferenceBookPages(pages: string[], query: string, limit = 8) {
  return rankEstimatorSearchItems(pages.map((text, index) => ({ text, pageNumber: index + 1 })),
    buildEstimatorSearchProfile(query), (page) => page.text)
    .slice(0, limit).map(({ item, score, matchedTerms }) => ({ pageNumber: item.pageNumber,
      score, matchedTerms, text: searchExcerpt(item.text, query, 1200) }));
}
