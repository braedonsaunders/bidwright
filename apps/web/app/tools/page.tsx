"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, Loader2, User, X } from "lucide-react";
import { Button } from "@braedonsaunders/appkit-ui";
import { FileBrowser } from "@/components/workspace/file-browser";
import { cn } from "@/lib/utils";
import {
  addToolsFileToQuote,
  getProjects,
  getToolsWorkspace,
  type AuthoringWorkspaceData,
  type FileNode,
  type ProjectListItem,
  type ToolsSpace,
} from "@/lib/api";

const SPACE_KEY = "bidwright.tools.space";
const spaces: Array<{ id: ToolsSpace; label: string; icon: typeof User; title: string }> = [
  { id: "personal", label: "My files", icon: User, title: "Private to you" },
  { id: "organization", label: "Organization", icon: Building2, title: "Shared with everyone in your organization" },
];

export default function ToolsPage() {
  const router = useRouter();
  const [space, setSpace] = useState<ToolsSpace>("personal");
  const [workspaces, setWorkspaces] = useState<Partial<Record<ToolsSpace, AuthoringWorkspaceData>>>({});
  const [error, setError] = useState("");
  const [file, setFile] = useState<FileNode | null>(null),
    [projects, setProjects] = useState<ProjectListItem[]>([]),
    [destination, setDestination] = useState(""),
    [quoteName, setQuoteName] = useState(""),
    [busy, setBusy] = useState(false);

  useEffect(() => {
    if (window.localStorage.getItem(SPACE_KEY) === "organization") setSpace("organization");
  }, []);
  useEffect(() => {
    window.localStorage.setItem(SPACE_KEY, space);
    if (workspaces[space]) return;
    let active = true;
    setError("");
    getToolsWorkspace(space)
      .then((w) => {
        if (active) setWorkspaces((current) => ({ ...current, [space]: w }));
      })
      .catch((e) => {
        if (active) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      active = false;
    };
  }, [space, workspaces]);

  const addToQuote = (f: FileNode) => {
    setFile(f);
    setError("");
    setQuoteName(f.name.replace(/\.[^.]+$/, ""));
    setDestination("");
    void getProjects()
      .then((r) => setProjects(r.filter((p) => !!p.quote)))
      .catch((e) => setError(e.message));
  };
  const submit = async () => {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const result = await addToolsFileToQuote(file.id, destination ? { projectId: destination } : { quoteName });
      setFile(null);
      router.push(result.quoteId ? "/quotes/" + result.quoteId : "/projects/" + result.projectId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const workspace = workspaces[space];
  const spaceSwitch = (
    <div role="tablist" aria-label="File tree" className="flex rounded-md border border-line bg-bg p-0.5">
      {spaces.map(({ id, label, icon: Icon, title }) => (
        <button
          key={id}
          role="tab"
          aria-selected={space === id}
          title={title}
          onClick={() => setSpace(id)}
          className={cn(
            "flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors",
            space === id ? "bg-panel text-fg shadow-sm" : "text-fg/50 hover:text-fg/80",
          )}
        >
          <Icon className="h-3.5 w-3.5" />
          {label}
        </button>
      ))}
    </div>
  );

  return (
    <div className="flex h-full min-h-0 flex-col bg-bg p-4">
      {workspace ? (
        <FileBrowser
          key={space}
          workspace={workspace}
          standalone
          filesTitle={spaceSwitch}
          onAddToQuote={addToQuote}
        />
      ) : error ? (
        <div role="alert" className="flex h-full flex-col items-center justify-center gap-3 text-sm text-danger">
          {error}
          <Button variant="secondary" size="sm" onClick={() => setWorkspaces({})}>
            Try again
          </Button>
        </div>
      ) : (
        <div className="flex h-full items-center justify-center gap-3 text-sm text-fg/50">
          <Loader2 className="h-4 w-4 animate-spin" />
          Opening your files…
        </div>
      )}
      {file && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/35 backdrop-blur-sm"
          onPointerDown={(e) => {
            if (e.target === e.currentTarget && !busy) setFile(null);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="tools-quote-title"
            className="w-[430px] max-w-[95vw] rounded-xl border border-line bg-panel p-6 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <h2 id="tools-quote-title" className="text-base font-semibold">
                Add file to quote
              </h2>
              <button aria-label="Close" onClick={() => setFile(null)} disabled={busy}>
                <X size={16} />
              </button>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-fg/50">
              A copy of {file.name} will be added to the quote. Your original stays in Tools.
            </p>
            <label className="mt-5 block text-xs text-fg/60">
              Existing quote
              <select
                className="mt-2 h-9 w-full rounded-md border border-line bg-bg px-2 text-fg"
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
              >
                <option value="">Create a new quote</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.quote?.quoteNumber} · {p.name}
                  </option>
                ))}
              </select>
            </label>
            {!destination && (
              <label className="mt-4 block text-xs text-fg/60">
                New quote name
                <input
                  className="mt-2 h-9 w-full rounded-md border border-line bg-bg px-3 text-fg"
                  value={quoteName}
                  onChange={(e) => setQuoteName(e.target.value)}
                />
              </label>
            )}
            {error && (
              <p role="alert" className="mt-3 text-xs text-danger">
                {error}
              </p>
            )}
            <div className="mt-6 flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setFile(null)} disabled={busy}>
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={() => void submit()}
                disabled={busy || (!destination && !quoteName.trim())}
              >
                {busy ? <Loader2 size={14} className="animate-spin" /> : null}
                {destination ? "Add to quote" : "Create quote from file"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
