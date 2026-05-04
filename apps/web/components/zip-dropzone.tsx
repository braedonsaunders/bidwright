"use client";

import { useEffect, useRef, useState, useTransition, type DragEvent, type FormEvent, type InputHTMLAttributes } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowRight,
  CalendarClock,
  Check,
  CheckCircle2,
  ChevronDown,
  FileText,
  FileUp,
  FolderOpen,
  Loader2,
  Mail,
  MapPin,
  Plus,
  Sparkles,
  Target,
  UploadCloud,
  X,
  Zap,
} from "lucide-react";
import { useRouter } from "next/navigation";
import * as RadixSelect from "@radix-ui/react-select";
import type { Customer, EstimatorPersona, PackageIngestFile, ProjectListItem } from "@/lib/api";
import { submitPackageIngest, getCustomers, createCustomer, listPersonas } from "@/lib/api";
import { Badge, Button, Input, Label, Textarea } from "@/components/ui";
import { SearchablePicker } from "@/components/shared/searchable-picker";
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

function mergeCustomers(existing: Customer[], incoming: Customer[]): Customer[] {
  const merged = new Map(existing.map((customer) => [customer.id, customer]));
  for (const customer of incoming) {
    merged.set(customer.id, customer);
  }
  return [...merged.values()].sort((left, right) => left.name.localeCompare(right.name));
}

type DataTransferItemWithFileSystemHandle = DataTransferItem & {
  getAsFileSystemHandle?: () => Promise<{
    kind?: string;
    name?: string;
    entries?: () => AsyncIterable<[string, FileSystemHandleLike]>;
    getFile?: () => Promise<File>;
  } | null>;
};

type FileSystemHandleLike = {
  kind?: string;
  name?: string;
  entries?: () => AsyncIterable<[string, FileSystemHandleLike]>;
  getFile?: () => Promise<File>;
};

interface FileSystemEntryReaderLike {
  readEntries?: (
    success: (entries: FileSystemEntryLike[]) => void,
    error?: (error: unknown) => void
  ) => void;
}

interface FileSystemEntryLike {
  isFile?: boolean;
  isDirectory?: boolean;
  name?: string;
  file?: (success: (file: File) => void, error?: (error: unknown) => void) => void;
  createReader?: () => FileSystemEntryReaderLike;
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
  files: SelectedUploadFile[];
  errorMessage?: string;
}

interface SelectedUploadFile extends PackageIngestFile {
  relativePath: string;
}

type DirectoryInputProps = InputHTMLAttributes<HTMLInputElement> & {
  webkitdirectory?: string;
  directory?: string;
};

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

function dropFileKey(entry: SelectedUploadFile) {
  return `${entry.relativePath.toLowerCase()}::${entry.file.size}::${entry.file.lastModified}`;
}

function normalizeDroppedRelativePath(relativePath: string | undefined, fallbackFileName: string) {
  const safeSegments = (relativePath ?? "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .split("/")
    .map((segment) => sanitizeDroppedFileName(segment))
    .filter((segment) => segment && segment !== "." && segment !== "..");

  if (safeSegments.length > 0) {
    return safeSegments.join("/");
  }

  return sanitizeDroppedFileName(fallbackFileName) || "file";
}

function toSelectedUploadFile(file: File, relativePath?: string): SelectedUploadFile {
  const webkitRelativePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
  return {
    file,
    relativePath: normalizeDroppedRelativePath(relativePath || webkitRelativePath || file.name, file.name),
  };
}

function dedupeDroppedFiles(nextFiles: Iterable<SelectedUploadFile>) {
  const seen = new Set<string>();
  const uniqueFiles: SelectedUploadFile[] = [];

  for (const entry of nextFiles) {
    const key = dropFileKey(entry);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    uniqueFiles.push(entry);
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

function readEntryFile(entry: FileSystemEntryLike) {
  if (!entry?.isFile || typeof entry.file !== "function") {
    return Promise.resolve(null);
  }

  return new Promise<File | null>((resolve) => {
    entry.file?.(
      (file) => resolve(file),
      () => resolve(null)
    );
  });
}

function readEntryDirectory(reader: FileSystemEntryReaderLike) {
  return new Promise<FileSystemEntryLike[]>((resolve) => {
    reader.readEntries?.(
      (entries) => resolve(entries ?? []),
      () => resolve([])
    );
  });
}

async function readFileSystemEntry(entry: FileSystemEntryLike, prefix: string[] = []): Promise<SelectedUploadFile[]> {
  if (entry.isFile) {
    const file = await readEntryFile(entry);
    if (!file) {
      return [];
    }

    const entryName = sanitizeDroppedFileName(entry.name || file.name) || file.name;
    return [toSelectedUploadFile(file, [...prefix, entryName].join("/"))];
  }

  if (!entry.isDirectory) {
    return [];
  }

  const reader = entry.createReader?.();
  if (!reader) {
    return [];
  }

  const nextPrefix = [...prefix, sanitizeDroppedFileName(entry.name || "folder") || "folder"];
  const files: SelectedUploadFile[] = [];
  while (true) {
    const batch = await readEntryDirectory(reader);
    if (batch.length === 0) {
      break;
    }

    for (const child of batch) {
      files.push(...await readFileSystemEntry(child, nextPrefix));
    }
  }

  return files;
}

async function readFileSystemHandle(handle: FileSystemHandleLike | null, prefix: string[] = []): Promise<SelectedUploadFile[]> {
  if (!handle?.kind) {
    return [];
  }

  if (handle.kind === "file" && typeof handle.getFile === "function") {
    const file = await handle.getFile().catch(() => null);
    if (!file) {
      return [];
    }

    const handleName = sanitizeDroppedFileName(handle.name || file.name) || file.name;
    return [toSelectedUploadFile(file, [...prefix, handleName].join("/"))];
  }

  if (handle.kind !== "directory" || typeof handle.entries !== "function") {
    return [];
  }

  const directoryName = sanitizeDroppedFileName(handle.name || "folder") || "folder";
  const nextPrefix = [...prefix, directoryName];
  const files: SelectedUploadFile[] = [];

  for await (const [, childHandle] of handle.entries()) {
    files.push(...await readFileSystemHandle(childHandle, nextPrefix));
  }

  return files;
}

async function extractDroppedFiles(dataTransfer: DataTransfer): Promise<ExtractDroppedFilesResult> {
  const items = Array.from(dataTransfer.items ?? []);
  const payloadTypes = new Set<string>(Array.from(dataTransfer.types ?? []).map((type) => type.toLowerCase()));

  if (!items.length) {
    const files = dedupeDroppedFiles(
      Array.from(dataTransfer.files ?? [])
        .filter((file) => file instanceof File)
        .map((file) => toSelectedUploadFile(file))
    );
    return files.length > 0
      ? { files }
      : { files: [], errorMessage: "The dropped item did not expose any readable files." };
  }

  const extractedFiles: SelectedUploadFile[] = [];
  const asyncFileReads: Promise<SelectedUploadFile[]>[] = [];
  const asyncStringReads: Promise<DroppedStringData | null>[] = [];
  const directStringValues = readDirectDropStrings(dataTransfer);

  for (const rawItem of items) {
    const item = rawItem as DataTransferItemWithFileSystemHandle;
    payloadTypes.add(item.type.toLowerCase());

    if (item.kind === "file") {
      if (typeof item.getAsFileSystemHandle === "function") {
        asyncFileReads.push(
          item.getAsFileSystemHandle()
            .then((handle) => readFileSystemHandle(handle))
            .catch(() => [])
        );
        continue;
      }

      const entry = item.webkitGetAsEntry?.() as FileSystemEntryLike | null | undefined;
      if (entry) {
        asyncFileReads.push(readFileSystemEntry(entry).catch(() => []));
        continue;
      }

      const file = item.getAsFile();
      if (file) {
        extractedFiles.push(toSelectedUploadFile(file));
      }

      continue;
    }

    if (item.kind === "string") {
      asyncStringReads.push(readDroppedStringItem(item));
    }
  }

  const resolvedFiles = (await Promise.all(asyncFileReads)).flat();
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
  )
    .filter((file): file is File => file instanceof File)
    .map((file) => toSelectedUploadFile(file));

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
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [files, setFiles] = useState<SelectedUploadFile[]>([]);
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
  const [personas, setPersonas] = useState<EstimatorPersona[]>([]);
  const [personaId, setPersonaId] = useState<string>("");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const customerIdRef = useRef(customerId);
  const customerOptionsRef = useRef<Customer[]>(customerOptions);

  customerIdRef.current = customerId;
  customerOptionsRef.current = customerOptions;

  useEffect(() => {
    getCustomers()
      .then((loadedCustomers) => {
        setCustomerOptions((prev) => mergeCustomers(prev, loadedCustomers));
      })
      .catch(() => {});
    listPersonas()
      .then((loaded) => {
        const enabled = loaded
          .filter((persona) => persona.enabled !== false)
          .sort((left, right) => left.order - right.order);
        setPersonas(enabled);
      })
      .catch(() => {});
  }, []);

  async function handleQuickAdd() {
    if (!quickAddName.trim()) return;
    setError(null);
    setQuickAddSaving(true);
    try {
      const created = await createCustomer({ name: quickAddName.trim(), active: true });
      const nextCustomerOptions = mergeCustomers(customerOptionsRef.current, [created]);
      customerOptionsRef.current = nextCustomerOptions;
      customerIdRef.current = created.id;
      setCustomerOptions(nextCustomerOptions);
      setCustomerId(created.id);
      setQuickAddName("");
      setQuickAddOpen(false);
    } catch (quickAddError) {
      setError(quickAddError instanceof Error ? quickAddError.message : "Failed to create client.");
    } finally {
      setQuickAddSaving(false);
    }
  }

  function clearFiles() {
    setFiles([]);
    setError(null);
    setStatus(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
    if (folderInputRef.current) {
      folderInputRef.current.value = "";
    }
  }

  function handleFiles(nextFiles: SelectedUploadFile[] | FileList | null, options?: { append?: boolean }) {
    const selectedFiles = Array.isArray(nextFiles)
      ? nextFiles
      : Array.from(nextFiles ?? [])
          .filter((candidate) => candidate instanceof File)
          .map((candidate) => toSelectedUploadFile(candidate));
    if (!selectedFiles.length) return;
    setError(null);
    setStatus(null);
    setFiles((previousFiles) =>
      dedupeDroppedFiles(options?.append ? [...previousFiles, ...selectedFiles] : selectedFiles)
    );
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
        const selectedCustomer =
          customerOptionsRef.current.find((customer) => customer.id === customerIdRef.current) ?? null;
        const result = await submitPackageIngest({
          files,
          projectId: projectId || undefined,
          packageName,
          clientName: selectedCustomer?.name || undefined,
          customerId: customerIdRef.current || undefined,
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
          const personaParam = personaId ? `&persona=${encodeURIComponent(personaId)}` : "";
          router.push(`/projects/${nextProjectId}?tab=estimate&intake=true${personaParam}`);
        }
      } catch (submissionError) {
        setError(submissionError instanceof Error ? submissionError.message : "Upload failed.");
        setStatus(null);
      }
    });
  }

  const totalBytes = files.reduce((sum, current) => sum + current.file.size, 0);
  const totalSizeLabel = totalBytes > 0
    ? totalBytes >= 1024 * 1024
      ? `${(totalBytes / 1024 / 1024).toFixed(1)} MB`
      : `${Math.max(1, Math.round(totalBytes / 1024))} KB`
    : "0 MB";
  const selectedPersona = personas.find((persona) => persona.id === personaId) ?? null;
  const intakeState = isPending ? "Uploading" : files.length ? "Package loaded" : dragActive ? "Release" : "Waiting";

  return (
    <form className="flex min-h-0 w-full flex-1" onSubmit={handleSubmit}>
      <div className="grid min-h-0 w-full gap-4 lg:grid-cols-[minmax(0,1.06fr)_minmax(340px,0.82fr)]">
        <motion.div
          className="relative flex min-h-[390px] flex-col overflow-hidden rounded-lg border border-line/70 bg-panel/90 shadow-sm backdrop-blur-xl lg:min-h-0"
          animate={{
            borderColor: dragActive
              ? "hsl(var(--accent))"
              : files.length > 0
                ? "hsl(152 50% 44% / 0.5)"
                : "hsl(var(--fg) / 0.12)",
            scale: dragActive ? 1.006 : 1,
          }}
          transition={{ duration: 0.18, ease: "easeOut" }}
          onDragEnter={(e) => { e.preventDefault(); setDragActive(true); }}
          onDragOver={(e) => { e.preventDefault(); setDragActive(true); e.dataTransfer.dropEffect = "copy"; }}
          onDragLeave={() => setDragActive(false)}
          onDrop={(e) => { void handleDrop(e); }}
        >
          <motion.div
            aria-hidden
            className="absolute inset-0 opacity-45 [background-image:linear-gradient(hsl(var(--fg)/0.08)_1px,transparent_1px),linear-gradient(90deg,hsl(var(--fg)/0.06)_1px,transparent_1px)] [background-size:30px_30px]"
            animate={{ backgroundPosition: ["0px 0px", "60px 60px"] }}
            transition={{ duration: 18, repeat: Infinity, ease: "linear" }}
          />
          <motion.div
            aria-hidden
            className="absolute inset-x-0 top-[18%] h-px bg-[linear-gradient(90deg,transparent,hsl(var(--accent)),hsl(169_62%_44%),transparent)]"
            animate={{ top: dragActive ? ["10%", "90%"] : ["18%", "78%", "18%"], opacity: dragActive ? [0.72, 0.35] : [0.24, 0.6, 0.24] }}
            transition={{ duration: dragActive ? 0.9 : 6.5, repeat: Infinity, ease: "easeInOut" }}
          />
          <div className="relative z-10 flex items-center justify-between border-b border-line/70 px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/15 text-accent">
                  <Sparkles className="h-4 w-4" />
                </span>
                <div>
                  <div className="text-sm font-semibold text-fg">Intake package</div>
                  <div className="text-xs text-fg/45">{totalSizeLabel} loaded</div>
                </div>
              </div>
              <Badge tone={files.length ? "success" : "info"}>{intakeState}</Badge>
            </div>

          <div className="relative z-10 flex min-h-0 flex-1 items-center justify-center p-5">
              <motion.svg
                aria-hidden
                className="pointer-events-none absolute inset-4 h-[calc(100%-2rem)] w-[calc(100%-2rem)] opacity-70"
                viewBox="0 0 680 430"
                preserveAspectRatio="none"
              >
                <defs>
                  <linearGradient id="drop-pane-energy" x1="0" x2="1" y1="0" y2="1">
                    <stop stopColor="hsl(var(--accent) / 0.02)" />
                    <stop offset="0.52" stopColor="hsl(169 62% 45% / 0.28)" />
                    <stop offset="1" stopColor="hsl(214 84% 56% / 0.04)" />
                  </linearGradient>
                  <linearGradient id="drop-pane-line" x1="0" x2="1" y1="0" y2="0">
                    <stop stopColor="hsl(var(--accent) / 0)" />
                    <stop offset="0.35" stopColor="hsl(var(--accent) / 0.52)" />
                    <stop offset="0.7" stopColor="hsl(169 62% 45% / 0.42)" />
                    <stop offset="1" stopColor="hsl(214 84% 56% / 0)" />
                  </linearGradient>
                </defs>
                <path d="M36 314 C138 236 210 250 302 182 C402 108 490 122 640 52" fill="none" stroke="url(#drop-pane-line)" strokeWidth="1.4" strokeDasharray="10 18" />
                <path d="M50 95 C176 126 220 72 324 118 C446 172 482 288 634 308" fill="none" stroke="url(#drop-pane-line)" strokeWidth="1.2" strokeDasharray="6 20" />
                <path d="M86 350 L198 254 L332 298 L474 164 L612 202" fill="none" stroke="hsl(var(--fg) / 0.1)" strokeWidth="1" />
                <motion.path
                  d="M36 314 C138 236 210 250 302 182 C402 108 490 122 640 52"
                  fill="none"
                  stroke="url(#drop-pane-line)"
                  strokeLinecap="round"
                  strokeWidth="3"
                  strokeDasharray="42 240"
                  animate={{ strokeDashoffset: [0, -520] }}
                  transition={{ duration: 4.8, repeat: Infinity, ease: "linear" }}
                />
                <motion.path
                  d="M50 95 C176 126 220 72 324 118 C446 172 482 288 634 308"
                  fill="none"
                  stroke="url(#drop-pane-line)"
                  strokeLinecap="round"
                  strokeWidth="2.4"
                  strokeDasharray="34 220"
                  animate={{ strokeDashoffset: [0, -460] }}
                  transition={{ duration: 5.7, repeat: Infinity, ease: "linear" }}
                />
                {[110, 218, 342, 468, 578].map((x, index) => (
                  <motion.rect
                    key={x}
                    x={x}
                    y={index % 2 === 0 ? 86 : 286}
                    width="54"
                    height="34"
                    rx="8"
                    fill="url(#drop-pane-energy)"
                    stroke="hsl(var(--fg) / 0.1)"
                    animate={{ y: [index % 2 === 0 ? 86 : 286, index % 2 === 0 ? 96 : 276, index % 2 === 0 ? 86 : 286] }}
                    transition={{ duration: 4 + index * 0.35, repeat: Infinity, ease: "easeInOut" }}
                  />
                ))}
              </motion.svg>
              <AnimatePresence mode="wait">
                {files.length > 0 ? (
                  <motion.div
                    key="selected"
                    initial={{ opacity: 0, y: 14, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -8, scale: 0.98 }}
                    transition={{ duration: 0.25, ease: "easeOut" }}
                    className="w-full max-w-2xl"
                  >
                    <div className="flex flex-col items-center text-center">
                      <motion.div
                        className="relative flex h-24 w-24 items-center justify-center rounded-lg border border-success/30 bg-success/10 text-success shadow-sm"
                        animate={{ y: [0, -4, 0] }}
                        transition={{ duration: 3.2, repeat: Infinity, ease: "easeInOut" }}
                      >
                        <CheckCircle2 className="h-10 w-10" />
                        <motion.span
                          className="absolute inset-x-3 bottom-3 h-1 rounded-full bg-success/35"
                          animate={{ scaleX: [0.35, 1, 0.35] }}
                          transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
                        />
                      </motion.div>
                      <h2 className="mt-5 max-w-xl text-2xl font-semibold leading-tight text-fg">
                        {files.length === 1 ? files[0].relativePath : `${files.length} package files captured`}
                      </h2>
                      <p className="mt-2 text-sm text-fg/50">{totalSizeLabel} total</p>
                      <div className="mt-5 flex max-h-28 flex-wrap justify-center gap-1.5 overflow-hidden">
                        {files.slice(0, 10).map((selectedFile) => (
                          <Badge key={`${selectedFile.relativePath}-${selectedFile.file.size}-${selectedFile.file.lastModified}`} className="max-w-[220px] truncate">
                            {selectedFile.relativePath}
                          </Badge>
                        ))}
                        {files.length > 10 ? <Badge>+{files.length - 10} more</Badge> : null}
                      </div>
                      <button
                        type="button"
                        onClick={clearFiles}
                        className="mt-5 inline-flex items-center gap-1.5 rounded-lg border border-line bg-bg/70 px-3 py-2 text-xs font-medium text-fg/60 transition-colors hover:border-danger/30 hover:bg-danger/10 hover:text-danger"
                      >
                        <X className="h-3.5 w-3.5" />
                        Clear package
                      </button>
                    </div>
                  </motion.div>
                ) : (
                  <motion.div
                    key="empty"
                    initial={{ opacity: 0, y: 14, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -8, scale: 0.98 }}
                    transition={{ duration: 0.25, ease: "easeOut" }}
                    className="flex max-w-2xl flex-col items-center text-center"
                  >
                    <motion.div
                      className={cn(
                        "relative flex h-28 w-28 items-center justify-center rounded-lg border bg-bg/75 shadow-sm",
                        dragActive ? "border-accent text-accent" : "border-line/80 text-fg/35",
                      )}
                      animate={{ y: dragActive ? [0, -8, 0] : [0, -5, 0], scale: dragActive ? [1, 1.05, 1] : 1 }}
                      transition={{ duration: dragActive ? 0.9 : 3.3, repeat: Infinity, ease: "easeInOut" }}
                    >
                      <UploadCloud className="h-11 w-11" />
                      <motion.span
                        className="absolute inset-x-5 bottom-5 h-1 rounded-full bg-accent/35"
                        animate={{ scaleX: dragActive ? [0.4, 1, 0.4] : [0.2, 0.75, 0.2], opacity: [0.25, 0.75, 0.25] }}
                        transition={{ duration: 1.7, repeat: Infinity, ease: "easeInOut" }}
                      />
                    </motion.div>
                    <h2 className="mt-6 text-3xl font-semibold leading-tight text-fg">
                      {dragActive ? "Release to attach package" : "Drop files or folder"}
                    </h2>
                    <p className="mt-3 max-w-lg text-sm leading-6 text-fg/55">
                      Upload drawings, specifications, spreadsheets, addenda, images, ZIP archives, and Outlook messages.
                    </p>
                    <div className="mt-6 flex flex-wrap justify-center gap-2">
                      <button
                        type="button"
                        className="inline-flex h-10 items-center gap-2 rounded-lg border border-line bg-panel px-3 text-sm font-medium text-fg/70 transition-colors hover:border-accent/40 hover:text-fg"
                        onClick={() => fileInputRef.current?.click()}
                      >
                        <FileText className="h-4 w-4 text-accent" />
                        Select files
                      </button>
                      <button
                        type="button"
                        className="inline-flex h-10 items-center gap-2 rounded-lg border border-line bg-panel px-3 text-sm font-medium text-fg/70 transition-colors hover:border-accent/40 hover:text-fg"
                        onClick={() => folderInputRef.current?.click()}
                      >
                        <FolderOpen className="h-4 w-4 text-accent" />
                        Select folder
                      </button>
                      <span className="inline-flex h-10 items-center gap-2 rounded-lg border border-line/70 bg-bg/45 px-3 text-sm font-medium text-fg/45">
                        <Mail className="h-4 w-4" />
                        .msg and .eml
                      </span>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
          </div>

          <input
            ref={fileInputRef}
            className="hidden"
            type="file"
            accept=".zip,.pdf,.xlsx,.xls,.csv,.doc,.docx,.txt,.png,.jpg,.jpeg,.dwg,.dxf,.msg,.eml,application/zip,application/vnd.ms-outlook,message/rfc822"
            multiple
            onChange={(e) => handleFiles(e.target.files, { append: true })}
          />
          <input
            ref={folderInputRef}
            className="hidden"
            type="file"
            multiple
            {...({
              webkitdirectory: "",
              directory: "",
            } satisfies DirectoryInputProps)}
            onChange={(e) => handleFiles(e.target.files, { append: true })}
          />
        </motion.div>

        <motion.div
          initial={{ opacity: 0, x: 12 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.3, ease: "easeOut" }}
          className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-line/70 bg-panel/90 shadow-sm backdrop-blur-xl"
        >
          <div className="flex items-start justify-between gap-3 border-b border-line/70 px-4 py-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-sm font-semibold text-fg">
                <Target className="h-4 w-4 text-accent" />
                Project context
              </div>
              <p className="mt-1 text-xs leading-5 text-fg/45">
                Capture the minimum context required to create the estimate workspace.
              </p>
            </div>
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-success/10 text-success">
              <Zap className="h-4 w-4" />
            </div>
          </div>

          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
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

            <div>
              <Label>Project name</Label>
              <Input value={packageName} onChange={(e) => setPackageName(e.target.value)} placeholder="e.g. North Campus Boiler Upgrade" />
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
                    <SearchablePicker
                      value={customerId || null}
                      onSelect={setCustomerId}
                      options={customerOptions
                        .filter((c) => c.active)
                        .map((c) => ({
                          id: c.id,
                          label: c.name,
                          secondary: c.shortName || undefined,
                        }))}
                      placeholder="Select client..."
                      searchPlaceholder="Search clients..."
                      triggerClassName="h-9 rounded-lg px-3 text-sm bg-bg/50"
                    />
                  </div>
                  <Button type="button" size="xs" variant="secondary" onClick={() => setQuickAddOpen(true)} title="Add new client">
                    <Plus className="h-3 w-3" />
                  </Button>
                </div>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1 2xl:grid-cols-2">
              <div>
                <Label className="flex items-center gap-1.5">
                  <MapPin className="h-3 w-3" />
                  Location
                </Label>
                <Input placeholder="City, State" value={location} onChange={(e) => setLocation(e.target.value)} />
              </div>
              <div>
                <Label className="flex items-center gap-1.5">
                  <CalendarClock className="h-3 w-3" />
                  Bid due
                </Label>
                <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
              </div>
            </div>

            <div>
              <Label>Scope</Label>
              <Textarea
                placeholder="Full package, trade split, building area, alternate, or discipline."
                value={scope}
                onChange={(e) => setScope(e.target.value)}
                className="min-h-16 resize-none"
              />
            </div>

            {personas.length > 0 && (
              <div>
                <Label>Estimating playbook</Label>
                <StyledSelect
                  value={personaId || "__auto__"}
                  onValueChange={(v) => setPersonaId(v === "__auto__" ? "" : v)}
                  placeholder="Auto-detect"
                >
                  <SelectItem value="__auto__">Auto-detect</SelectItem>
                  {personas.map((persona) => (
                    <SelectItem key={persona.id} value={persona.id}>
                      {persona.name}{persona.trade ? ` - ${persona.trade}` : ""}
                    </SelectItem>
                  ))}
                </StyledSelect>
                {personaId && (
                  <div className="mt-1 text-[10px] leading-tight text-fg/40">
                    {selectedPersona?.description || ""}
                  </div>
                )}
              </div>
            )}

            <div>
              <Label>Notes</Label>
              <Textarea placeholder="Optional notes" value={notes} onChange={(e) => setNotes(e.target.value)} className="min-h-16 resize-none" />
            </div>
          </div>

          <div className="border-t border-line/70 px-4 py-3">
            {status && (
              <div className="mb-2 rounded-lg border border-success/20 bg-success/5 px-3 py-2 text-xs text-success">{status}</div>
            )}
            {error && (
              <div className="mb-2 rounded-lg border border-danger/20 bg-danger/5 px-3 py-2 text-xs text-danger">{error}</div>
            )}
            <Button className="h-11 w-full gap-2" type="submit" disabled={isPending || files.length === 0}>
              {isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Uploading...
                </>
              ) : (
                <>
                  <FileUp className="h-4 w-4" />
                  Create intake workspace
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </Button>
          </div>
        </motion.div>
      </div>
    </form>
  );
}
