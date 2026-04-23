"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AlertCircle, Loader2, Ruler } from "lucide-react";
import { TakeoffTab } from "@/components/workspace/takeoff-tab";
import { getProjectWorkspace, type WorkspaceResponse } from "@/lib/api";
import { Button } from "@/components/ui";

function TakeoffViewerInner() {
  const searchParams = useSearchParams();
  const projectId = searchParams.get("projectId") ?? "";
  const docId = searchParams.get("docId") ?? "";
  const pageParam = Number.parseInt(searchParams.get("page") ?? "1", 10);
  const initialPage = Number.isFinite(pageParam) ? Math.max(1, pageParam) : 1;

  const [workspacePayload, setWorkspacePayload] = useState<WorkspaceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadWorkspace = useCallback(async () => {
    if (!projectId) {
      setWorkspacePayload(null);
      setError("No project was provided for this takeoff window.");
      setLoading(false);
      return;
    }

    try {
      setError(null);
      const payload = await getProjectWorkspace(projectId);
      setWorkspacePayload(payload);
    } catch (err) {
      setWorkspacePayload(null);
      setError(err instanceof Error ? err.message : "The workspace could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    setLoading(true);
    void loadWorkspace();
  }, [loadWorkspace]);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-bg text-fg">
        <div className="flex items-center gap-3 text-sm text-fg/50">
          <Loader2 className="h-5 w-5 animate-spin text-accent" />
          Loading takeoff...
        </div>
      </div>
    );
  }

  if (!workspacePayload) {
    return (
      <div className="flex h-screen items-center justify-center bg-bg p-6 text-fg">
        <div className="w-full max-w-md rounded-lg border border-line bg-panel p-6 shadow-xl">
          <div className="flex items-center gap-2 text-sm font-semibold text-fg">
            <AlertCircle className="h-4 w-4 text-danger" />
            Takeoff unavailable
          </div>
          <p className="mt-3 text-sm text-fg/60">
            {error ?? "The live API did not return this project workspace."}
          </p>
          <Button className="mt-5" variant="secondary" size="sm" onClick={() => void loadWorkspace()}>
            Retry
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen min-h-0 flex-col bg-bg text-fg">
      <div className="flex items-center gap-2 border-b border-line bg-panel px-3 py-2 text-xs text-fg/50">
        <Ruler className="h-3.5 w-3.5" />
        <span className="font-medium text-fg/70">Takeoff</span>
        <span>Detached window</span>
      </div>
      <div className="min-h-0 flex-1">
        <TakeoffTab
          workspace={workspacePayload.workspace}
          initialDocumentId={docId || undefined}
          initialPage={initialPage}
          detached
          onWorkspaceMutated={() => void loadWorkspace()}
        />
      </div>
    </div>
  );
}

export default function TakeoffViewerPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-screen items-center justify-center bg-bg text-fg">
          <Loader2 className="h-6 w-6 animate-spin text-accent" />
        </div>
      }
    >
      <TakeoffViewerInner />
    </Suspense>
  );
}
