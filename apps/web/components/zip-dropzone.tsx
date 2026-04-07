"use client";

import { useEffect, useRef, useState, useTransition, type DragEvent, type FormEvent } from "react";
import { ChevronDown, FileUp, Loader2, Plus, UploadCloud, X, Check } from "lucide-react";
import { useRouter } from "next/navigation";
import * as RadixSelect from "@radix-ui/react-select";
import type { Customer, ProjectListItem } from "@/lib/api";
import { submitPackageIngest, getCustomers, createCustomer } from "@/lib/api";
import { Badge, Button, Card, CardBody, Input, Label, Textarea } from "@/components/ui";
import { cn } from "@/lib/utils";

/* ── Radix styled select ── */
function StyledSelect({ value, onValueChange, placeholder, children }: {
  value: string;
  onValueChange: (val: string) => void;
  placeholder?: string;
  children: React.ReactNode;
}) {
  return (
    <RadixSelect.Root value={value || undefined} onValueChange={onValueChange}>
      <RadixSelect.Trigger className="inline-flex items-center justify-between gap-1.5 h-9 w-full px-3 text-sm rounded-lg border border-line bg-bg/50 text-fg outline-none hover:border-accent/30 focus:border-accent/50 focus:ring-1 focus:ring-accent/20 transition-colors">
        <RadixSelect.Value placeholder={placeholder ?? "Select..."} />
        <RadixSelect.Icon className="shrink-0">
          <ChevronDown className="h-3 w-3 text-fg/40" />
        </RadixSelect.Icon>
      </RadixSelect.Trigger>
      <RadixSelect.Portal>
        <RadixSelect.Content className="z-[300] rounded-lg border border-line bg-panel shadow-xl min-w-[var(--radix-select-trigger-width)] max-h-[300px]" position="popper" sideOffset={4}>
          <RadixSelect.Viewport className="p-1">
            {children}
          </RadixSelect.Viewport>
        </RadixSelect.Content>
      </RadixSelect.Portal>
    </RadixSelect.Root>
  );
}

function SelectItem({ value, children }: { value: string; children: React.ReactNode }) {
  return (
    <RadixSelect.Item value={value} className="flex items-center gap-2 px-2 py-1.5 text-xs rounded-md outline-none cursor-pointer hover:bg-accent/10 data-[highlighted]:bg-accent/10 data-[state=checked]:text-accent">
      <RadixSelect.ItemIndicator className="shrink-0 w-3"><Check className="h-3 w-3" /></RadixSelect.ItemIndicator>
      <RadixSelect.ItemText>{children}</RadixSelect.ItemText>
    </RadixSelect.Item>
  );
}

type DataTransferItemWithFileSystemHandle = DataTransferItem & {
  getAsFileSystemHandle?: () => Promise<{
    kind?: string;
    getFile?: () => Promise<File>;
  } | null>;
};

interface FileSystemFileEntryLike {
  isFile?: boolean;
  file?: (success: (file: File) => void, error?: (error: unknown) => void) => void;
}

interface DroppedStringData {
  type: string;
  value: string;
}

interface DroppedRemoteFileCandidate {
  url: string;
  type: string;
  suggestedName?: string;
  mimeType?: string;
}

interface ExtractDroppedFilesResult {
  files: File[];
  errorMessage?: string;
}

const REMOTE_DROP_HOST_SUFFIXES = [
  "office.com",
  "office365.com",
  "office.net",
  "outlook.com",
  "live.com",
  "sharepoint.com",
  "microsoft.com",
];

const DROP_STRING_TYPES = [
  "DownloadURL",
  "downloadurl",
  "text/uri-list",
  "text/plain",
  "URL",
  "text/x-moz-url",
  "text/html",
];

const OUTLOOK_ROW_ONLY_PAYLOAD_TYPES = [
  "multimaillistmessagerows",
  "maillistrow",
  "text/x-napi-message",
];

function dropFileKey(file: File) {
  return `${file.name}::${file.size}::${file.lastModified}`;
}

function dedupeDroppedFiles(nextFiles: Iterable<File>) {
  const seen = new Set<string>();
  const uniqueFiles: File[] = [];

  for (const file of nextFiles) {
    const key = dropFileKey(file);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    uniqueFiles.push(file);
  }

  return uniqueFiles;
}

function sanitizeDroppedFileName(fileName: string) {
  return fileName.replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim();
}

function inferredExtensionFromMimeType(mimeType?: string) {
  switch ((mimeType ?? "").toLowerCase()) {
    case "message/rfc822":
      return ".eml";
    case "application/vnd.ms-outlook":
      return ".msg";
    case "application/pdf":
      return ".pdf";
    case "application/zip":
    case "application/x-zip-compressed":
      return ".zip";
    default:
      return "";
  }
}

function ensureDroppedFileName(fileName: string | undefined, mimeType?: string, fallbackBase = "outlook-email") {
  const normalized = sanitizeDroppedFileName(fileName ?? "");
  const fallbackExtension = inferredExtensionFromMimeType(mimeType);

  if (!normalized) {
    return `${fallbackBase}${fallbackExtension}`;
  }

  if (!fallbackExtension || /\.[a-z0-9]{2,8}$/i.test(normalized)) {
    return normalized;
  }

  return `${normalized}${fallbackExtension}`;
}

function looksLikeSupportedDroppedUrl(value: string) {
  try {
    const url = new URL(value);
    return ["http:", "https:", "blob:", "data:"].includes(url.protocol);
  } catch {
    return false;
  }
}

function isAllowedRemoteDropUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol === "blob:" || url.protocol === "data:") {
      return true;
    }
    if (!["http:", "https:"].includes(url.protocol)) {
      return false;
    }
    if (typeof window !== "undefined" && url.origin === window.location.origin) {
      return true;
    }
    const host = url.hostname.toLowerCase();
    return REMOTE_DROP_HOST_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
  } catch {
    return false;
  }
}

function parseDownloadUrlValue(value: string): DroppedRemoteFileCandidate | null {
  const firstColon = value.indexOf(":");
  const secondColon = firstColon >= 0 ? value.indexOf(":", firstColon + 1) : -1;
  if (firstColon <= 0 || secondColon <= firstColon + 1) {
    return null;
  }

  const mimeType = value.slice(0, firstColon).trim();
  const suggestedName = value.slice(firstColon + 1, secondColon).trim();
  const url = value.slice(secondColon + 1).trim();

  if (!looksLikeSupportedDroppedUrl(url)) {
    return null;
  }

  return {
    url,
    type: "downloadurl",
    mimeType,
    suggestedName,
  };
}

function parseUriListValue(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
}

function parseMozUrlValue(value: string) {
  const [url, suggestedName] = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (!url || !looksLikeSupportedDroppedUrl(url)) {
    return null;
  }

  return {
    url,
    type: "text/x-moz-url",
    suggestedName,
  } satisfies DroppedRemoteFileCandidate;
}

function firstHrefFromHtml(value: string) {
  const match = value.match(/href=["']([^"']+)["']/i);
  return match?.[1]?.trim() || null;
}

function droppedPathFileName(value: string) {
  try {
    const url = new URL(value);
    const lastSegment = url.pathname.split("/").filter(Boolean).pop();
    return lastSegment ? decodeURIComponent(lastSegment) : "";
  } catch {
    return "";
  }
}

function contentDispositionFileName(headerValue: string | null) {
  if (!headerValue) {
    return "";
  }

  const encodedMatch = headerValue.match(/filename\*=UTF-8''([^;]+)/i);
  if (encodedMatch?.[1]) {
    try {
      return decodeURIComponent(encodedMatch[1]);
    } catch {
      return encodedMatch[1];
    }
  }

  const plainMatch = headerValue.match(/filename="?([^";]+)"?/i);
  return plainMatch?.[1] ?? "";
}

function readDroppedStringItem(item: DataTransferItem) {
  return new Promise<DroppedStringData | null>((resolve) => {
    try {
      item.getAsString((value) => {
        const trimmed = value.trim();
        resolve(trimmed ? { type: item.type || "text/plain", value: trimmed } : null);
      });
    } catch {
      resolve(null);
    }
  });
}

function readDirectDropStrings(dataTransfer: DataTransfer) {
  const values = new Map<string, string>();
  const types = new Set<string>([
    ...Array.from(dataTransfer.types ?? []),
    ...DROP_STRING_TYPES,
  ]);

  for (const type of types) {
    try {
      const value = dataTransfer.getData(type);
      const trimmed = value.trim();
      if (trimmed) {
        values.set(type.toLowerCase(), trimmed);
      }
    } catch {
      // Some browsers throw for unsupported external drag types.
    }
  }

  return values;
}

function buildRemoteFileCandidates(stringValues: Map<string, string>) {
  const candidates: DroppedRemoteFileCandidate[] = [];
  const seen = new Set<string>();

  function pushCandidate(candidate: DroppedRemoteFileCandidate | null) {
    if (!candidate || !candidate.url) {
      return;
    }

    const key = `${candidate.type}::${candidate.url}::${candidate.suggestedName ?? ""}::${candidate.mimeType ?? ""}`;
    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    candidates.push(candidate);
  }

  pushCandidate(parseDownloadUrlValue(stringValues.get("downloadurl") ?? ""));
  pushCandidate(parseMozUrlValue(stringValues.get("text/x-moz-url") ?? ""));

  for (const url of parseUriListValue(stringValues.get("text/uri-list") ?? "")) {
    if (looksLikeSupportedDroppedUrl(url)) {
      pushCandidate({ url, type: "text/uri-list" });
    }
  }

  const plainText = stringValues.get("text/plain") ?? stringValues.get("url") ?? "";
  if (looksLikeSupportedDroppedUrl(plainText)) {
    pushCandidate({ url: plainText, type: "text/plain" });
  }

  const htmlHref = firstHrefFromHtml(stringValues.get("text/html") ?? "");
  if (htmlHref && looksLikeSupportedDroppedUrl(htmlHref)) {
    pushCandidate({ url: htmlHref, type: "text/html" });
  }

  return candidates;
}

async function fetchDroppedRemoteFile(candidate: DroppedRemoteFileCandidate) {
  if (!isAllowedRemoteDropUrl(candidate.url)) {
    return null;
  }

  const response = await fetch(candidate.url, {
    credentials: "include",
    cache: "no-store",
  });

  if (!response.ok) {
    return null;
  }

  const blob = await response.blob();
  if (!blob.size) {
    return null;
  }

  const mimeType = blob.type || candidate.mimeType || "application/octet-stream";
  const fileName = ensureDroppedFileName(
    candidate.suggestedName ||
      contentDispositionFileName(response.headers.get("content-disposition")) ||
      droppedPathFileName(candidate.url),
    mimeType
  );

  return new File([blob], fileName, {
    type: mimeType,
    lastModified: Date.now(),
  });
}

function describePayloadTypes(payloadTypes: Set<string>) {
  return Array.from(payloadTypes).sort().join(", ");
}

function readEntryFile(item: DataTransferItem) {
  const entry = item.webkitGetAsEntry?.() as FileSystemFileEntryLike | null | undefined;
  if (!entry?.isFile || typeof entry.file !== "function") {
    return null;
  }

  return new Promise<File | null>((resolve) => {
    entry.file?.(
      (file) => resolve(file),
      () => resolve(null)
    );
  });
}

async function extractDroppedFiles(dataTransfer: DataTransfer): Promise<ExtractDroppedFilesResult> {
  const directFiles = Array.from(dataTransfer.files ?? []).filter((file) => file instanceof File);
  const items = Array.from(dataTransfer.items ?? []);
  const payloadTypes = new Set<string>(Array.from(dataTransfer.types ?? []).map((type) => type.toLowerCase()));

  if (!items.length) {
    const files = dedupeDroppedFiles(directFiles);
    return files.length > 0
      ? { files }
      : { files: [], errorMessage: "The dropped item did not expose any readable files." };
  }

  const extractedFiles = [...directFiles];
  const asyncFileReads: Promise<File | null>[] = [];
  const asyncStringReads: Promise<DroppedStringData | null>[] = [];
  const directStringValues = readDirectDropStrings(dataTransfer);

  for (const rawItem of items) {
    const item = rawItem as DataTransferItemWithFileSystemHandle;
    payloadTypes.add(item.type.toLowerCase());

    if (item.kind === "file") {
      const file = item.getAsFile();
      if (file) {
        extractedFiles.push(file);
        continue;
      }

      if (typeof item.getAsFileSystemHandle === "function") {
        asyncFileReads.push(
          item.getAsFileSystemHandle()
            .then(async (handle) => {
              if (handle?.kind !== "file" || typeof handle.getFile !== "function") {
                return null;
              }
              return handle.getFile();
            })
            .catch(() => null)
        );
      }

      const entryRead = readEntryFile(item);
      if (entryRead) {
        asyncFileReads.push(entryRead);
      }

      continue;
    }

    if (item.kind === "string") {
      asyncStringReads.push(readDroppedStringItem(item));
    }
  }

  const resolvedFiles = (await Promise.all(asyncFileReads)).filter((file): file is File => file instanceof File);
  const files = dedupeDroppedFiles([...extractedFiles, ...resolvedFiles]);
  if (files.length > 0) {
    return { files };
  }

  const resolvedStrings = (await Promise.all(asyncStringReads)).filter((entry): entry is DroppedStringData => Boolean(entry));
  for (const entry of resolvedStrings) {
    payloadTypes.add(entry.type.toLowerCase());
    directStringValues.set(entry.type.toLowerCase(), entry.value);
  }

  const remoteCandidates = buildRemoteFileCandidates(directStringValues);
  const fetchedFiles = (
    await Promise.all(
      remoteCandidates.map((candidate) =>
        fetchDroppedRemoteFile(candidate).catch(() => null)
      )
    )
  ).filter((file): file is File => file instanceof File);

  const remoteFiles = dedupeDroppedFiles(fetchedFiles);
  if (remoteFiles.length > 0) {
    return { files: remoteFiles };
  }

  const payloadLabel = describePayloadTypes(payloadTypes);
  if (OUTLOOK_ROW_ONLY_PAYLOAD_TYPES.some((type) => payloadTypes.has(type))) {
    return {
      files: [],
      errorMessage: `New Outlook inbox-list drags use Outlook-only payloads (${payloadLabel}) and do not expose an email file to normal websites. Drag the attachment itself, try dragging from an opened message if Outlook exposes it there, save as .eml, or use classic Outlook.`,
    };
  }

  if (remoteCandidates.length > 0) {
    return {
      files: [],
      errorMessage: `New Outlook exposed web-link drag data (${payloadLabel}), but the browser could not turn it into a downloadable email file. Save the message as .eml and upload it, drag the attachment itself, or use classic Outlook.`,
    };
  }

  if (directStringValues.size > 0) {
    return {
      files: [],
      errorMessage: `New Outlook exposed non-file drag data (${payloadLabel}), not a real email file. Save the message as .eml and upload it, drag the attachment itself, or use classic Outlook.`,
    };
  }

  return {
    files: [],
    errorMessage: "The dropped item did not expose any readable files.",
  };
}

export function ZipDropzone({ projects }: { projects: ProjectListItem[] }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [projectId, setProjectId] = useState("");
  const [packageName, setPackageName] = useState("Client package");
  const [customerId, setCustomerId] = useState("");
  const [customerOptions, setCustomerOptions] = useState<Customer[]>([]);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [quickAddName, setQuickAddName] = useState("");
  const [quickAddSaving, setQuickAddSaving] = useState(false);
  const [location, setLocation] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [scope, setScope] = useState("");
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    getCustomers().then(setCustomerOptions).catch(() => {});
  }, []);

  async function handleQuickAdd() {
    if (!quickAddName.trim()) return;
    setQuickAddSaving(true);
    try {
      const created = await createCustomer({ name: quickAddName.trim(), active: true });
      setCustomerOptions((prev) => [...prev, created]);
      setCustomerId(created.id);
      setQuickAddName("");
      setQuickAddOpen(false);
    } catch {
      /* ignore */
    } finally {
      setQuickAddSaving(false);
    }
  }

  function clearFiles() {
    setFiles([]);
    setError(null);
    setStatus(null);
    if (inputRef.current) {
      inputRef.current.value = "";
    }
  }

  function handleFiles(nextFiles: File[] | FileList | null) {
    const selectedFiles = Array.from(nextFiles ?? []).filter((candidate) => candidate instanceof File);
    if (!selectedFiles.length) return;
    setError(null);
    setStatus(null);
    setFiles(selectedFiles);
  }

  async function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragActive(false);

    const { files: droppedFiles, errorMessage } = await extractDroppedFiles(event.dataTransfer);

    if (droppedFiles.length > 0) {
      handleFiles(droppedFiles);
      return;
    }

    setStatus(null);
    setError(errorMessage ?? "The dropped item did not expose any readable files.");
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!files.length) {
      setError("Select at least one package file.");
      return;
    }

    setError(null);
    setStatus(null);

    startTransition(async () => {
      try {
        const result = await submitPackageIngest({
          files,
          projectId: projectId || undefined,
          packageName,
          clientName: customerOptions.find((c) => c.id === customerId)?.name || undefined,
          customerId: customerId || undefined,
          location: location || undefined,
          dueDate: dueDate || undefined,
          scope: scope || undefined,
          notes: notes || undefined,
        });

        const nextProjectId =
          (result as { projectId?: string }).projectId ??
          (result as { project?: { id?: string } }).project?.id ??
          (result as { workspace?: { project?: { id?: string } } }).workspace?.project?.id ??
          projectId;

        setStatus(
          files.length === 1
            ? "Package uploaded successfully."
            : `${files.length} files uploaded successfully.`
        );

        if (nextProjectId) {
          router.push(`/projects/${nextProjectId}?tab=estimate&intake=true`);
        }
      } catch (submissionError) {
        setError(submissionError instanceof Error ? submissionError.message : "Upload failed.");
        setStatus(null);
      }
    });
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        {/* Drop zone */}
        <div
          className={cn(
            "relative flex flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-12 transition-colors",
            dragActive
              ? "border-accent bg-accent/5"
              : files.length > 0
                ? "border-success/30 bg-success/5"
                : "border-line bg-panel2/30 hover:border-fg/20"
          )}
          onDragEnter={(e) => { e.preventDefault(); setDragActive(true); }}
          onDragOver={(e) => { e.preventDefault(); setDragActive(true); e.dataTransfer.dropEffect = "copy"; }}
          onDragLeave={() => setDragActive(false)}
          onDrop={(e) => { void handleDrop(e); }}
        >
          {files.length > 0 ? (
            <div className="w-full max-w-2xl">
              <div className="flex items-start gap-3">
                <FileUp className="mt-0.5 h-5 w-5 shrink-0 text-success" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="text-sm font-medium">
                      {files.length === 1 ? files[0].name : `${files.length} files selected`}
                    </div>
                    <Badge tone="success">
                      {files.length === 1 ? "Single file" : `${files.length} files`}
                    </Badge>
                  </div>
                  <div className="mt-1 text-xs text-fg/40">
                    {(files.reduce((sum, current) => sum + current.size, 0) / 1024 / 1024).toFixed(1)} MB total
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {files.slice(0, 8).map((selectedFile) => (
                      <Badge key={`${selectedFile.name}-${selectedFile.size}-${selectedFile.lastModified}`}>
                        {selectedFile.name}
                      </Badge>
                    ))}
                    {files.length > 8 ? <Badge>+{files.length - 8} more</Badge> : null}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={clearFiles}
                  className="ml-2 rounded p-1 text-fg/30 hover:bg-panel2 hover:text-fg/60"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
          ) : (
            <>
              <UploadCloud className="h-8 w-8 text-fg/20" />
              <p className="mt-3 text-sm text-fg/50">
                Drop a ZIP, loose bid files, or an Outlook email (.msg or .eml) here or{" "}
                <button
                  type="button"
                  className="text-accent hover:underline"
                  onClick={() => inputRef.current?.click()}
                >
                  browse
                </button>
              </p>
              <p className="mt-2 text-center text-xs text-fg/35">
                Multiple files supported. PDF, XLSX, DWG, DXF, DOCX, ZIP, and Outlook .msg/.eml all work.
              </p>
            </>
          )}
          <input
            ref={inputRef}
            className="hidden"
            type="file"
            accept=".zip,.pdf,.xlsx,.xls,.csv,.doc,.docx,.txt,.png,.jpg,.jpeg,.dwg,.dxf,.msg,.eml,application/zip,application/vnd.ms-outlook,message/rfc822"
            multiple
            onChange={(e) => handleFiles(e.target.files)}
          />
        </div>

        {/* Form fields */}
        <div className="space-y-3">
          <div>
            <Label>Destination</Label>
            <StyledSelect value={projectId || "__new__"} onValueChange={(v) => setProjectId(v === "__new__" ? "" : v)} placeholder="New project">
              <SelectItem value="__new__">New project</SelectItem>
              {projects.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}{(p as any).quote ? ` (${(p as any).quote.quoteNumber})` : ""}
                </SelectItem>
              ))}
            </StyledSelect>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>Project name</Label>
              <Input value={packageName} onChange={(e) => setPackageName(e.target.value)} placeholder="e.g. Soprema Tillsonburg" />
            </div>
            <div>
              <Label>Client</Label>
              {quickAddOpen ? (
                <div className="flex gap-1.5">
                  <Input
                    placeholder="New client name"
                    value={quickAddName}
                    onChange={(e) => setQuickAddName(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), handleQuickAdd())}
                    autoFocus
                  />
                  <Button type="button" size="xs" variant="accent" onClick={handleQuickAdd} disabled={quickAddSaving || !quickAddName.trim()}>
                    {quickAddSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                  </Button>
                  <Button type="button" size="xs" variant="secondary" onClick={() => { setQuickAddOpen(false); setQuickAddName(""); }}>
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              ) : (
                <div className="flex gap-1.5">
                  <div className="flex-1">
                    <StyledSelect value={customerId} onValueChange={setCustomerId} placeholder="Select client...">
                      {customerOptions.filter((c) => c.active).map((c) => (
                        <SelectItem key={c.id} value={c.id}>{c.name}{c.shortName ? ` (${c.shortName})` : ""}</SelectItem>
                      ))}
                    </StyledSelect>
                  </div>
                  <Button type="button" size="xs" variant="secondary" onClick={() => setQuickAddOpen(true)} title="Add new client">
                    <Plus className="h-3 w-3" />
                  </Button>
                </div>
              )}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>Location</Label>
              <Input placeholder="City, State" value={location} onChange={(e) => setLocation(e.target.value)} />
            </div>
            <div>
              <Label>Bid due</Label>
              <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
          </div>

          <div>
            <Label>Scope</Label>
            <Textarea
              placeholder="What portion of this bid to estimate (e.g. 'Electrical only', 'HVAC for Building B'). Leave blank for full scope."
              value={scope}
              onChange={(e) => setScope(e.target.value)}
              className="min-h-16"
            />
          </div>

          <div>
            <Label>Notes</Label>
            <Textarea placeholder="Optional notes" value={notes} onChange={(e) => setNotes(e.target.value)} className="min-h-16" />
          </div>

          <Button className="w-full" type="submit" disabled={isPending || files.length === 0}>
            {isPending ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Uploading...
              </>
            ) : (
              "Submit package"
            )}
          </Button>

          {status && (
            <div className="rounded-lg border border-success/20 bg-success/5 px-3 py-2 text-xs text-success">{status}</div>
          )}
          {error && (
            <div className="rounded-lg border border-danger/20 bg-danger/5 px-3 py-2 text-xs text-danger">{error}</div>
          )}
        </div>
      </div>
    </form>
  );
}
