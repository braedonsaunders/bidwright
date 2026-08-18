"use client";

import type { ProjectWorkspaceData } from "@/lib/api";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@braedonsaunders/appkit-ui";
import {
  getExtendedWorksheetUnitBreakdown,
  getWorksheetUnitKind,
} from "@/lib/worksheet-hours";

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
  tierTotals: Record<string, number>;
  totalHours: number;
}

export interface HoursTabProps {
  workspace: ProjectWorkspaceData;
}

export function HoursTab({ workspace }: HoursTabProps) {
  const phases = workspace.phases ?? [];
  const phaseMap = new Map(phases.map((phase) => [phase.id, phase]));
  const rateSchedules = workspace.rateSchedules ?? [];
  const categories = workspace.entityCategories ?? [];
  const keyedRows = new Map<string, HoursRow>();
  const tierDefinitions = new Map<string, { name: string; multiplier: number; sortOrder: number }>();

  for (const item of (workspace.worksheets ?? []).flatMap((worksheet) => worksheet.items ?? [])) {
    if (getWorksheetUnitKind(item, categories) !== "labour_hours") continue;
    const breakdown = getExtendedWorksheetUnitBreakdown(
      item,
      rateSchedules,
      categories,
      item.quantity,
    );
    if (breakdown.total <= 0) continue;

    const phaseId = item.phaseId ?? null;
    const phase = phaseId ? phaseMap.get(phaseId) : null;
    const key = `${phaseId ?? "__none__"}::${item.entityName}`;
    const row = keyedRows.get(key) ?? {
      phaseId,
      phaseName: phase ? `${phase.number} - ${phase.name}` : "",
      entityName: item.entityName,
      tierTotals: {},
      totalHours: 0,
    };

    for (const tier of breakdown.tiers) {
      tierDefinitions.set(tier.tierId, {
        name: tier.name,
        multiplier: tier.multiplier,
        sortOrder: tier.sortOrder,
      });
      row.tierTotals[tier.tierId] = (row.tierTotals[tier.tierId] ?? 0) + tier.hours;
    }
    row.totalHours += breakdown.total;
    keyedRows.set(key, row);
  }

  const tiers = [...tierDefinitions.entries()].sort(([, left], [, right]) => {
    if (left.sortOrder !== right.sortOrder) return left.sortOrder - right.sortOrder;
    return left.multiplier - right.multiplier;
  });
  const rows = [...keyedRows.values()];
  const groups = new Map<string, HoursRow[]>();
  for (const row of rows) {
    const key = row.phaseId ?? "__none__";
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const hasPhases = phases.length > 0;
  const grandTierTotals = Object.fromEntries(
    tiers.map(([tierId]) => [
      tierId,
      rows.reduce((sum, row) => sum + (row.tierTotals[tierId] ?? 0), 0),
    ]),
  );
  const grandTotal = rows.reduce((sum, row) => sum + row.totalHours, 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Labour Hours Summary</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {rows.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-fg/40">
            No labour hours recorded.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-[11px] font-medium uppercase tracking-wider text-fg/40">
                  {hasPhases && <th className="px-5 py-2.5">Phase</th>}
                  <th className="px-5 py-2.5">Entity</th>
                  {tiers.map(([tierId, tier]) => (
                    <th key={tierId} className="px-5 py-2.5 text-right">
                      {tier.name}{tier.multiplier !== 1 ? ` (${tier.multiplier}x)` : ""}
                    </th>
                  ))}
                  <th className="px-5 py-2.5 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {[...groups.entries()].flatMap(([groupKey, groupRows]) =>
                  groupRows.map((row, rowIndex) => (
                    <tr
                      key={`${groupKey}-${row.entityName}`}
                      className="border-b border-line/50 hover:bg-panel2/40"
                    >
                      {hasPhases && rowIndex === 0 && (
                        <td rowSpan={groupRows.length} className="px-5 py-2 align-top font-medium text-fg/70">
                          {row.phaseName || "—"}
                        </td>
                      )}
                      <td className="px-5 py-2 text-fg/80">{row.entityName}</td>
                      {tiers.map(([tierId]) => (
                        <td key={tierId} className="px-5 py-2 text-right font-mono text-fg/60">
                          {fmtHours(row.tierTotals[tierId] ?? 0)}
                        </td>
                      ))}
                      <td className="px-5 py-2 text-right font-mono font-medium text-fg/80">
                        {fmtHours(row.totalHours)}
                      </td>
                    </tr>
                  )),
                )}
              </tbody>
              <tfoot>
                <tr className="border-t border-line bg-panel2/30 font-medium">
                  {hasPhases && <td className="px-5 py-2.5" />}
                  <td className="px-5 py-2.5 text-[11px] uppercase tracking-wider text-fg/50">
                    Grand Total
                  </td>
                  {tiers.map(([tierId]) => (
                    <td key={tierId} className="px-5 py-2.5 text-right font-mono text-fg">
                      {fmtHours(Number(grandTierTotals[tierId]) || 0)}
                    </td>
                  ))}
                  <td className="px-5 py-2.5 text-right font-mono text-lg text-fg">
                    {fmtHours(grandTotal)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
