import { isDeepStrictEqual } from "node:util";
import type { Calibration, CalibrationCache } from "./pdf-takeoff-geometry.js";
import { replaceCalibration } from "./pdf-takeoff-geometry.js";

export interface CalibrationChange {
  key: string;
  calibration: Calibration | null;
  expected?: Calibration | null;
}

// Invoked inside the workspace transaction, after taking the project row lock.
export function patchTakeoffCalibrations(
  state: Record<string, unknown>,
  documentId: string,
  changes: CalibrationChange[],
  options: { agent?: boolean; replaceHuman?: boolean } = {},
) {
  const all = (state.takeoffCalibrations ?? {}) as Record<
    string,
    CalibrationCache
  >;
  let cache = { ...(all[documentId] ?? {}) };
  for (const change of changes) {
    if (
      change.expected !== undefined &&
      !isDeepStrictEqual(cache[change.key] ?? null, change.expected)
    ) {
      throw new Error(
        "Calibration changed since it was loaded; refresh before applying this edit",
      );
    }
    if (change.calibration === null) delete cache[change.key];
    else
      cache = options.agent
        ? replaceCalibration(
            cache,
            change.key,
            change.calibration,
            options.replaceHuman,
          )
        : { ...cache, [change.key]: change.calibration };
  }
  return { ...state, takeoffCalibrations: { ...all, [documentId]: cache } };
}

export async function mutateWorkspaceStateLocked(
  db: import("@bidwright/db").PrismaClient,
  projectId: string,
  change: (state: Record<string, unknown>) => Record<string, unknown>,
  initialState: () => Promise<Record<string, unknown>>,
) {
  return db.$transaction(async (tx) => {
    // The parent exists before WorkspaceState, so first writes serialize too.
    await tx.$queryRaw`SELECT id FROM "Project" WHERE id = ${projectId} FOR UPDATE`;
    const existing = await tx.workspaceState.findUnique({
      where: { projectId },
    });
    const state = existing
      ? (existing.state as Record<string, unknown>)
      : await initialState();
    const data = { state: change(state) as any, updatedAt: new Date() };
    return existing
      ? tx.workspaceState.update({ where: { id: existing.id }, data })
      : tx.workspaceState.create({ data: { projectId, ...data } });
  });
}
