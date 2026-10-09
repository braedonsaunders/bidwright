"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Hand,
  Hash,
  Highlighter,
  Loader2,
  Ruler,
  Scaling,
  Square,
  Trash2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { Button } from "@braedonsaunders/appkit-ui";
import { PdfCanvasViewer } from "../takeoff/pdf-canvas-viewer";
import { AnnotationCanvas, type Pickup } from "../takeoff/annotation-canvas";
import { createPickup, deletePickup, listPickups } from "@/lib/api";
import type { Calibration, Point } from "@/lib/takeoff-math";
import { cn } from "@/lib/utils";

type RecordPickup = Pickup & {
  pageNumber: number;
  calibration?: Calibration;
  annotationType: string;
  lineThickness: number;
};
const tools = [
  { id: "select", label: "Pan", icon: Hand },
  { id: "calibrate", label: "Calibrate", icon: Scaling },
  { id: "linear", label: "Distance", icon: Ruler },
  { id: "area-rectangle", label: "Area", icon: Square },
  { id: "count", label: "Count", icon: Hash },
  { id: "markup-highlight", label: "Highlight", icon: Highlighter },
];
export function StandalonePdfEditor({
  projectId,
  documentId,
  fileUrl,
  fileName,
  headerActions,
}: {
  projectId: string;
  documentId: string;
  fileUrl: string;
  fileName: string;
  headerActions?: ReactNode;
}) {
  const [page, setPage] = useState(1),
    [pages, setPages] = useState(1),
    [zoom, setZoom] = useState(1),
    [tool, setTool] = useState("select"),
    [size, setSize] = useState({ width: 0, height: 0 });
  const [records, setRecords] = useState<RecordPickup[]>([]),
    [error, setError] = useState(""),
    [saving, setSaving] = useState(false),
    [selected, setSelected] = useState("");
  const [calibration, setCalibration] = useState<Calibration | null>(null),
    [pending, setPending] = useState<[Point, Point] | null>(null),
    [known, setKnown] = useState(""),
    [unit, setUnit] = useState("ft");
  const canvas = useRef<HTMLCanvasElement | null>(null),
    load = useRef(0);
  const map = (r: RecordPickup): RecordPickup => ({
    ...r,
    type: r.annotationType,
    thickness: r.lineThickness,
    canvasWidth: Number(r.metadata?.canvasWidth) || undefined,
    canvasHeight: Number(r.metadata?.canvasHeight) || undefined,
  });
  useEffect(() => {
    const current = ++load.current;
    listPickups(projectId, documentId)
      .then((rows) => {
        if (current !== load.current) return;
        const mapped = rows.map(map);
        setRecords(mapped);
      })
      .catch((e) => setError(e.message));
    return () => {
      load.current++;
    };
  }, [projectId, documentId]);
  useEffect(() => {
    setCalibration(
      [...records].reverse().find((r) => r.pageNumber === page && r.calibration)?.calibration ?? null,
    );
  }, [page, records]);
  const complete = async (data: Partial<Pickup>, cal = calibration) => {
    setSaving(true);
    setError("");
    try {
      const record = await createPickup(projectId, {
        documentId,
        pageNumber: page,
        annotationType: data.type,
        label: data.label || tools.find((t) => t.id === data.type)?.label || "Markup",
        points: data.points ?? [],
        measurement: data.measurement ?? {},
        color: data.color ?? "#0897b2",
        lineThickness: data.thickness ?? 2,
        visible: data.visible ?? true,
        calibration: cal,
        metadata: {
          ...data.metadata,
          canvasWidth: size.width,
          canvasHeight: size.height,
          source: "manual",
          measuredBy: "person",
          method: "manual-pdf",
          toolsWorkspace: true,
        },
      });
      setRecords((prev) => [...prev, map(record)]);
      setSelected(record.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };
  const calibrate = async () => {
    if (!pending || !(Number(known) > 0)) return;
    const pixels = Math.hypot(pending[1].x - pending[0].x, pending[1].y - pending[0].y);
    const cal = { pixelsPerUnit: pixels / zoom / Number(known), unit };
    setCalibration(cal);
    await complete({ type: "calibration", label: "Scale calibration", points: pending, visible: false }, cal);
    setPending(null);
    setTool("linear");
  };
  const annotations = records.filter((r) => r.pageNumber === page && r.type !== "calibration");
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-panel">
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-line px-3">
        <strong className="min-w-0 flex-1 truncate text-xs">{fileName}</strong>
        <span role="status" className="text-[10px] text-fg/45">
          {saving ? "Saving…" : "Saved"}
        </span>
        {headerActions}
      </header>
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-line px-2">
        {tools.map(({ id, label, icon: Icon }) => (
          <Button
            key={id}
            variant={tool === id ? "secondary" : "ghost"}
            size="sm"
            title={label}
            aria-label={label}
            className="h-7 gap-1.5 px-2 text-[11px]"
            onClick={() => setTool(id)}
          >
            <Icon size={14} />
            {label}
          </Button>
        ))}
        <div className="flex-1" />
        <span className="text-[10px] text-fg/45">
          {calibration ? "Calibrated · " + calibration.unit : "Calibrate before measuring"}
        </span>
        <Button
          variant="ghost"
          size="sm"
          aria-label="Zoom out PDF"
          onClick={() => setZoom((z) => Math.max(0.25, z / 1.2))}
        >
          <ZoomOut size={14} />
        </Button>
        <span className="w-10 text-center text-[10px]">{Math.round(zoom * 100)}%</span>
        <Button
          variant="ghost"
          size="sm"
          aria-label="Zoom in PDF"
          onClick={() => setZoom((z) => Math.min(4, z * 1.2))}
        >
          <ZoomIn size={14} />
        </Button>
      </div>
      {error && (
        <p role="alert" className="bg-danger/5 px-3 py-2 text-xs text-danger">
          {error}
        </p>
      )}
      <div className="flex min-h-0 flex-1">
        <div className="min-h-0 min-w-0 flex-1 overflow-auto bg-panel2 p-5 text-center">
          <div className="relative inline-block text-left shadow-xl">
            <PdfCanvasViewer
              documentUrl={fileUrl}
              pageNumber={page}
              zoom={zoom}
              onPageCount={setPages}
              onCanvasResize={(width, height) =>
                setSize((current) =>
                  current.width === width && current.height === height ? current : { width, height },
                )
              }
              canvasRef={canvas}
            />
            <AnnotationCanvas
              width={size.width}
              height={size.height}
              annotations={annotations}
              activeTool={tool === "select" ? null : tool}
              calibration={calibration}
              zoom={zoom}
              activeColor={tool === "markup-highlight" ? "#fbbf24" : "#0897b2"}
              activeThickness={2}
              selectedPickupId={selected}
              onAnnotationComplete={(data) => void complete(data)}
              onCalibrationRequest={setPending}
              pdfCanvas={canvas.current}
              snapEnabled
            />
          </div>
        </div>
        <aside className="w-48 shrink-0 overflow-y-auto border-l border-line bg-panel p-3">
          <h3 className="mb-4 text-xs font-semibold">Measurements & markups</h3>
          {annotations.length === 0 && (
            <p className="text-[11px] leading-relaxed text-fg/40">
              Calibrate a known dimension, then measure distances and areas or count items on the sheet.
            </p>
          )}
          {annotations.map((r) => (
            <div
              key={r.id}
              className={cn(
                "mb-2 rounded border border-line p-2",
                selected === r.id && "border-accent bg-accent/5",
              )}
            >
              <button className="w-full text-left" onClick={() => setSelected(r.id)}>
                <span className="text-[11px] font-medium">{r.label}</span>
                <p className="mt-1 text-[10px] text-fg/50">
                  {r.measurement?.value?.toFixed(2)} {r.measurement?.unit}
                </p>
              </button>
              <button
                aria-label={"Delete " + r.label}
                className="mt-2 text-fg/30 hover:text-danger"
                onClick={() => {
                  void deletePickup(projectId, r.id)
                    .then(() => setRecords((prev) => prev.filter((x) => x.id !== r.id)))
                    .catch((e) => setError(e.message));
                }}
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </aside>
      </div>
      <footer className="flex h-9 shrink-0 items-center justify-center gap-3 border-t border-line">
        <Button
          variant="ghost"
          size="sm"
          aria-label="Previous PDF page"
          disabled={page === 1}
          onClick={() => setPage((p) => p - 1)}
        >
          <ChevronLeft size={14} />
        </Button>
        <span className="text-[11px] text-fg/55">
          Page {page} of {pages}
        </span>
        <Button
          variant="ghost"
          size="sm"
          aria-label="Next PDF page"
          disabled={page >= pages}
          onClick={() => setPage((p) => p + 1)}
        >
          <ChevronRight size={14} />
        </Button>
      </footer>
      {pending && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30">
          <form
            className="w-80 rounded-xl border border-line bg-panel p-5 shadow-2xl"
            onSubmit={(e) => {
              e.preventDefault();
              void calibrate();
            }}
          >
            <h2 className="text-sm font-semibold">Calibrate drawing scale</h2>
            <p className="mt-2 text-xs text-fg/45">Enter the real length of the line you traced.</p>
            <div className="mt-4 flex gap-2">
              <input
                aria-label="Known dimension"
                autoFocus
                type="number"
                min=".0001"
                step="any"
                value={known}
                onChange={(e) => setKnown(e.target.value)}
                className="h-9 min-w-0 flex-1 rounded border border-line bg-bg px-2"
              />
              <select
                aria-label="Calibration units"
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                className="rounded border border-line bg-bg px-2"
              >
                {["ft", "in", "mm", "m"].map((u) => (
                  <option key={u}>{u}</option>
                ))}
              </select>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="ghost" size="sm" type="button" onClick={() => setPending(null)}>
                Cancel
              </Button>
              <Button size="sm" disabled={saving || !(Number(known) > 0)}>
                {saving ? <Loader2 size={12} className="animate-spin" /> : null}Set scale
              </Button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
