"use client";

import { useEffect, useRef, useState, useTransition, type DragEvent, type FormEvent, type InputHTMLAttributes } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useTranslations } from "next-intl";
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

interface DropMessages {
  noReadableFiles: string;
  outlookRowOnly: (payloadLabel: string) => string;
  outlookWebLink: (payloadLabel: string) => string;
  outlookNonFile: (payloadLabel: string) => string;
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
    case "application/msword":
      return ".doc";
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      return ".docx";
    case "application/rtf":
    case "text/rtf":
      return ".rtf";
    case "application/vnd.openxmlformats-officedocument.presentationml.presentation":
      return ".pptx";
    case "text/html":
      return ".html";
    case "multipart/related":
    case "application/x-mimearchive":
      return ".mhtml";
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

function IntakeGeometryField({ dragActive, filesLoaded }: { dragActive: boolean; filesLoaded: boolean }) {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <motion.div
        className="absolute inset-0 opacity-45 [background-image:linear-gradient(hsl(var(--fg)/0.045)_1px,transparent_1px),linear-gradient(90deg,hsl(var(--fg)/0.04)_1px,transparent_1px),linear-gradient(hsl(var(--accent)/0.055)_1px,transparent_1px),linear-gradient(90deg,hsl(var(--accent)/0.045)_1px,transparent_1px)] [background-size:24px_24px,24px_24px,120px_120px,120px_120px]"
        animate={{ backgroundPosition: ["0px 0px, 0px 0px, 0px 0px, 0px 0px", "36px 24px, 36px 24px, 120px 0px, 120px 0px"] }}
        transition={{ duration: 28, repeat: Infinity, ease: "linear" }}
      />
      <div className="absolute inset-x-8 top-1/2 h-px bg-[linear-gradient(90deg,transparent,hsl(var(--fg)/0.12),transparent)]" />
      <div className="absolute inset-y-10 left-1/2 w-px bg-[linear-gradient(180deg,transparent,hsl(var(--fg)/0.1),transparent)]" />
      <motion.div
        className={cn(
          "absolute inset-y-0 left-0 w-1/3 bg-[linear-gradient(90deg,transparent,hsl(var(--accent)/0.06),transparent)]",
          filesLoaded && "bg-[linear-gradient(90deg,transparent,hsl(var(--success)/0.055),transparent)]"
        )}
        animate={{ x: dragActive ? ["-55%", "260%"] : ["-65%", "235%"], opacity: dragActive ? [0, 0.72, 0] : [0, 0.22, 0] }}
        transition={{ duration: dragActive ? 1.25 : 8.4, repeat: Infinity, ease: "easeInOut" }}
      />
    </div>
  );
}

function UploadPulseRings({ active }: { active: boolean }) {
  return (
    <>
      {[0, 1, 2].map((index) => (
        <motion.span
          key={index}
          className={cn(
            "absolute inset-0 rounded-full border",
            active ? "border-accent/40" : "border-fg/15"
          )}
          animate={{
            scale: active ? [1, 1.86, 1.86] : [1, 1.58, 1.58],
            opacity: active ? [0.34, 0.14, 0] : [0.18, 0.08, 0],
          }}
          transition={{
            duration: active ? 1.35 : 3.6,
            delay: index * (active ? 0.18 : 0.52),
            repeat: Infinity,
            ease: "easeOut",
          }}
        />
      ))}
      <motion.span
        className="absolute inset-5 rounded-full border border-accent/18"
        animate={{ scale: active ? [1, 1.08, 1] : [1, 1.04, 1], opacity: active ? [0.45, 0.8, 0.45] : [0.22, 0.38, 0.22] }}
        transition={{ duration: active ? 1.2 : 2.8, repeat: Infinity, ease: "easeInOut" }}
      />
    </>
  );
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

async function extractDroppedFiles(dataTransfer: DataTransfer, messages: DropMessages): Promise<ExtractDroppedFilesResult> {
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
      : { files: [], errorMessage: messages.noReadableFiles };
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
      errorMessage: messages.outlookRowOnly(payloadLabel),
    };
  }

  if (remoteCandidates.length > 0) {
    return {
      files: [],
      errorMessage: messages.outlookWebLink(payloadLabel),
    };
  }

  if (directStringValues.size > 0) {
    return {
      files: [],
      errorMessage: messages.outlookNonFile(payloadLabel),
    };
  }

  return {
    files: [],
    errorMessage: messages.noReadableFiles,
  };
}

export function ZipDropzone({ projects }: { projects: ProjectListItem[] }) {
  const t = useTranslations("Intake");
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [files, setFiles] = useState<SelectedUploadFile[]>([]);
  const [projectId, setProjectId] = useState("");
  const [packageName, setPackageName] = useState("");
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
      setError(quickAddError instanceof Error ? quickAddError.message : t("errors.failedClient"));
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

    const { files: droppedFiles, errorMessage } = await extractDroppedFiles(event.dataTransfer, {
      noReadableFiles: t("errors.noReadableFiles"),
      outlookRowOnly: (payloadLabel) => t("errors.outlookRowOnly", { payloadLabel }),
      outlookWebLink: (payloadLabel) => t("errors.outlookWebLink", { payloadLabel }),
      outlookNonFile: (payloadLabel) => t("errors.outlookNonFile", { payloadLabel }),
    });

    if (droppedFiles.length > 0) {
      handleFiles(droppedFiles);
      return;
    }

    setStatus(null);
    setError(errorMessage ?? t("errors.noReadableFiles"));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!files.length) {
      setError(t("errors.selectFile"));
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
          packageName: packageName.trim() || undefined,
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
            ? t("status.uploadSuccessSingle")
            : t("status.uploadSuccessMultiple", { count: files.length })
        );

        if (nextProjectId) {
          const personaParam = personaId ? `&persona=${encodeURIComponent(personaId)}` : "";
          router.push(`/projects/${nextProjectId}?tab=estimate&intake=true${personaParam}`);
        }
      } catch (submissionError) {
        setError(submissionError instanceof Error ? submissionError.message : t("errors.uploadFailed"));
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
  const intakeState = isPending ? t("state.uploading") : files.length ? t("state.loaded") : dragActive ? t("state.release") : t("state.waiting");

  return (
    <form className="flex min-h-0 w-full flex-1" onSubmit={handleSubmit}>
      <div className="grid min-h-0 w-full gap-4 lg:grid-cols-[minmax(0,1.06fr)_minmax(340px,0.82fr)]">
        <motion.div
          className={cn(
            "relative flex min-h-[390px] flex-col overflow-hidden rounded-lg border bg-panel/95 shadow-sm backdrop-blur-xl transition-colors lg:min-h-0",
            dragActive
              ? "border-accent shadow-[0_0_0_1px_hsl(var(--accent)/0.3)]"
              : files.length > 0
                ? "border-success/50"
                : "border-line/70"
          )}
          animate={{ scale: dragActive ? 1.006 : 1 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
          onDragEnter={(e) => { e.preventDefault(); setDragActive(true); }}
          onDragOver={(e) => { e.preventDefault(); setDragActive(true); e.dataTransfer.dropEffect = "copy"; }}
          onDragLeave={() => setDragActive(false)}
          onDrop={(e) => { void handleDrop(e); }}
        >
          <IntakeGeometryField dragActive={dragActive} filesLoaded={files.length > 0} />
          <div className="relative z-10 flex items-center justify-between border-b border-line/70 px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/15 text-accent">
                  <FileUp className="h-4 w-4" />
                </span>
                <div>
                  <div className="text-sm font-semibold text-fg">{t("package.title")}</div>
                  <div className="text-xs text-fg/45">{t("package.loadedSize", { size: totalSizeLabel })}</div>
                </div>
              </div>
              <Badge tone={files.length ? "success" : "info"}>{intakeState}</Badge>
            </div>

          <div className="relative z-10 flex min-h-0 flex-1 items-center justify-center p-5">
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
                        {files.length === 1 ? files[0].relativePath : t("selected.multipleFiles", { count: files.length })}
                      </h2>
                      <p className="mt-2 text-sm text-fg/50">{t("selected.totalSize", { size: totalSizeLabel })}</p>
                      <div className="mt-5 flex max-h-28 flex-wrap justify-center gap-1.5 overflow-hidden">
                        {files.slice(0, 10).map((selectedFile) => (
                          <Badge key={`${selectedFile.relativePath}-${selectedFile.file.size}-${selectedFile.file.lastModified}`} className="max-w-[220px] truncate">
                            {selectedFile.relativePath}
                          </Badge>
                        ))}
                        {files.length > 10 ? <Badge>{t("selected.more", { count: files.length - 10 })}</Badge> : null}
                      </div>
                      <button
                        type="button"
                        onClick={clearFiles}
                        className="mt-5 inline-flex items-center gap-1.5 rounded-lg border border-line bg-bg/70 px-3 py-2 text-xs font-medium text-fg/60 transition-colors hover:border-danger/30 hover:bg-danger/10 hover:text-danger"
                      >
                        <X className="h-3.5 w-3.5" />
                        {t("selected.clearPackage")}
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
                        "relative flex h-28 w-28 items-center justify-center overflow-visible rounded-full border bg-bg/80 shadow-sm",
                        dragActive ? "border-accent text-accent" : "border-line/80 text-fg/35",
                      )}
                      animate={{ y: dragActive ? [0, -4, 0] : [0, -2, 0], scale: dragActive ? [1, 1.025, 1] : 1 }}
                      transition={{ duration: dragActive ? 1.2 : 3.4, repeat: Infinity, ease: "easeInOut" }}
                    >
                      <UploadPulseRings active={dragActive} />
                      <UploadCloud className="relative z-10 h-11 w-11" />
                      <motion.span
                        className="absolute inset-x-8 bottom-7 h-px rounded-full bg-accent/45"
                        animate={{ scaleX: dragActive ? [0.45, 1, 0.45] : [0.35, 0.78, 0.35], opacity: dragActive ? [0.28, 0.74, 0.28] : [0.16, 0.34, 0.16] }}
                        transition={{ duration: dragActive ? 1.3 : 2.8, repeat: Infinity, ease: "easeInOut" }}
                      />
                    </motion.div>
                    <h2 className="mt-6 text-3xl font-semibold leading-tight text-fg">
                      {dragActive ? t("drop.releaseTitle") : t("drop.title")}
                    </h2>
                    <p className="mt-3 max-w-lg text-sm leading-6 text-fg/55">
                      {t("drop.description")}
                    </p>
                    <div className="mt-6 flex flex-wrap justify-center gap-2">
                      <button
                        type="button"
                        className="inline-flex h-10 items-center gap-2 rounded-lg border border-line bg-panel px-3 text-sm font-medium text-fg/70 transition-colors hover:border-accent/40 hover:text-fg"
                        onClick={() => fileInputRef.current?.click()}
                      >
                        <FileText className="h-4 w-4 text-accent" />
                        {t("drop.selectFiles")}
                      </button>
                      <button
                        type="button"
                        className="inline-flex h-10 items-center gap-2 rounded-lg border border-line bg-panel px-3 text-sm font-medium text-fg/70 transition-colors hover:border-accent/40 hover:text-fg"
                        onClick={() => folderInputRef.current?.click()}
                      >
                        <FolderOpen className="h-4 w-4 text-accent" />
                        {t("drop.selectFolder")}
                      </button>
                      <span className="inline-flex h-10 items-center gap-2 rounded-lg border border-line/70 bg-bg/45 px-3 text-sm font-medium text-fg/45">
                        <Mail className="h-4 w-4" />
                        {t("drop.emailFormats")}
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
            accept=".zip,.pdf,.xlsx,.xls,.csv,.tsv,.doc,.docx,.rtf,.pptx,.html,.htm,.mhtml,.mht,.txt,.png,.jpg,.jpeg,.tif,.tiff,.bmp,.dwg,.dxf,.msg,.eml,application/zip,application/vnd.ms-outlook,message/rfc822"
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
                {t("context.title")}
              </div>
              <p className="mt-1 text-xs leading-5 text-fg/45">
                {t("context.description")}
              </p>
            </div>
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-success/10 text-success">
              <Zap className="h-4 w-4" />
            </div>
          </div>

          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
            <div>
              <Label>{t("fields.destination")}</Label>
              <StyledSelect value={projectId || "__new__"} onValueChange={(v) => setProjectId(v === "__new__" ? "" : v)} placeholder={t("fields.newProject")}>
                <SelectItem value="__new__">{t("fields.newProject")}</SelectItem>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}{(p as any).quote ? ` (${(p as any).quote.quoteNumber})` : ""}
                  </SelectItem>
                ))}
              </StyledSelect>
            </div>

            <div>
              <Label>{t("fields.projectName")}</Label>
              <Input value={packageName} onChange={(e) => setPackageName(e.target.value)} placeholder={t("fields.projectNamePlaceholder")} />
            </div>

            <div>
              <Label>{t("fields.client")}</Label>
              {quickAddOpen ? (
                <div className="flex gap-1.5">
                  <Input
                    placeholder={t("fields.newClientName")}
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
                      placeholder={t("fields.selectClient")}
                      searchPlaceholder={t("fields.searchClients")}
                      triggerClassName="h-9 rounded-lg px-3 text-sm bg-bg/50"
                    />
                  </div>
                  <Button type="button" size="xs" variant="secondary" onClick={() => setQuickAddOpen(true)} title={t("fields.addClient")}>
                    <Plus className="h-3 w-3" />
                  </Button>
                </div>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1 2xl:grid-cols-2">
              <div>
                <Label className="flex items-center gap-1.5">
                  <MapPin className="h-3 w-3" />
                  {t("fields.location")}
                </Label>
                <Input placeholder={t("fields.locationPlaceholder")} value={location} onChange={(e) => setLocation(e.target.value)} />
              </div>
              <div>
                <Label className="flex items-center gap-1.5">
                  <CalendarClock className="h-3 w-3" />
                  {t("fields.bidDue")}
                </Label>
                <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
              </div>
            </div>

            <div>
              <Label>{t("fields.scope")}</Label>
              <Textarea
                placeholder={t("fields.scopePlaceholder")}
                value={scope}
                onChange={(e) => setScope(e.target.value)}
                className="min-h-16 resize-none"
              />
            </div>

            {personas.length > 0 && (
              <div>
                <Label>{t("fields.playbook")}</Label>
                <StyledSelect
                  value={personaId || "__auto__"}
                  onValueChange={(v) => setPersonaId(v === "__auto__" ? "" : v)}
                  placeholder={t("fields.autoDetect")}
                >
                  <SelectItem value="__auto__">{t("fields.autoDetect")}</SelectItem>
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
              <Label>{t("fields.notes")}</Label>
              <Textarea placeholder={t("fields.notesPlaceholder")} value={notes} onChange={(e) => setNotes(e.target.value)} className="min-h-16 resize-none" />
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
                  {t("actions.uploading")}
                </>
              ) : (
                <>
                  <FileUp className="h-4 w-4" />
                  {t("actions.createWorkspace")}
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
