"use client";

import { useState } from "react";
import { Button } from "@braedonsaunders/appkit-ui";
import { saveFileNodeContent } from "@/lib/api";
import type { Pickup } from "./takeoff/annotation-canvas";
import { SpoolyardEditor } from "./editors/spoolyard-editor";

export function PipingTakeoffSurface({ projectId, fileNodeId, fileName, fileUrl, pickups, onSelect, onUpdate, onFilesChanged }: {
  projectId: string;
  fileNodeId?: string;
  fileName: string;
  fileUrl: string;
  pickups: Pickup[];
  onSelect: (id: string) => void;
  onUpdate: (pickup: Pickup) => Promise<void>;
  onFilesChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  async function save(pickup: Pickup) {
    setError("");
    setSavingId(pickup.id);
    try { await onUpdate(pickup); }
    catch (error) { setError(error instanceof Error ? error.message : "Unable to save pickup"); }
    finally { setSavingId(null); }
  }
  if (editing && fileNodeId) return (
    <SpoolyardEditor fileUrl={fileUrl} fileName={fileName}
      headerActions={<Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Back to quantities</Button>}
      onSave={async content => {
        await saveFileNodeContent(projectId, fileNodeId, new File([content], fileName, { type: "application/json" }));
        onFilesChanged();
      }}
    />
  );
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-4">
      <div className="flex items-center justify-between gap-3">
        <span className="truncate text-sm font-medium">{fileName}</span>
        {fileNodeId && fileName.toLowerCase().endsWith(".piping")
          ? <Button size="sm" onClick={() => setEditing(true)}>Open in Spoolyard</Button>
          : <a href={fileUrl} download className="text-xs underline">Download source</a>}
      </div>
      {error && <p role="alert" className="text-xs text-red-500">{error}</p>}
      {pickups.length ? <table className="w-full text-left text-xs">
        <thead><tr><th className="p-2">Item</th><th className="p-2">Quantity</th><th className="p-2">Unit</th><th className="p-2">Source</th></tr></thead>
        <tbody>{pickups.map(pickup => <tr key={`${pickup.id}-${pickup.label}-${pickup.measurement?.value}`} className="border-t border-line" onClick={() => onSelect(pickup.id)}>
          <td className="p-2"><input aria-label={`Label for ${pickup.label}`} className="w-full rounded border border-line bg-bg p-1" defaultValue={pickup.label} disabled={savingId === pickup.id} onBlur={event => {
            if (event.target.value !== pickup.label) void save({ ...pickup, label: event.target.value });
          }} /></td>
          <td className="w-32 p-2"><input aria-label={`Quantity for ${pickup.label}`} className="w-full rounded border border-line bg-bg p-1" type="number" min="0" step="any" defaultValue={pickup.measurement?.value} disabled={savingId === pickup.id} onBlur={event => {
            const value = event.target.valueAsNumber;
            if (!Number.isFinite(value) || value < 0) { setError("Enter a non-negative quantity."); return; }
            if (value !== pickup.measurement?.value) void save({ ...pickup, measurement: { ...pickup.measurement, value, unit: pickup.measurement?.unit ?? "EA", ...(pickup.type === "count" ? { count: value } : {}) }, metadata: { ...pickup.metadata, editedBy: "person" } });
          }} /></td>
          <td className="p-2">{pickup.measurement?.unit}</td>
          <td className="p-2">{String(pickup.metadata?.basis ?? "Piping MTO")}</td>
        </tr>)}</tbody>
      </table> : <p className="text-xs text-fg/60">No saved piping quantities. Ask the estimating agent to read this source and save the MTO lines you want.</p>}
    </div>
  );
}
