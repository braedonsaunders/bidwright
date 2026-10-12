import { existsSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_PROCESS_PATH } from "@braedonsaunders/appkit-process-sandbox";

export const VISION_VENV = "/opt/vision-venv";
export const CAD_PYTHON = "/opt/cad-venv/bin/python";

/** Explicit environment shared by the production sandbox and direct evals. */
export function agentPythonEnvironment(
  environment: Record<string, string>,
  options: { visionVenv?: string; cadPython?: string } = {},
): Record<string, string> {
  const venv = options.visionVenv ?? VISION_VENV;
  const paths = [join(venv, "bin"), ...(environment.PATH || DEFAULT_PROCESS_PATH).split(":")];
  return {
    ...environment,
    PATH: [...new Set(paths.filter(Boolean))].join(":"),
    VIRTUAL_ENV: venv,
    PYTHON_PATH: join(venv, "bin/python"),
    BIDWRIGHT_CAD_PYTHON: options.cadPython ?? CAD_PYTHON,
    // Noninteractive Bash also reads this after login profiles. Reactivating
    // prevents a CLI's login shell from replacing the venv PATH with /usr/bin.
    ...(existsSync(join(venv, "bin/activate")) ? { BASH_ENV: join(venv, "bin/activate") } : {}),
  };
}

export function agentPythonFacts(environment?: Record<string, string>): string {
  const python = environment?.PYTHON_PATH ?? `${VISION_VENV}/bin/python`;
  const cad = environment?.BIDWRIGHT_CAD_PYTHON ?? CAD_PYTHON;
  return `Server/eval agent shells resolve python and python3 through the vision venv (${python}), with PyMuPDF (fitz), numpy, scipy, OpenCV (cv2), Pillow (PIL), scikit-learn, openpyxl and pytesseract. BIDWRIGHT_CAD_PYTHON points to ${cad}, the separate build123d environment. The workspace API client is .bidwright/bin/bw (also node .bidwright/bin/bw.mjs). Network package installs may be blocked; code-aggregation contains usage examples. Local desktop installations can differ.`;
}
