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
  ModalBackdrop as AnimatedModalBackdrop,
  Select,
  Textarea,
  Badge,
  Separator,
  Toggle,
} from "@/components/ui";
import { cn } from "@/lib/utils";
import type { Activity } from "@/lib/api";

/* ═══════════════════════════════════════════════════════════════════════════
   Shared Modal Shell (uses animated ModalBackdrop from ui.tsx)
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
  const sizeMap = { sm: "sm" as const, md: "md" as const, lg: "lg" as const, xl: "xl" as const };
  return (
    <AnimatedModalBackdrop open={open} onClose={onClose} size={sizeMap[size]}>
      <Card className="w-full shadow-xl">{children}</Card>
    </AnimatedModalBackdrop>
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
  { value: "entityName", label: "Line Item" },
  { value: "description", label: "Description" },
  { value: "quantity", label: "Quantity" },
  { value: "uom", label: "Unit" },
  { value: "cost", label: "Unit Cost" },
  { value: "markup", label: "Markup" },
  { value: "price", label: "Unit Price" },
  { value: "category", label: "Category" },
  { value: "entityType", label: "Entity Type" },
  { value: "vendor", label: "Vendor" },
  { value: "unit1", label: "Regular Hours" },
  { value: "unit2", label: "Overtime Hours" },
  { value: "unit3", label: "Double Time Hours" },
  { value: "lineOrder", label: "Line Order" },
  { value: "skip", label: "Skip" },
] as const;

type ImportTargetColumn = (typeof BOM_TARGET_COLUMNS)[number]["value"];

const IMPORT_COLUMN_ALIASES: Record<Exclude<ImportTargetColumn, "skip">, RegExp[]> = {
  entityName: [/^item$/i, /item\s*name/i, /line\s*item/i, /material/i, /product/i, /name/i],
  description: [/description/i, /scope/i, /work\s*description/i],
  quantity: [/^qty$/i, /quantity/i, /count/i, /amount/i],
  uom: [/^uom$/i, /^unit$/i, /unit\s*of\s*measure/i, /^um$/i],
  cost: [/unit\s*cost/i, /^cost$/i, /our\s*cost/i, /each\s*cost/i],
  markup: [/markup/i, /margin/i],
  price: [/unit\s*price/i, /^price$/i, /sell/i, /rate/i],
  category: [/category/i, /cost\s*type/i, /class/i, /trade/i],
  entityType: [/entity\s*type/i, /resource\s*type/i, /item\s*type/i],
  vendor: [/vendor/i, /supplier/i, /manufacturer/i],
  unit1: [/regular\s*hours/i, /^reg/i, /straight\s*time/i],
  unit2: [/overtime/i, /^ot/i],
  unit3: [/double\s*time/i, /^dt/i],
  lineOrder: [/line\s*order/i, /^order$/i, /sort/i],
};

function inferImportTarget(header: string): ImportTargetColumn {
  for (const [target, patterns] of Object.entries(IMPORT_COLUMN_ALIASES) as Array<[Exclude<ImportTargetColumn, "skip">, RegExp[]]>) {
    if (patterns.some((pattern) => pattern.test(header))) {
      return target;
    }
  }
  return "skip";
}

export function ImportBOMModal({
  open,
  onClose,
  onPreview,
  onImport,
  isPending = false,
}: {
  open: boolean;
  onClose: () => void;
  onPreview: (file: File) => Promise<{ headers: string[]; sampleRows: string[][]; fileId: string }>;
  onImport: (fileId: string, mapping: Record<string, string>) => void;
  isPending?: boolean;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [fileId, setFileId] = useState<string | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [previewRows, setPreviewRows] = useState<string[][]>([]);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setFile(null);
      setFileId(null);
      setHeaders([]);
      setMapping({});
      setPreviewRows([]);
      setPreviewing(false);
      setPreviewError(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }, [open]);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setFileId(null);
    setHeaders([]);
    setMapping({});
    setPreviewRows([]);
    setPreviewError(null);
    setPreviewing(true);

    onPreview(f)
      .then((preview) => {
        setFileId(preview.fileId);
        setHeaders(preview.headers);
        setPreviewRows(preview.sampleRows);
        const autoMap: Record<string, string> = {};
        preview.headers.forEach((header) => {
          autoMap[header] = inferImportTarget(header);
        });
        setMapping(autoMap);
      })
      .catch((error) => {
        setPreviewError(error instanceof Error ? error.message : "Could not preview this file.");
      })
      .finally(() => setPreviewing(false));
  }, [onPreview]);

  return (
    <ModalBackdrop open={open} onClose={onClose} size="xl">
      <CardHeader className="relative">
        <CardTitle>Import Line Items</CardTitle>
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

          {previewing && (
            <div className="rounded-lg border border-line bg-panel2/30 px-3 py-2 text-xs text-fg/50">
              Reading columns...
            </div>
          )}

          {previewError && (
            <div className="rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-xs text-danger">
              {previewError}
            </div>
          )}

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
                            value={mapping[header] ?? "skip"}
                            onValueChange={(v) =>
                              setMapping((prev) => ({ ...prev, [header]: v }))
                            }
                            size="xs"
                            options={BOM_TARGET_COLUMNS.map((col) => ({ value: col.value, label: col.label }))}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Preview */}
          {file && headers.length > 0 && previewRows.length > 0 && (
            <div>
              <p className="text-xs font-medium text-fg/50 mb-2">Preview (first 5 rows)</p>
              <div className="overflow-x-auto border border-line rounded">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-panel2/40">
                      {BOM_TARGET_COLUMNS.filter(c => c.value !== "skip" && Object.values(mapping).includes(c.value)).map(col => (
                        <th key={col.value} className="px-2 py-1 text-left font-medium text-fg/50">{col.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.map((row, i) => (
                      <tr key={i} className="border-t border-line/50">
                        {BOM_TARGET_COLUMNS.filter(c => c.value !== "skip" && Object.values(mapping).includes(c.value)).map(col => {
                          const sourceCol = Object.entries(mapping).find(([_, target]) => target === col.value)?.[0];
                          const colIdx = headers.indexOf(sourceCol ?? "");
                          return <td key={col.value} className="px-2 py-1 text-fg/70">{colIdx >= 0 ? row[colIdx] : "-"}</td>;
                        })}
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
            onClick={() => fileId && onImport(fileId, mapping)}
            disabled={!file || !fileId || previewing || isPending}
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
                  value={selectedDocId || "__none__"}
                  onValueChange={(v) => setSelectedDocId(v === "__none__" ? "" : v)}
                  options={[
                    { value: "__none__", label: "None (generic)" },
                    ...documents.map((doc) => ({ value: doc.id, label: doc.fileName })),
                  ]}
                />
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
  includeReport: boolean;
  selectedDocumentIds: string[];
}

export function PDFModal({
  open,
  onClose,
  onDownload,
  isPending = false,
  documents = [],
  previewUrl,
}: {
  open: boolean;
  onClose: () => void;
  onDownload: (options: PDFDownloadOptions) => void;
  isPending?: boolean;
  documents?: Array<{ id: string; fileName: string }>;
  previewUrl?: string;
}) {
  const [options, setOptions] = useState<PDFDownloadOptions>({
    template: "standard",
    includeLineItems: true,
    includePhases: true,
    includeConditions: true,
    includeCoverPage: true,
    includeLabourSummary: false,
    includeReport: true,
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
        includeReport: true,
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
    <ModalBackdrop open={open} onClose={onClose} size={previewUrl ? "xl" : "md"}>
      <CardHeader className="relative">
        <CardTitle>PDF Preview &amp; Download</CardTitle>
        <ModalClose onClose={onClose} />
      </CardHeader>
      <CardBody>
        {previewUrl && (
          <iframe
            src={previewUrl}
            className="w-full h-96 rounded-lg border border-line bg-white mb-5"
            title="PDF Preview"
          />
        )}
        <div className="space-y-5">
          <div>
            <Label htmlFor="pdf-template">Template</Label>
            <Select
              id="pdf-template"
              value={options.template}
              onValueChange={(v) => setOptions((prev) => ({ ...prev, template: v }))}
              options={[
                { value: "standard", label: "Standard" },
                { value: "detailed", label: "Detailed" },
                { value: "summary", label: "Summary Only" },
                { value: "client", label: "Client Facing" },
              ]}
            />
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
                  ["includeReport", "Report Sections"],
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
