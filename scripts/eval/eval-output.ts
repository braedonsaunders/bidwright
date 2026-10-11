import { homedir } from "node:os";
import { join } from "node:path";

/** Persistent reference-derived reports default outside the checkout. */
export function referenceEvalOutputDir(runName: string) {
  return join(homedir(), ".bidwright", "evals", runName);
}
