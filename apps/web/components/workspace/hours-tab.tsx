"use client";

import type { ProjectWorkspaceData, WorkspaceWorksheetItem } from "@/lib/api";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui";
import { cn } from "@/lib/utils";
import { bucketHoursByMultiplier, getWorksheetHourBreakdown } from "@/lib/worksheet-hours";

/* ─── Helpers ─── */

function fmtHours(value: number): string {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}

interface HoursRow {
  phaseId: string | null;
  phaseName: string;
  entityName: string;
  regHours: number;
  overHours: number;
  doubleHours: number;
  totalHours: number;
}

interface PhaseGroup {
  phaseId: string | null;
  phaseName: string;
  rows: HoursRow[];
}

/* ─── Component ─── */

export interface HoursTabProps {
  workspace: ProjectWorkspaceData;
}

export function HoursTab({ workspace }: HoursTabProps) {
  const phases = workspace.phases ?? [];
  const phaseMap = new Map(phases.map((p) => [p.id, p]));
  const hasPhases = phases.length > 0;

  // Collect all labour items across worksheets
  const labourItems: WorkspaceWorksheetItem[] = (workspace.worksheets ?? []).flatMap(
    (ws) => (ws.items ?? []).filter((item) => item.category === "Labour")
  );

  // Group by phase then by entityName, summing hours
  const keyedRows = new Map<string, HoursRow>();

  const rateSchedules = workspace.rateSchedules ?? [];
  for (const item of labourItems) {
    const phaseId = item.phaseId ?? null;
    const key = `${phaseId ?? "__none__"}::${item.entityName}`;
    const buckets = bucketHoursByMultiplier(getWorksheetHourBreakdown(item, rateSchedules));

    const existing = keyedRows.get(key);
    if (existing) {
      existing.regHours += buckets.reg;
      existing.overHours += buckets.ot;
      existing.doubleHours += buckets.dt;
      existing.totalHours += buckets.reg + buckets.ot + buckets.dt;
    } else {
      const phase = phaseId ? phaseMap.get(phaseId) : null;
      keyedRows.set(key, {
        phaseId,
        phaseName: phase ? `${phase.number} - ${phase.name}` : "",
        entityName: item.entityName,
        regHours: buckets.reg,
        overHours: buckets.ot,
        doubleHours: buckets.dt,
        totalHours: buckets.reg + buckets.ot + buckets.dt,
      });
    }
  }

  const allRows = Array.from(keyedRows.values());

  // Group rows by phase for rowspan rendering
  const phaseGroups: PhaseGroup[] = [];
  const groupMap = new Map<string, PhaseGroup>();

  for (const row of allRows) {
    const gKey = row.phaseId ?? "__none__";
    let group = groupMap.get(gKey);
    if (!group) {
      group = { phaseId: row.phaseId, phaseName: row.phaseName, rows: [] };
      groupMap.set(gKey, group);
      phaseGroups.push(group);
    }
    group.rows.push(row);
  }

  // Grand totals
  const grandReg = allRows.reduce((s, r) => s + r.regHours, 0);
  const grandOver = allRows.reduce((s, r) => s + r.overHours, 0);
  const grandDouble = allRows.reduce((s, r) => s + r.doubleHours, 0);
  const grandTotal = grandReg + grandOver + grandDouble;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Hours Summary</CardTitle>
      </CardHeader>
      <CardBody className="p-0">
        {allRows.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-fg/40">
            No unit quantities recorded.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-[11px] font-medium uppercase tracking-wider text-fg/40">
                  {hasPhases && <th className="px-5 py-2.5">Phase</th>}
                  <th className="px-5 py-2.5">Entity</th>
                  <th className="px-5 py-2.5 text-right">Unit 1</th>
                  <th className="px-5 py-2.5 text-right">Unit 2</th>
                  <th className="px-5 py-2.5 text-right">Unit 3</th>
                  <th className="px-5 py-2.5 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {phaseGroups.map((group) =>
                  group.rows.map((row, rowIdx) => (
                    <tr
                      key={`${row.phaseId ?? "none"}-${row.entityName}`}
                      className="border-b border-line/50 hover:bg-panel2/40"
                    >
                      {hasPhases && rowIdx === 0 && (
                        <td
                          rowSpan={group.rows.length}
                          className="px-5 py-2 align-top font-medium text-fg/70"
                        >
                          {group.phaseName || "\u2014"}
                        </td>
                      )}
                      <td className="px-5 py-2 text-fg/80">{row.entityName}</td>
                      <td className="px-5 py-2 text-right font-mono text-fg/60">
                        {fmtHours(row.regHours)}
                      </td>
                      <td className="px-5 py-2 text-right font-mono text-fg/60">
                        {fmtHours(row.overHours)}
                      </td>
                      <td className="px-5 py-2 text-right font-mono text-fg/60">
                        {fmtHours(row.doubleHours)}
                      </td>
                      <td className="px-5 py-2 text-right font-mono font-medium text-fg/80">
                        {fmtHours(row.totalHours)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
              <tfoot>
                <tr className="border-t border-line bg-panel2/30 font-medium">
                  {hasPhases && <td className="px-5 py-2.5" />}
                  <td className="px-5 py-2.5 text-[11px] uppercase tracking-wider text-fg/50">
                    Grand Total
                  </td>
                  <td className="px-5 py-2.5 text-right font-mono text-fg">
                    {fmtHours(grandReg)}
                  </td>
                  <td className="px-5 py-2.5 text-right font-mono text-fg">
                    {fmtHours(grandOver)}
                  </td>
                  <td className="px-5 py-2.5 text-right font-mono text-fg">
                    {fmtHours(grandDouble)}
                  </td>
                  <td className="px-5 py-2.5 text-right font-mono text-lg text-fg">
                    {fmtHours(grandTotal)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
