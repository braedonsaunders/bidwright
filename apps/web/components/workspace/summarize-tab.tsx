"use client";

import { useMemo, useState, useTransition } from "react";
import { Plus, Trash2 } from "lucide-react";
import type {
  AdditionalLineItem,
  ProjectModifier,
  ProjectWorkspaceData,
  WorkspaceResponse,
} from "@/lib/api";
import {
  createAdditionalLineItem,
  createModifier,
  deleteAdditionalLineItem,
  deleteModifier,
  updateAdditionalLineItem,
  updateModifier,
  updateRevision,
} from "@/lib/api";
import { formatMoney, formatPercent } from "@/lib/format";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
  Input,
  Select,
  Toggle,
} from "@/components/ui";
import { cn } from "@/lib/utils";

/* ─── Types ─── */

type BreakoutStyle =
  | "LabourMaterialEquipment"
  | "GrandTotal"
  | "Phases"
  | "PhaseDetail"
  | "Category";

type SubTab = "proposal" | "modifiers" | "lineItems" | "hours";

const SUB_TABS: { id: SubTab; label: string }[] = [
  { id: "proposal", label: "Proposal" },
  { id: "modifiers", label: "Modifiers" },
  { id: "lineItems", label: "Additional Line Items" },
  { id: "hours", label: "Hours" },
];

const BREAKOUT_STYLES: { id: BreakoutStyle; label: string }[] = [
  { id: "LabourMaterialEquipment", label: "Labour / Material / Equipment" },
  { id: "GrandTotal", label: "Grand Total" },
  { id: "Phases", label: "Phases" },
  { id: "PhaseDetail", label: "Phase Detail" },
  { id: "Category", label: "Category" },
];

const MODIFIER_TYPES = [
  "Contingency",
  "Surcharge",
  "Discount",
  "Fuel Surcharge",
  "Birla Surcharge",
  "Other",
] as const;

const MODIFIER_APPLIES = [
  "All",
  "Labour Only",
  "Materials Only",
  "Equipment Only",
] as const;

const ALI_TYPES = [
  "OptionStandalone",
  "OptionAdditional",
  "LineItemAdditional",
  "LineItemStandalone",
  "CustomTotal",
] as const;

const ALI_LABELS: Record<string, string> = {
  OptionStandalone: "Option Standalone",
  OptionAdditional: "Option Additional",
  LineItemAdditional: "Line Item Additional",
  LineItemStandalone: "Line Item Standalone",
  CustomTotal: "Custom Total",
};

function parseNum(v: string, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function fmtHours(v: number) {
  return v.toLocaleString("en-US", { maximumFractionDigits: 1 });
}

/* ─── Props ─── */

interface SummarizeTabProps {
  workspace: ProjectWorkspaceData;
  onApply: (next: WorkspaceResponse) => void;
}

/* ─── Component ─── */

export function SummarizeTab({ workspace, onApply }: SummarizeTabProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<SubTab>("proposal");

  const projectId = workspace.project.id;
  const revisionId = workspace.currentRevision.id;
  const breakoutStyle = workspace.currentRevision.breakoutStyle as BreakoutStyle;
  const totals = workspace.estimate?.totals ?? { subtotal: 0, cost: 0, estimatedProfit: 0, estimatedMargin: 0, calculatedTotal: 0, regHours: 0, overHours: 0, doubleHours: 0, totalHours: 0, categoryTotals: [], breakout: [] };

  function handleError(e: unknown) {
    setError(e instanceof Error ? e.message : "Operation failed.");
  }

  function apply(next: WorkspaceResponse) {
    onApply(next);
    setError(null);
  }

  /* ── Breakout style ── */

  function changeBreakoutStyle(style: BreakoutStyle) {
    startTransition(async () => {
      try {
        apply(await updateRevision(projectId, revisionId, { breakoutStyle: style }));
      } catch (e) {
        handleError(e);
      }
    });
  }

  /* ── Modifier CRUD ── */

  function addModifier() {
    startTransition(async () => {
      try {
        apply(await createModifier(projectId, {
          name: "New Modifier",
          type: "Contingency",
          appliesTo: "All",
          percentage: 0,
          amount: 0,
          show: "Yes",
        }));
      } catch (e) {
        handleError(e);
      }
    });
  }

  function patchModifier(id: string, patch: Partial<ProjectModifier>) {
    startTransition(async () => {
      try {
        apply(await updateModifier(projectId, id, patch));
      } catch (e) {
        handleError(e);
      }
    });
  }

  function removeModifier(id: string) {
    startTransition(async () => {
      try {
        apply(await deleteModifier(projectId, id));
      } catch (e) {
        handleError(e);
      }
    });
  }

  /* ── ALI CRUD ── */

  function addAli() {
    startTransition(async () => {
      try {
        apply(await createAdditionalLineItem(projectId, {
          name: "New Line Item",
          description: "",
          type: "LineItemAdditional",
          amount: 0,
        }));
      } catch (e) {
        handleError(e);
      }
    });
  }

  function patchAli(id: string, patch: Partial<AdditionalLineItem>) {
    startTransition(async () => {
      try {
        apply(await updateAdditionalLineItem(projectId, id, patch));
      } catch (e) {
        handleError(e);
      }
    });
  }

  function removeAli(id: string) {
    startTransition(async () => {
      try {
        apply(await deleteAdditionalLineItem(projectId, id));
      } catch (e) {
        handleError(e);
      }
    });
  }

  /* ── Hours computation ── */

  const hoursData = useMemo(() => {
    const labourItems = (workspace.worksheets ?? []).flatMap((w) =>
      (w.items ?? []).filter((i) => i.category === "Labour")
    );

    const phases = workspace.phases ?? [];
    const phaseMap = new Map(phases.map((p) => [p.id, p]));

    // Group by phase, then by entity name
    const grouped = new Map<
      string,
      Map<string, { reg: number; ot: number; dt: number }>
    >();

    for (const item of labourItems) {
      const phaseKey = item.phaseId ?? "__unphased__";
      if (!grouped.has(phaseKey)) grouped.set(phaseKey, new Map());
      const phaseGroup = grouped.get(phaseKey)!;

      const entityKey = item.entityName || "Unnamed";
      const existing = phaseGroup.get(entityKey) ?? { reg: 0, ot: 0, dt: 0 };
      existing.reg += item.laborHourReg;
      existing.ot += item.laborHourOver;
      existing.dt += item.laborHourDouble;
      phaseGroup.set(entityKey, existing);
    }

    const rows: Array<{
      phaseName: string;
      entityName: string;
      reg: number;
      ot: number;
      dt: number;
      total: number;
    }> = [];

    let grandReg = 0;
    let grandOt = 0;
    let grandDt = 0;

    for (const [phaseKey, entityMap] of grouped) {
      const phase = phaseKey === "__unphased__" ? null : phaseMap.get(phaseKey);
      const phaseName = phase ? `${phase.number ? phase.number + " - " : ""}${phase.name}` : "Unphased";

      for (const [entityName, hrs] of entityMap) {
        const total = hrs.reg + hrs.ot + hrs.dt;
        rows.push({ phaseName, entityName, reg: hrs.reg, ot: hrs.ot, dt: hrs.dt, total });
        grandReg += hrs.reg;
        grandOt += hrs.ot;
        grandDt += hrs.dt;
      }
    }

    return {
      rows,
      grandReg,
      grandOt,
      grandDt,
      grandTotal: grandReg + grandOt + grandDt,
    };
  }, [workspace.worksheets, workspace.phases]);

  const defaultTotals = { subtotal: 0, cost: 0, estimatedProfit: 0, estimatedMargin: 0, calculatedTotal: 0, regHours: 0, overHours: 0, doubleHours: 0, totalHours: 0, categoryTotals: [], breakout: [] };

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-lg border border-danger/30 bg-danger/5 px-4 py-2.5 text-sm text-danger">
          {error}
        </div>
      )}

      {/* ─── Sub-tab navigation ─── */}
      <div className="flex gap-1 border-b border-line">
        {SUB_TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "relative px-4 py-2.5 text-sm font-medium transition-colors",
              activeTab === tab.id
                ? "text-accent"
                : "text-fg/50 hover:text-fg/80"
            )}
          >
            {tab.label}
            {activeTab === tab.id && (
              <span className="absolute inset-x-0 bottom-0 h-0.5 bg-accent rounded-full" />
            )}
          </button>
        ))}
      </div>

      {/* ─── Proposal sub-tab ─── */}
      {activeTab === "proposal" && (
        <ProposalSubTab
          breakoutStyle={breakoutStyle}
          totals={totals}
          isPending={isPending}
          onChangeBreakout={changeBreakoutStyle}
        />
      )}

      {/* ─── Modifiers sub-tab ─── */}
      {activeTab === "modifiers" && (
        <ModifiersSubTab
          modifiers={workspace.modifiers}
          isPending={isPending}
          onAdd={addModifier}
          onPatch={patchModifier}
          onDelete={removeModifier}
        />
      )}

      {/* ─── Additional Line Items sub-tab ─── */}
      {activeTab === "lineItems" && (
        <LineItemsSubTab
          items={workspace.additionalLineItems ?? []}
          isPending={isPending}
          onAdd={addAli}
          onPatch={patchAli}
          onDelete={removeAli}
        />
      )}

      {/* ─── Hours sub-tab ─── */}
      {activeTab === "hours" && (
        <HoursSubTab data={hoursData} />
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Proposal Sub-tab
   ═══════════════════════════════════════════════════════════════════════════ */

function ProposalSubTab({
  breakoutStyle,
  totals,
  isPending,
  onChangeBreakout,
}: {
  breakoutStyle: BreakoutStyle;
  totals: ProjectWorkspaceData["estimate"]["totals"];
  isPending: boolean;
  onChangeBreakout: (style: BreakoutStyle) => void;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <CardTitle>Proposal Breakout</CardTitle>
        <div className="flex flex-wrap gap-1">
          {BREAKOUT_STYLES.map((s) => (
            <button
              key={s.id}
              disabled={isPending}
              onClick={() => onChangeBreakout(s.id)}
              className={cn(
                "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                breakoutStyle === s.id
                  ? "bg-accent text-accent-fg"
                  : "bg-panel2 text-fg/60 hover:bg-panel2/80 hover:text-fg"
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
      </CardHeader>
      <CardBody className="p-0">
        {totals.breakout.length === 0 ? (
          <EmptyState className="m-4">No breakout data available.</EmptyState>
        ) : breakoutStyle === "PhaseDetail" ? (
          <PhaseDetailTable breakout={totals.breakout} estimatedMargin={totals.estimatedMargin} />
        ) : (
          <SimpleBreakoutTable breakout={totals.breakout} estimatedMargin={totals.estimatedMargin} />
        )}
      </CardBody>
    </Card>
  );
}

/* ─── Simple breakout table (non-PhaseDetail) ─── */

function SimpleBreakoutTable({
  breakout,
  estimatedMargin,
}: {
  breakout: ProjectWorkspaceData["estimate"]["totals"]["breakout"];
  estimatedMargin: number;
}) {
  let totalValue = 0;
  let totalCost = 0;

  for (const row of breakout) {
    totalValue += row.value;
    totalCost += row.cost;
  }

  const totalMarginDollars = totalValue - totalCost;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line text-left text-xs text-fg/40">
            <th className="px-5 py-2.5 font-medium">Name</th>
            <th className="px-5 py-2.5 font-medium text-right">Value</th>
            <th className="px-5 py-2.5 font-medium text-right">Cost</th>
            <th className="px-5 py-2.5 font-medium text-right">Margin $</th>
            <th className="px-5 py-2.5 font-medium text-right">Margin %</th>
          </tr>
        </thead>
        <tbody>
          {breakout.map((row, idx) => {
            const marginDollars = row.value - row.cost;
            const isModifier = row.type === "modifier";
            const isOption = row.type === "option";

            return (
              <tr
                key={`${row.name}-${idx}`}
                className="border-b border-line/50 hover:bg-panel2/30"
              >
                <td className="px-5 py-2.5">
                  <span className="flex items-center gap-2">
                    {row.name}
                    {isModifier && <Badge tone="warning">Modifier</Badge>}
                    {isOption && <Badge tone="info">Option</Badge>}
                  </span>
                </td>
                <td className="px-5 py-2.5 text-right">{formatMoney(row.value)}</td>
                <td className="px-5 py-2.5 text-right">{formatMoney(row.cost)}</td>
                <td className="px-5 py-2.5 text-right">{formatMoney(marginDollars)}</td>
                <td className="px-5 py-2.5 text-right">{formatPercent(row.margin, 1)}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t border-line bg-panel2/40 font-medium">
            <td className="px-5 py-2.5">Total</td>
            <td className="px-5 py-2.5 text-right">{formatMoney(totalValue)}</td>
            <td className="px-5 py-2.5 text-right">{formatMoney(totalCost)}</td>
            <td className="px-5 py-2.5 text-right">{formatMoney(totalMarginDollars)}</td>
            <td className="px-5 py-2.5 text-right">{formatPercent(estimatedMargin, 1)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

/* ─── Phase detail nested table ─── */

function PhaseDetailTable({
  breakout,
  estimatedMargin,
}: {
  breakout: ProjectWorkspaceData["estimate"]["totals"]["breakout"];
  estimatedMargin: number;
}) {
  let totalValue = 0;
  let totalCost = 0;

  for (const row of breakout) {
    totalValue += row.value;
    totalCost += row.cost;
  }

  const totalMarginDollars = totalValue - totalCost;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line text-left text-xs text-fg/40">
            <th className="px-5 py-2.5 font-medium">Name</th>
            <th className="px-5 py-2.5 font-medium text-right">Value</th>
            <th className="px-5 py-2.5 font-medium text-right">Cost</th>
            <th className="px-5 py-2.5 font-medium text-right">Margin $</th>
            <th className="px-5 py-2.5 font-medium text-right">Margin %</th>
          </tr>
        </thead>
        <tbody>
          {breakout.map((row, idx) => {
            const phaseMarginDollars = row.value - row.cost;
            const isModifier = row.type === "modifier";
            const isOption = row.type === "option";

            return (
              <PhaseDetailGroup
                key={`${row.name}-${idx}`}
                name={row.name}
                value={row.value}
                cost={row.cost}
                marginDollars={phaseMarginDollars}
                marginPercent={row.margin}
                isModifier={isModifier}
                isOption={isOption}
                categories={row.category}
              />
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t border-line bg-panel2/40 font-medium">
            <td className="px-5 py-2.5">Total</td>
            <td className="px-5 py-2.5 text-right">{formatMoney(totalValue)}</td>
            <td className="px-5 py-2.5 text-right">{formatMoney(totalCost)}</td>
            <td className="px-5 py-2.5 text-right">{formatMoney(totalMarginDollars)}</td>
            <td className="px-5 py-2.5 text-right">{formatPercent(estimatedMargin, 1)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function PhaseDetailGroup({
  name,
  value,
  cost,
  marginDollars,
  marginPercent,
  isModifier,
  isOption,
  categories,
}: {
  name: string;
  value: number;
  cost: number;
  marginDollars: number;
  marginPercent: number;
  isModifier: boolean;
  isOption: boolean;
  categories?: Array<{ name: string; value: number; cost: number; margin: number }>;
}) {
  return (
    <>
      <tr className="border-b border-line/50 bg-panel2/20 font-medium hover:bg-panel2/40">
        <td className="px-5 py-2.5">
          <span className="flex items-center gap-2">
            {name}
            {isModifier && <Badge tone="warning">Modifier</Badge>}
            {isOption && <Badge tone="info">Option</Badge>}
          </span>
        </td>
        <td className="px-5 py-2.5 text-right">{formatMoney(value)}</td>
        <td className="px-5 py-2.5 text-right">{formatMoney(cost)}</td>
        <td className="px-5 py-2.5 text-right">{formatMoney(marginDollars)}</td>
        <td className="px-5 py-2.5 text-right">{formatPercent(marginPercent, 1)}</td>
      </tr>
      {categories?.map((cat, i) => {
        const catMarginDollars = cat.value - cat.cost;
        return (
          <tr
            key={`${name}-cat-${i}`}
            className="border-b border-line/30 bg-panel2/10 text-fg/70"
          >
            <td className="py-2 pl-10 pr-5 text-xs">{cat.name}</td>
            <td className="px-5 py-2 text-right text-xs">{formatMoney(cat.value)}</td>
            <td className="px-5 py-2 text-right text-xs">{formatMoney(cat.cost)}</td>
            <td className="px-5 py-2 text-right text-xs">{formatMoney(catMarginDollars)}</td>
            <td className="px-5 py-2 text-right text-xs">{formatPercent(cat.margin, 1)}</td>
          </tr>
        );
      })}
    </>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Modifiers Sub-tab
   ═══════════════════════════════════════════════════════════════════════════ */

function ModifiersSubTab({
  modifiers,
  isPending,
  onAdd,
  onPatch,
  onDelete,
}: {
  modifiers: ProjectModifier[];
  isPending: boolean;
  onAdd: () => void;
  onPatch: (id: string, patch: Partial<ProjectModifier>) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <Card>
      <CardHeader className="flex items-center justify-between">
        <CardTitle>Modifiers</CardTitle>
        <Button size="xs" variant="secondary" onClick={onAdd} disabled={isPending}>
          <Plus className="h-3.5 w-3.5" /> Add Modifier
        </Button>
      </CardHeader>
      <CardBody className="p-0">
        {modifiers.length === 0 ? (
          <EmptyState className="m-4">No modifiers added.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-fg/40">
                  <th className="px-5 py-2.5 font-medium">Name</th>
                  <th className="px-5 py-2.5 font-medium">Type</th>
                  <th className="px-5 py-2.5 font-medium">Applies To</th>
                  <th className="px-5 py-2.5 font-medium text-right">Percentage</th>
                  <th className="px-5 py-2.5 font-medium text-right">Amount</th>
                  <th className="px-5 py-2.5 font-medium text-center">Show on Quote</th>
                  <th className="px-5 py-2.5 font-medium w-10" />
                </tr>
              </thead>
              <tbody>
                {modifiers.map((mod) => (
                  <ModifierRow
                    key={mod.id}
                    mod={mod}
                    disabled={isPending}
                    onPatch={(patch) => onPatch(mod.id, patch)}
                    onDelete={() => onDelete(mod.id)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function ModifierRow({
  mod,
  disabled,
  onPatch,
  onDelete,
}: {
  mod: ProjectModifier;
  disabled: boolean;
  onPatch: (patch: Partial<ProjectModifier>) => void;
  onDelete: () => void;
}) {
  return (
    <tr className="border-b border-line/50 hover:bg-panel2/30">
      <td className="px-5 py-1.5">
        <Input
          className="h-8 text-xs"
          value={mod.name}
          disabled={disabled}
          onChange={(e) => onPatch({ name: e.target.value })}
          onBlur={(e) => onPatch({ name: e.target.value })}
        />
      </td>
      <td className="px-5 py-1.5">
        <Select
          className="h-8 text-xs"
          value={mod.type}
          disabled={disabled}
          onChange={(e) => onPatch({ type: e.target.value })}
        >
          {MODIFIER_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </Select>
      </td>
      <td className="px-5 py-1.5">
        <Select
          className="h-8 text-xs"
          value={mod.appliesTo}
          disabled={disabled}
          onChange={(e) => onPatch({ appliesTo: e.target.value })}
        >
          {MODIFIER_APPLIES.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </Select>
      </td>
      <td className="px-5 py-1.5">
        <div className="flex items-center justify-end gap-1">
          <Input
            className="h-8 text-right text-xs w-24"
            type="number"
            step="0.1"
            value={mod.percentage ?? ""}
            disabled={disabled}
            onChange={(e) => onPatch({ percentage: e.target.value === "" ? null : parseNum(e.target.value) })}
          />
          <span className="text-xs text-fg/40">%</span>
        </div>
      </td>
      <td className="px-5 py-1.5">
        <div className="flex items-center justify-end gap-1">
          <span className="text-xs text-fg/40">$</span>
          <Input
            className="h-8 text-right text-xs w-28"
            type="number"
            step="0.01"
            value={mod.amount ?? ""}
            disabled={disabled}
            onChange={(e) => onPatch({ amount: e.target.value === "" ? null : parseNum(e.target.value) })}
          />
        </div>
      </td>
      <td className="px-5 py-1.5 text-center">
        <Toggle
          checked={mod.show === "Yes"}
          onChange={(checked) => onPatch({ show: checked ? "Yes" : "No" })}
        />
      </td>
      <td className="px-5 py-1.5">
        <Button size="xs" variant="ghost" onClick={onDelete} disabled={disabled}>
          <Trash2 className="h-3.5 w-3.5 text-danger" />
        </Button>
      </td>
    </tr>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Additional Line Items Sub-tab
   ═══════════════════════════════════════════════════════════════════════════ */

function LineItemsSubTab({
  items,
  isPending,
  onAdd,
  onPatch,
  onDelete,
}: {
  items: AdditionalLineItem[];
  isPending: boolean;
  onAdd: () => void;
  onPatch: (id: string, patch: Partial<AdditionalLineItem>) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <Card>
      <CardHeader className="flex items-center justify-between">
        <CardTitle>Additional Line Items</CardTitle>
        <Button size="xs" variant="secondary" onClick={onAdd} disabled={isPending}>
          <Plus className="h-3.5 w-3.5" /> Add Line Item
        </Button>
      </CardHeader>
      <CardBody className="p-0">
        {items.length === 0 ? (
          <EmptyState className="m-4">No additional line items.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-fg/40">
                  <th className="px-5 py-2.5 font-medium">Type</th>
                  <th className="px-5 py-2.5 font-medium">Name</th>
                  <th className="px-5 py-2.5 font-medium">Description</th>
                  <th className="px-5 py-2.5 font-medium text-right">Amount</th>
                  <th className="px-5 py-2.5 font-medium w-10" />
                </tr>
              </thead>
              <tbody>
                {items.map((ali) => (
                  <AliRow
                    key={ali.id}
                    ali={ali}
                    disabled={isPending}
                    onPatch={(patch) => onPatch(ali.id, patch)}
                    onDelete={() => onDelete(ali.id)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function AliRow({
  ali,
  disabled,
  onPatch,
  onDelete,
}: {
  ali: AdditionalLineItem;
  disabled: boolean;
  onPatch: (patch: Partial<AdditionalLineItem>) => void;
  onDelete: () => void;
}) {
  return (
    <tr className="border-b border-line/50 hover:bg-panel2/30">
      <td className="px-5 py-1.5">
        <Select
          className="h-8 text-xs"
          value={ali.type}
          disabled={disabled}
          onChange={(e) => onPatch({ type: e.target.value as AdditionalLineItem["type"] })}
        >
          {ALI_TYPES.map((t) => (
            <option key={t} value={t}>
              {ALI_LABELS[t]}
            </option>
          ))}
        </Select>
      </td>
      <td className="px-5 py-1.5">
        <Input
          className="h-8 text-xs"
          value={ali.name}
          disabled={disabled}
          onChange={(e) => onPatch({ name: e.target.value })}
          onBlur={(e) => onPatch({ name: e.target.value })}
        />
      </td>
      <td className="px-5 py-1.5">
        <Input
          className="h-8 text-xs"
          value={ali.description}
          disabled={disabled}
          onChange={(e) => onPatch({ description: e.target.value })}
          onBlur={(e) => onPatch({ description: e.target.value })}
        />
      </td>
      <td className="px-5 py-1.5">
        <div className="flex items-center justify-end gap-1">
          <span className="text-xs text-fg/40">$</span>
          <Input
            className="h-8 text-right text-xs w-28"
            type="number"
            step="0.01"
            value={ali.amount}
            disabled={disabled}
            onChange={(e) => onPatch({ amount: parseNum(e.target.value) })}
          />
        </div>
      </td>
      <td className="px-5 py-1.5">
        <Button size="xs" variant="ghost" onClick={onDelete} disabled={disabled}>
          <Trash2 className="h-3.5 w-3.5 text-danger" />
        </Button>
      </td>
    </tr>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Hours Sub-tab
   ═══════════════════════════════════════════════════════════════════════════ */

function HoursSubTab({
  data,
}: {
  data: {
    rows: Array<{
      phaseName: string;
      entityName: string;
      reg: number;
      ot: number;
      dt: number;
      total: number;
    }>;
    grandReg: number;
    grandOt: number;
    grandDt: number;
    grandTotal: number;
  };
}) {
  // Group rows by phase for visual grouping
  const phaseGroups = useMemo(() => {
    const groups: Array<{ phaseName: string; rows: typeof data.rows }> = [];
    let currentPhase = "";

    for (const row of data.rows) {
      if (row.phaseName !== currentPhase) {
        currentPhase = row.phaseName;
        groups.push({ phaseName: currentPhase, rows: [] });
      }
      groups[groups.length - 1].rows.push(row);
    }

    return groups;
  }, [data.rows]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Labour Hours Summary</CardTitle>
      </CardHeader>
      <CardBody className="p-0">
        {data.rows.length === 0 ? (
          <EmptyState className="m-4">No labour hours data available.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-fg/40">
                  <th className="px-5 py-2.5 font-medium">Phase</th>
                  <th className="px-5 py-2.5 font-medium">Labour Type</th>
                  <th className="px-5 py-2.5 font-medium text-right">Regular Hours</th>
                  <th className="px-5 py-2.5 font-medium text-right">OT Hours</th>
                  <th className="px-5 py-2.5 font-medium text-right">DT Hours</th>
                  <th className="px-5 py-2.5 font-medium text-right">Total Hours</th>
                </tr>
              </thead>
              <tbody>
                {phaseGroups.map((group) =>
                  group.rows.map((row, rowIdx) => (
                    <tr
                      key={`${group.phaseName}-${row.entityName}-${rowIdx}`}
                      className="border-b border-line/50 hover:bg-panel2/30"
                    >
                      <td className="px-5 py-2.5">
                        {rowIdx === 0 ? (
                          <span className="font-medium">{row.phaseName}</span>
                        ) : null}
                      </td>
                      <td className="px-5 py-2.5">{row.entityName}</td>
                      <td className="px-5 py-2.5 text-right">{fmtHours(row.reg)}</td>
                      <td className="px-5 py-2.5 text-right">{fmtHours(row.ot)}</td>
                      <td className="px-5 py-2.5 text-right">{fmtHours(row.dt)}</td>
                      <td className="px-5 py-2.5 text-right font-medium">{fmtHours(row.total)}</td>
                    </tr>
                  ))
                )}
              </tbody>
              <tfoot>
                <tr className="border-t border-line bg-panel2/40 font-medium">
                  <td className="px-5 py-2.5" colSpan={2}>
                    Grand Total
                  </td>
                  <td className="px-5 py-2.5 text-right">{fmtHours(data.grandReg)}</td>
                  <td className="px-5 py-2.5 text-right">{fmtHours(data.grandOt)}</td>
                  <td className="px-5 py-2.5 text-right">{fmtHours(data.grandDt)}</td>
                  <td className="px-5 py-2.5 text-right">{fmtHours(data.grandTotal)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
