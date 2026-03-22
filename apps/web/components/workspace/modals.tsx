"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  Button,
  Card,
  CardHeader,
  CardBody,
  CardTitle,
  Input,
  Label,
  Select,
  Textarea,
  Badge,
  Separator,
  Toggle,
} from "@/components/ui";
import { cn } from "@/lib/utils";
import type { Activity } from "@/lib/api";

/* ═══════════════════════════════════════════════════════════════════════════
   Shared Modal Shell
   ═══════════════════════════════════════════════════════════════════════════ */

function ModalBackdrop({
  open,
  onClose,
  children,
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
}) {
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const widths = {
    sm: "max-w-sm",
    md: "max-w-md",
    lg: "max-w-lg",
    xl: "max-w-2xl",
  }[size];

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 animate-in fade-in duration-150"
      onClick={(e) => {
        if (e.target === overlayRef.current) onClose();
      }}
    >
      <Card className={cn("w-full shadow-xl", widths)}>{children}</Card>
    </div>
  );
}

function ModalClose({ onClose }: { onClose: () => void }) {
  return (
    <button
      type="button"
      onClick={onClose}
      className="absolute right-3 top-3 rounded-md p-1 text-fg/40 hover:text-fg transition-colors"
    >
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <path d="M1 1L13 13M13 1L1 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    </button>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   1. ConfirmModal
   ═══════════════════════════════════════════════════════════════════════════ */

export function ConfirmModal({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = "Confirm",
  confirmVariant = "default",
  isPending = false,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmLabel?: string;
  confirmVariant?: "default" | "danger";
  isPending?: boolean;
}) {
  return (
    <ModalBackdrop open={open} onClose={onClose} size="sm">
      <CardHeader className="relative">
        <CardTitle>{title}</CardTitle>
        <ModalClose onClose={onClose} />
      </CardHeader>
      <CardBody>
        <p className="text-sm text-fg/70 mb-5">{message}</p>
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button
            variant={confirmVariant === "danger" ? "danger" : "default"}
            size="sm"
            onClick={onConfirm}
            disabled={isPending}
          >
            {isPending ? "Working..." : confirmLabel}
          </Button>
        </div>
      </CardBody>
    </ModalBackdrop>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   2. CreateWorksheetModal
   ═══════════════════════════════════════════════════════════════════════════ */

export function CreateWorksheetModal({
  open,
  onClose,
  onConfirm,
  isPending = false,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: (name: string) => void;
  isPending?: boolean;
}) {
  const [name, setName] = useState("");

  useEffect(() => {
    if (open) setName("");
  }, [open]);

  return (
    <ModalBackdrop open={open} onClose={onClose} size="sm">
      <CardHeader className="relative">
        <CardTitle>Create Worksheet</CardTitle>
        <ModalClose onClose={onClose} />
      </CardHeader>
      <CardBody>
        <Label htmlFor="ws-name">Worksheet Name</Label>
        <Input
          id="ws-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Electrical, Mechanical"
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Enter" && name.trim()) onConfirm(name.trim());
          }}
        />
        <div className="mt-5 flex items-center justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button size="sm" onClick={() => onConfirm(name.trim())} disabled={!name.trim() || isPending}>
            {isPending ? "Creating..." : "Create"}
          </Button>
        </div>
      </CardBody>
    </ModalBackdrop>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   3. RenameWorksheetModal
   ═══════════════════════════════════════════════════════════════════════════ */

export function RenameWorksheetModal({
  open,
  onClose,
  onConfirm,
  currentName,
  isPending = false,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: (name: string) => void;
  currentName: string;
  isPending?: boolean;
}) {
  const [name, setName] = useState(currentName);

  useEffect(() => {
    if (open) setName(currentName);
  }, [open, currentName]);

  return (
    <ModalBackdrop open={open} onClose={onClose} size="sm">
      <CardHeader className="relative">
        <CardTitle>Rename Worksheet</CardTitle>
        <ModalClose onClose={onClose} />
      </CardHeader>
      <CardBody>
        <Label htmlFor="ws-rename">Worksheet Name</Label>
        <Input
          id="ws-rename"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Enter" && name.trim()) onConfirm(name.trim());
          }}
        />
        <div className="mt-5 flex items-center justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button size="sm" onClick={() => onConfirm(name.trim())} disabled={!name.trim() || isPending}>
            {isPending ? "Saving..." : "Rename"}
          </Button>
        </div>
      </CardBody>
    </ModalBackdrop>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   4. SendQuoteModal
   ═══════════════════════════════════════════════════════════════════════════ */

export function SendQuoteModal({
  open,
  onClose,
  onConfirm,
  isPending = false,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: (contacts: string[], message: string) => void;
  isPending?: boolean;
}) {
  const [contactsRaw, setContactsRaw] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (open) {
      setContactsRaw("");
      setMessage("");
    }
  }, [open]);

  const contacts = contactsRaw
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);

  return (
    <ModalBackdrop open={open} onClose={onClose} size="md">
      <CardHeader className="relative">
        <CardTitle>Send Quote</CardTitle>
        <ModalClose onClose={onClose} />
      </CardHeader>
      <CardBody>
        <div className="space-y-4">
          <div>
            <Label htmlFor="sq-contacts">Recipients</Label>
            <Input
              id="sq-contacts"
              value={contactsRaw}
              onChange={(e) => setContactsRaw(e.target.value)}
              placeholder="email1@example.com, email2@example.com"
            />
            <p className="mt-1 text-[11px] text-fg/40">Comma-separated email addresses</p>
          </div>
          <div>
            <Label htmlFor="sq-message">Message</Label>
            <Textarea
              id="sq-message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Enter a message to include with the quote..."
              rows={5}
            />
          </div>
        </div>
        <div className="mt-5 flex items-center justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button
            variant="accent"
            size="sm"
            onClick={() => onConfirm(contacts, message)}
            disabled={contacts.length === 0 || isPending}
          >
            {isPending ? "Sending..." : "Send"}
          </Button>
        </div>
      </CardBody>
    </ModalBackdrop>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   5. CreateJobModal
   ═══════════════════════════════════════════════════════════════════════════ */

export interface CreateJobData {
  jobName: string;
  foreman: string;
  projectManager: string;
  startDate: string;
  shipDate: string;
  poNumber: string;
  poIssuer: string;
}

export function CreateJobModal({
  open,
  onClose,
  onConfirm,
  isPending = false,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: (data: CreateJobData) => void;
  isPending?: boolean;
}) {
  const empty: CreateJobData = {
    jobName: "",
    foreman: "",
    projectManager: "",
    startDate: "",
    shipDate: "",
    poNumber: "",
    poIssuer: "",
  };

  const [form, setForm] = useState<CreateJobData>(empty);

  useEffect(() => {
    if (open) setForm(empty);
  }, [open]);

  const set = (field: keyof CreateJobData, value: string) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  return (
    <ModalBackdrop open={open} onClose={onClose} size="lg">
      <CardHeader className="relative">
        <CardTitle>Create Job</CardTitle>
        <ModalClose onClose={onClose} />
      </CardHeader>
      <CardBody>
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <Label htmlFor="cj-name">Job Name</Label>
            <Input id="cj-name" value={form.jobName} onChange={(e) => set("jobName", e.target.value)} />
          </div>
          <div>
            <Label htmlFor="cj-foreman">Foreman</Label>
            <Input id="cj-foreman" value={form.foreman} onChange={(e) => set("foreman", e.target.value)} />
          </div>
          <div>
            <Label htmlFor="cj-pm">Project Manager</Label>
            <Input id="cj-pm" value={form.projectManager} onChange={(e) => set("projectManager", e.target.value)} />
          </div>
          <div>
            <Label htmlFor="cj-start">Start Date</Label>
            <Input id="cj-start" type="date" value={form.startDate} onChange={(e) => set("startDate", e.target.value)} />
          </div>
          <div>
            <Label htmlFor="cj-ship">Ship Date</Label>
            <Input id="cj-ship" type="date" value={form.shipDate} onChange={(e) => set("shipDate", e.target.value)} />
          </div>
          <div>
            <Label htmlFor="cj-po">PO Number</Label>
            <Input id="cj-po" value={form.poNumber} onChange={(e) => set("poNumber", e.target.value)} />
          </div>
          <div>
            <Label htmlFor="cj-issuer">PO Issuer</Label>
            <Input id="cj-issuer" value={form.poIssuer} onChange={(e) => set("poIssuer", e.target.value)} />
          </div>
        </div>
        <div className="mt-5 flex items-center justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button size="sm" onClick={() => onConfirm(form)} disabled={!form.jobName.trim() || isPending}>
            {isPending ? "Creating..." : "Create Job"}
          </Button>
        </div>
      </CardBody>
    </ModalBackdrop>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   6. ImportBOMModal
   ═══════════════════════════════════════════════════════════════════════════ */

const BOM_TARGET_COLUMNS = [
  "Vendor",
  "Description",
  "Quantity",
  "Cost",
  "Markup",
  "Price",
  "LabourHourReg",
  "LabourHourOver",
  "LabourHourDouble",
  "LineOrder",
  "(skip)",
] as const;

export function ImportBOMModal({
  open,
  onClose,
  onImport,
  isPending = false,
}: {
  open: boolean;
  onClose: () => void;
  onImport: (file: File, mapping: Record<string, string>) => void;
  isPending?: boolean;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setFile(null);
      setHeaders([]);
      setMapping({});
      if (fileRef.current) fileRef.current.value = "";
    }
  }, [open]);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);

    // Parse headers from CSV
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      if (!text) return;
      const firstLine = text.split("\n")[0];
      const cols = firstLine.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
      setHeaders(cols);
      // Auto-map by name match
      const autoMap: Record<string, string> = {};
      cols.forEach((col) => {
        const match = BOM_TARGET_COLUMNS.find(
          (t) => t.toLowerCase() === col.toLowerCase()
        );
        autoMap[col] = match ?? "(skip)";
      });
      setMapping(autoMap);
    };
    reader.readAsText(f);
  }, []);

  return (
    <ModalBackdrop open={open} onClose={onClose} size="xl">
      <CardHeader className="relative">
        <CardTitle>Import Bill of Materials</CardTitle>
        <ModalClose onClose={onClose} />
      </CardHeader>
      <CardBody>
        <div className="space-y-4">
          <div>
            <Label htmlFor="bom-file">File (CSV / XLSX)</Label>
            <input
              ref={fileRef}
              id="bom-file"
              type="file"
              accept=".csv,.xlsx,.xls"
              onChange={handleFileChange}
              className="block w-full text-sm text-fg/70 file:mr-3 file:rounded-lg file:border file:border-line file:bg-panel2 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-fg/70 hover:file:bg-panel2/80"
            />
          </div>

          {headers.length > 0 && (
            <div>
              <p className="text-xs font-medium text-fg/50 mb-2">Column Mapping</p>
              <div className="max-h-64 overflow-y-auto rounded-lg border border-line">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-line bg-panel2/50">
                      <th className="px-3 py-2 text-left text-xs font-medium text-fg/50">Source Column</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-fg/50">Map To</th>
                    </tr>
                  </thead>
                  <tbody>
                    {headers.map((header) => (
                      <tr key={header} className="border-b border-line last:border-0">
                        <td className="px-3 py-2 text-fg/70">{header}</td>
                        <td className="px-3 py-2">
                          <Select
                            value={mapping[header] ?? "(skip)"}
                            onChange={(e) =>
                              setMapping((prev) => ({ ...prev, [header]: e.target.value }))
                            }
                            className="h-7 text-xs"
                          >
                            {BOM_TARGET_COLUMNS.map((col) => (
                              <option key={col} value={col}>
                                {col}
                              </option>
                            ))}
                          </Select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        <div className="mt-5 flex items-center justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={() => file && onImport(file, mapping)}
            disabled={!file || isPending}
          >
            {isPending ? "Importing..." : "Import"}
          </Button>
        </div>
      </CardBody>
    </ModalBackdrop>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   7. AIModal
   ═══════════════════════════════════════════════════════════════════════════ */

export function AIModal({
  open,
  onClose,
  onConfirm,
  title,
  message,
  result,
  isPending = false,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  result: string | null;
  isPending?: boolean;
}) {
  return (
    <ModalBackdrop open={open} onClose={onClose} size="md">
      <CardHeader className="relative">
        <CardTitle>{title}</CardTitle>
        <ModalClose onClose={onClose} />
      </CardHeader>
      <CardBody>
        <p className="text-sm text-fg/70 mb-4">{message}</p>

        {result !== null && (
          <div className="mb-4 max-h-64 overflow-y-auto rounded-lg border border-line bg-bg/50 p-3">
            <pre className="whitespace-pre-wrap text-xs text-fg/80">{result}</pre>
          </div>
        )}

        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          {result === null && (
            <Button variant="accent" size="sm" onClick={onConfirm} disabled={isPending}>
              {isPending ? "Generating..." : "Generate"}
            </Button>
          )}
        </div>
      </CardBody>
    </ModalBackdrop>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   8. AIPhasesModal
   ═══════════════════════════════════════════════════════════════════════════ */

export interface AIPhaseResult {
  number: string;
  name: string;
  description: string;
}

export function AIPhasesModal({
  open,
  onClose,
  onGenerate,
  onAccept,
  documents,
  result,
  isPending = false,
}: {
  open: boolean;
  onClose: () => void;
  onGenerate: (documentId?: string) => void;
  onAccept: () => void;
  documents: Array<{ id: string; fileName: string }>;
  result: AIPhaseResult[] | null;
  isPending?: boolean;
}) {
  const [selectedDocId, setSelectedDocId] = useState<string>("");

  useEffect(() => {
    if (open) setSelectedDocId("");
  }, [open]);

  return (
    <ModalBackdrop open={open} onClose={onClose} size="lg">
      <CardHeader className="relative">
        <CardTitle>AI Phase Generation</CardTitle>
        <ModalClose onClose={onClose} />
      </CardHeader>
      <CardBody>
        {result === null ? (
          <div className="space-y-4">
            <p className="text-sm text-fg/70">
              Select a source document to generate phases from, or generate without a document for a generic phase structure.
            </p>
            {documents.length > 0 && (
              <div>
                <Label htmlFor="aip-doc">Source Document</Label>
                <Select
                  id="aip-doc"
                  value={selectedDocId}
                  onChange={(e) => setSelectedDocId(e.target.value)}
                >
                  <option value="">None (generic)</option>
                  {documents.map((doc) => (
                    <option key={doc.id} value={doc.id}>
                      {doc.fileName}
                    </option>
                  ))}
                </Select>
              </div>
            )}
            <div className="flex items-center justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={onClose} disabled={isPending}>
                Cancel
              </Button>
              <Button
                variant="accent"
                size="sm"
                onClick={() => onGenerate(selectedDocId || undefined)}
                disabled={isPending}
              >
                {isPending ? "Generating..." : "Generate Phases"}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="max-h-72 overflow-y-auto rounded-lg border border-line">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line bg-panel2/50">
                    <th className="px-3 py-2 text-left text-xs font-medium text-fg/50">#</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-fg/50">Name</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-fg/50">Description</th>
                  </tr>
                </thead>
                <tbody>
                  {result.map((phase, i) => (
                    <tr key={i} className="border-b border-line last:border-0">
                      <td className="px-3 py-2 text-fg/50">{phase.number}</td>
                      <td className="px-3 py-2 text-fg">{phase.name}</td>
                      <td className="px-3 py-2 text-fg/70">{phase.description}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={onClose}>
                Cancel
              </Button>
              <Button variant="accent" size="sm" onClick={onAccept} disabled={isPending}>
                {isPending ? "Applying..." : "Accept Phases"}
              </Button>
            </div>
          </div>
        )}
      </CardBody>
    </ModalBackdrop>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   9. AIEquipmentModal
   ═══════════════════════════════════════════════════════════════════════════ */

export interface AIEquipmentResult {
  name: string;
  description: string;
  quantity: number;
  cost: number;
}

export function AIEquipmentModal({
  open,
  onClose,
  onGenerate,
  onAccept,
  result,
  isPending = false,
}: {
  open: boolean;
  onClose: () => void;
  onGenerate: () => void;
  onAccept: () => void;
  result: AIEquipmentResult[] | null;
  isPending?: boolean;
}) {
  return (
    <ModalBackdrop open={open} onClose={onClose} size="lg">
      <CardHeader className="relative">
        <CardTitle>AI Equipment Extraction</CardTitle>
        <ModalClose onClose={onClose} />
      </CardHeader>
      <CardBody>
        {result === null ? (
          <div className="space-y-4">
            <p className="text-sm text-fg/70">
              Extract equipment items from project documents using AI analysis.
            </p>
            <div className="flex items-center justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={onClose} disabled={isPending}>
                Cancel
              </Button>
              <Button variant="accent" size="sm" onClick={onGenerate} disabled={isPending}>
                {isPending ? "Analyzing..." : "Extract Equipment"}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="max-h-72 overflow-y-auto rounded-lg border border-line">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line bg-panel2/50">
                    <th className="px-3 py-2 text-left text-xs font-medium text-fg/50">Name</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-fg/50">Description</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-fg/50">Qty</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-fg/50">Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {result.map((item, i) => (
                    <tr key={i} className="border-b border-line last:border-0">
                      <td className="px-3 py-2 text-fg">{item.name}</td>
                      <td className="px-3 py-2 text-fg/70">{item.description}</td>
                      <td className="px-3 py-2 text-right text-fg/70">{item.quantity}</td>
                      <td className="px-3 py-2 text-right text-fg/70">
                        ${item.cost.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={onClose}>
                Cancel
              </Button>
              <Button variant="accent" size="sm" onClick={onAccept} disabled={isPending}>
                {isPending ? "Adding..." : "Accept Equipment"}
              </Button>
            </div>
          </div>
        )}
      </CardBody>
    </ModalBackdrop>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   10. ActivityModal
   ═══════════════════════════════════════════════════════════════════════════ */

export function ActivityModal({
  open,
  onClose,
  activities,
}: {
  open: boolean;
  onClose: () => void;
  activities: Activity[];
}) {
  return (
    <ModalBackdrop open={open} onClose={onClose} size="lg">
      <CardHeader className="relative">
        <CardTitle>Activity Log</CardTitle>
        <ModalClose onClose={onClose} />
      </CardHeader>
      <CardBody className="max-h-96 overflow-y-auto">
        {activities.length === 0 ? (
          <p className="py-6 text-center text-sm text-fg/40">No activity recorded.</p>
        ) : (
          <div className="space-y-3">
            {activities.map((activity) => (
              <div
                key={activity.id}
                className="flex items-start gap-3 rounded-lg border border-line bg-bg/30 px-3 py-2.5"
              >
                <div className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-accent/60" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Badge tone="info">{activity.type}</Badge>
                    <span className="text-[11px] text-fg/40">
                      {new Date(activity.createdAt).toLocaleString()}
                    </span>
                  </div>
                  {activity.data && Object.keys(activity.data).length > 0 && (
                    <pre className="mt-1.5 overflow-x-auto text-[11px] text-fg/50">
                      {JSON.stringify(activity.data, null, 2)}
                    </pre>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="mt-5 flex justify-end">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </CardBody>
    </ModalBackdrop>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   11. PDFModal
   ═══════════════════════════════════════════════════════════════════════════ */

export interface PDFDownloadOptions {
  template: string;
  includeLineItems: boolean;
  includePhases: boolean;
  includeConditions: boolean;
  includeCoverPage: boolean;
  includeLabourSummary: boolean;
  selectedDocumentIds: string[];
}

export function PDFModal({
  open,
  onClose,
  onDownload,
  isPending = false,
  documents = [],
}: {
  open: boolean;
  onClose: () => void;
  onDownload: (options: PDFDownloadOptions) => void;
  isPending?: boolean;
  documents?: Array<{ id: string; fileName: string }>;
}) {
  const [options, setOptions] = useState<PDFDownloadOptions>({
    template: "standard",
    includeLineItems: true,
    includePhases: true,
    includeConditions: true,
    includeCoverPage: true,
    includeLabourSummary: false,
    selectedDocumentIds: [],
  });

  useEffect(() => {
    if (open) {
      setOptions({
        template: "standard",
        includeLineItems: true,
        includePhases: true,
        includeConditions: true,
        includeCoverPage: true,
        includeLabourSummary: false,
        selectedDocumentIds: [],
      });
    }
  }, [open]);

  const toggleDoc = (docId: string) => {
    setOptions((prev) => ({
      ...prev,
      selectedDocumentIds: prev.selectedDocumentIds.includes(docId)
        ? prev.selectedDocumentIds.filter((id) => id !== docId)
        : [...prev.selectedDocumentIds, docId],
    }));
  };

  return (
    <ModalBackdrop open={open} onClose={onClose} size="md">
      <CardHeader className="relative">
        <CardTitle>Download PDF</CardTitle>
        <ModalClose onClose={onClose} />
      </CardHeader>
      <CardBody>
        <div className="space-y-5">
          <div>
            <Label htmlFor="pdf-template">Template</Label>
            <Select
              id="pdf-template"
              value={options.template}
              onChange={(e) => setOptions((prev) => ({ ...prev, template: e.target.value }))}
            >
              <option value="standard">Standard</option>
              <option value="detailed">Detailed</option>
              <option value="summary">Summary Only</option>
              <option value="client">Client Facing</option>
            </Select>
          </div>

          <div>
            <p className="text-xs font-medium text-fg/50 mb-3">Sections</p>
            <div className="space-y-2.5">
              {(
                [
                  ["includeCoverPage", "Cover Page"],
                  ["includeLineItems", "Line Items"],
                  ["includePhases", "Phases"],
                  ["includeConditions", "Conditions"],
                  ["includeLabourSummary", "Labour Summary"],
                ] as const
              ).map(([key, label]) => (
                <div key={key} className="flex items-center justify-between">
                  <span className="text-sm text-fg/70">{label}</span>
                  <Toggle
                    checked={options[key]}
                    onChange={(v) => setOptions((prev) => ({ ...prev, [key]: v }))}
                  />
                </div>
              ))}
            </div>
          </div>

          {documents.length > 0 && (
            <div>
              <p className="text-xs font-medium text-fg/50 mb-2">Attach Documents</p>
              <div className="max-h-36 overflow-y-auto space-y-1.5">
                {documents.map((doc) => (
                  <label
                    key={doc.id}
                    className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-fg/70 hover:bg-panel2/40 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={options.selectedDocumentIds.includes(doc.id)}
                      onChange={() => toggleDoc(doc.id)}
                      className="rounded border-line"
                    />
                    {doc.fileName}
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="mt-5 flex items-center justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button variant="accent" size="sm" onClick={() => onDownload(options)} disabled={isPending}>
            {isPending ? "Generating..." : "Download PDF"}
          </Button>
        </div>
      </CardBody>
    </ModalBackdrop>
  );
}
