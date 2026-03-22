"use client";

import { useRef, useState, useTransition, type FormEvent } from "react";
import { FileUp, Loader2, UploadCloud, X } from "lucide-react";
import { useRouter } from "next/navigation";
import type { ProjectListItem } from "@/lib/api";
import { submitPackageIngest } from "@/lib/api";
import { Badge, Button, Card, CardBody, Input, Label, Select, Textarea } from "@/components/ui";
import { cn } from "@/lib/utils";

export function ZipDropzone({ projects }: { projects: ProjectListItem[] }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [projectId, setProjectId] = useState("");
  const [packageName, setPackageName] = useState("Customer package");
  const [clientName, setClientName] = useState("");
  const [location, setLocation] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleFile(nextFile: File | null) {
    if (!nextFile) return;
    const isZip = nextFile.name.toLowerCase().endsWith(".zip") || nextFile.type === "application/zip";
    if (!isZip) {
      setError("Only .zip files are supported.");
      return;
    }
    setError(null);
    setStatus(null);
    setFile(nextFile);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) {
      setError("Select a package file.");
      return;
    }

    setError(null);
    setStatus(null);

    startTransition(async () => {
      try {
        const result = await submitPackageIngest({
          file,
          projectId: projectId || undefined,
          packageName,
          clientName: clientName || undefined,
          location: location || undefined,
          dueDate: dueDate || undefined,
          notes: notes || undefined,
        });

        const nextProjectId =
          (result as { projectId?: string }).projectId ??
          (result as { project?: { id?: string } }).project?.id ??
          (result as { workspace?: { project?: { id?: string } } }).workspace?.project?.id ??
          projectId;

        setStatus("Package uploaded successfully.");

        if (nextProjectId) {
          router.push(`/projects/${nextProjectId}`);
          router.refresh();
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
              : file
                ? "border-success/30 bg-success/5"
                : "border-line bg-panel2/30 hover:border-fg/20"
          )}
          onDragEnter={(e) => { e.preventDefault(); setDragActive(true); }}
          onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
          onDragLeave={() => setDragActive(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragActive(false);
            handleFile(e.dataTransfer.files[0] ?? null);
          }}
        >
          {file ? (
            <div className="flex items-center gap-3">
              <FileUp className="h-5 w-5 text-success" />
              <div>
                <div className="text-sm font-medium">{file.name}</div>
                <div className="text-xs text-fg/40">{(file.size / 1024 / 1024).toFixed(1)} MB</div>
              </div>
              <button
                type="button"
                onClick={() => setFile(null)}
                className="ml-2 rounded p-1 text-fg/30 hover:bg-panel2 hover:text-fg/60"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <>
              <UploadCloud className="h-8 w-8 text-fg/20" />
              <p className="mt-3 text-sm text-fg/50">
                Drop bid package (.zip) here or{" "}
                <button
                  type="button"
                  className="text-accent hover:underline"
                  onClick={() => inputRef.current?.click()}
                >
                  browse
                </button>
              </p>
            </>
          )}
          <input
            ref={inputRef}
            className="hidden"
            type="file"
            accept=".zip,application/zip"
            onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
          />
        </div>

        {/* Form fields */}
        <div className="space-y-3">
          <div>
            <Label>Destination</Label>
            <Select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">New project</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.quote.quoteNumber})
                </option>
              ))}
            </Select>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>Package name</Label>
              <Input value={packageName} onChange={(e) => setPackageName(e.target.value)} />
            </div>
            <div>
              <Label>Client</Label>
              <Input placeholder="Client name" value={clientName} onChange={(e) => setClientName(e.target.value)} />
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
            <Label>Notes</Label>
            <Textarea placeholder="Optional notes" value={notes} onChange={(e) => setNotes(e.target.value)} className="min-h-16" />
          </div>

          <Button className="w-full" type="submit" disabled={isPending || !file}>
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
