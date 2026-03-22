"use client";

import { useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Maximize2,
  Minus,
  MousePointer2,
  Plus,
  Ruler,
  Square,
  Target,
  Trash2,
} from "lucide-react";
import type { ProjectWorkspaceData } from "@/lib/api";
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
  Separator,
} from "@/components/ui";
import { cn } from "@/lib/utils";

/* ─── Types ─── */

type MeasurementTool = "select" | "line" | "area" | "count" | "calibrate";

interface TakeoffItem {
  id: string;
  label: string;
  tool: MeasurementTool;
  quantity: number;
  unit: string;
  color: string;
}

const TOOL_COLORS = [
  "#3b82f6",
  "#ef4444",
  "#22c55e",
  "#f59e0b",
  "#8b5cf6",
  "#ec4899",
  "#06b6d4",
  "#f97316",
];

const MEASUREMENT_TOOLS: { tool: MeasurementTool; label: string; icon: typeof Ruler }[] = [
  { tool: "select", label: "Select", icon: MousePointer2 },
  { tool: "line", label: "Line", icon: Ruler },
  { tool: "area", label: "Area", icon: Square },
  { tool: "count", label: "Count", icon: Target },
  { tool: "calibrate", label: "Calibrate", icon: Maximize2 },
];

/* ─── Component ─── */

export function TakeoffTab({ workspace }: { workspace: ProjectWorkspaceData }) {
  const drawings = (workspace.sourceDocuments ?? []).filter(
    (d) => d.documentType === "drawing"
  );

  const [selectedDocId, setSelectedDocId] = useState(drawings[0]?.id ?? "");
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(100);
  const [activeTool, setActiveTool] = useState<MeasurementTool>("select");
  const [takeoffItems, setTakeoffItems] = useState<TakeoffItem[]>([]);
  const [nextItemLabel, setNextItemLabel] = useState("");

  const selectedDoc = drawings.find((d) => d.id === selectedDocId);
  const totalPages = selectedDoc?.pageCount ?? 1;

  /* ─── Handlers ─── */

  function handlePrevPage() {
    setPage((p) => Math.max(1, p - 1));
  }

  function handleNextPage() {
    setPage((p) => Math.min(totalPages, p + 1));
  }

  function handleZoomIn() {
    setZoom((z) => Math.min(400, z + 25));
  }

  function handleZoomOut() {
    setZoom((z) => Math.max(25, z - 25));
  }

  function handleFitToWidth() {
    setZoom(100);
  }

  function handleAddItem() {
    if (!nextItemLabel.trim()) return;
    const newItem: TakeoffItem = {
      id: crypto.randomUUID(),
      label: nextItemLabel.trim(),
      tool: activeTool === "select" ? "count" : activeTool,
      quantity: 0,
      unit: activeTool === "line" ? "ft" : activeTool === "area" ? "sq ft" : "ea",
      color: TOOL_COLORS[takeoffItems.length % TOOL_COLORS.length],
    };
    setTakeoffItems((items) => [...items, newItem]);
    setNextItemLabel("");
  }

  function handleRemoveItem(id: string) {
    setTakeoffItems((items) => items.filter((i) => i.id !== id));
  }

  function handleUpdateQuantity(id: string, quantity: number) {
    setTakeoffItems((items) =>
      items.map((i) => (i.id === id ? { ...i, quantity } : i))
    );
  }

  /* ─── Render ─── */

  return (
    <div className="flex h-[calc(100vh-320px)] min-h-[500px] flex-col gap-3">
      {/* ─── Top Toolbar ─── */}
      <div className="flex items-center gap-3 rounded-lg border border-line bg-panel px-3 py-2">
        {/* Document selector */}
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium text-fg/50">Drawing:</label>
          <Select
            className="h-8 w-56 text-xs"
            value={selectedDocId}
            onChange={(e) => {
              setSelectedDocId(e.target.value);
              setPage(1);
            }}
          >
            {drawings.length === 0 && (
              <option value="">No drawings available</option>
            )}
            {drawings.map((d) => (
              <option key={d.id} value={d.id}>
                {d.fileName}
              </option>
            ))}
          </Select>
        </div>

        <Separator className="!h-6 !w-px" />

        {/* Page navigation */}
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="xs" onClick={handlePrevPage} disabled={page <= 1}>
            <ChevronLeft className="h-3.5 w-3.5" />
          </Button>
          <div className="flex items-center gap-1">
            <Input
              className="h-7 w-12 px-1 text-center text-xs"
              type="number"
              min={1}
              max={totalPages}
              value={page}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                if (!isNaN(v) && v >= 1 && v <= totalPages) setPage(v);
              }}
            />
            <span className="text-xs text-fg/40">/ {totalPages}</span>
          </div>
          <Button variant="ghost" size="xs" onClick={handleNextPage} disabled={page >= totalPages}>
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </div>

        <Separator className="!h-6 !w-px" />

        {/* Zoom controls */}
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="xs" onClick={handleZoomOut}>
            <Minus className="h-3.5 w-3.5" />
          </Button>
          <span className="w-12 text-center text-xs text-fg/60">{zoom}%</span>
          <Button variant="ghost" size="xs" onClick={handleZoomIn}>
            <Plus className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="xs" onClick={handleFitToWidth} title="Fit to width">
            <Maximize2 className="h-3.5 w-3.5" />
          </Button>
        </div>

        <div className="flex-1" />

        {/* Export */}
        <Button variant="secondary" size="sm">
          <Download className="h-3.5 w-3.5" />
          Export Takeoff
        </Button>
      </div>

      {/* ─── Main Area ─── */}
      <div className="flex flex-1 gap-3 overflow-hidden">
        {/* Left: Measurement tools panel */}
        <div className="flex w-12 flex-col gap-1 rounded-lg border border-line bg-panel p-1.5">
          {MEASUREMENT_TOOLS.map(({ tool, label, icon: Icon }) => (
            <button
              key={tool}
              onClick={() => setActiveTool(tool)}
              title={label}
              className={cn(
                "flex h-9 w-9 items-center justify-center rounded-md transition-colors",
                activeTool === tool
                  ? "bg-accent/15 text-accent"
                  : "text-fg/40 hover:bg-panel2 hover:text-fg/70"
              )}
            >
              <Icon className="h-4 w-4" />
            </button>
          ))}
        </div>

        {/* Center: Document viewer area */}
        <div className="flex flex-1 items-center justify-center overflow-auto rounded-lg border border-line bg-bg/50">
          {!selectedDoc ? (
            <EmptyState className="border-none">
              <Ruler className="mx-auto mb-3 h-10 w-10 text-fg/20" />
              <p className="text-sm font-medium text-fg/50">Select a drawing to begin takeoff</p>
              <p className="mt-1 text-xs text-fg/30">
                Upload drawings via the Documents tab, then select one here to start measuring.
              </p>
            </EmptyState>
          ) : (
            <div className="flex flex-col items-center gap-3 p-8">
              <div
                className="flex items-center justify-center rounded-lg border-2 border-dashed border-line bg-panel"
                style={{
                  width: `${Math.round(800 * (zoom / 100))}px`,
                  height: `${Math.round(600 * (zoom / 100))}px`,
                  minWidth: 200,
                  minHeight: 150,
                }}
              >
                <div className="text-center">
                  <Ruler className="mx-auto mb-2 h-8 w-8 text-fg/20" />
                  <p className="text-sm font-medium text-fg/50">{selectedDoc.fileName}</p>
                  <p className="mt-1 text-xs text-fg/30">
                    Page {page} of {totalPages}
                  </p>
                  <p className="mt-3 text-xs text-fg/25">
                    PDF viewer placeholder &mdash; connect a document server to render drawings
                  </p>
                  <Badge tone="info" className="mt-3">
                    {activeTool.charAt(0).toUpperCase() + activeTool.slice(1)} tool active
                  </Badge>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Right: Takeoff items list */}
        <Card className="w-72 shrink-0 flex flex-col overflow-hidden">
          <CardHeader className="py-3">
            <CardTitle>Takeoff Items</CardTitle>
          </CardHeader>
          <CardBody className="flex flex-1 flex-col gap-3 overflow-auto py-3">
            {/* Add new item */}
            <div className="flex gap-1.5">
              <Input
                className="h-8 text-xs"
                placeholder="New item label..."
                value={nextItemLabel}
                onChange={(e) => setNextItemLabel(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleAddItem();
                }}
              />
              <Button variant="secondary" size="xs" onClick={handleAddItem}>
                <Plus className="h-3.5 w-3.5" />
              </Button>
            </div>

            <Separator />

            {/* Items list */}
            {takeoffItems.length === 0 ? (
              <EmptyState className="py-6">
                <p className="text-xs">No takeoff items yet</p>
                <p className="mt-1 text-[11px] text-fg/30">
                  Add items above to start counting
                </p>
              </EmptyState>
            ) : (
              <div className="space-y-2">
                {takeoffItems.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center gap-2 rounded-md border border-line bg-bg/30 px-2.5 py-2"
                  >
                    <div
                      className="h-3 w-3 shrink-0 rounded-full"
                      style={{ backgroundColor: item.color }}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium text-fg/80">
                        {item.label}
                      </p>
                      <p className="text-[11px] text-fg/40">
                        {item.tool} &middot; {item.unit}
                      </p>
                    </div>
                    <Input
                      className="h-7 w-16 px-1.5 text-center text-xs"
                      type="number"
                      min={0}
                      value={item.quantity}
                      onChange={(e) =>
                        handleUpdateQuantity(
                          item.id,
                          parseFloat(e.target.value) || 0
                        )
                      }
                    />
                    <button
                      onClick={() => handleRemoveItem(item.id)}
                      className="text-fg/30 transition-colors hover:text-danger"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Summary */}
            {takeoffItems.length > 0 && (
              <>
                <Separator />
                <div className="rounded-md bg-panel2/50 px-3 py-2">
                  <p className="text-xs font-medium text-fg/60">
                    {takeoffItems.length} item{takeoffItems.length !== 1 ? "s" : ""} &middot;{" "}
                    {takeoffItems.reduce((sum, i) => sum + i.quantity, 0)} total count
                  </p>
                </div>
              </>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
