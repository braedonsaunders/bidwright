"use client";

import { Suspense, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Button } from "@appkit/ui";
import { ProjectWorkspace } from "@/components/project-workspace";
import { getProjectWorkspace, type WorkspaceResponse } from "@/lib/api";

export default function ProjectPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [workspacePayload, setWorkspacePayload] = useState<WorkspaceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;

    Promise.allSettled([getProjectWorkspace(projectId)]).then(
      ([workspaceResult]) => {
        if (cancelled) return;
        const succeeded = workspaceResult.status === "fulfilled";
        setWorkspacePayload(succeeded ? workspaceResult.value : null);
        setLoadFailed(!succeeded);
        setLoading(false);
      },
    );

    return () => { cancelled = true; };
  }, [projectId]);

  const workspace = workspacePayload?.workspace ?? null;

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="text-sm text-fg/40">Loading project...</div>
      </div>
    );
  }

  return (
    workspace && workspacePayload ? (
      <Suspense>
        <ProjectWorkspace initialData={workspacePayload} />
      </Suspense>
    ) : (
      <div className="rounded-xl border border-line bg-panel p-8">
        <p className="text-sm font-medium text-fg/55">Quote unavailable</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
          {loadFailed ? "We couldn’t load this quote." : "This quote could not be found."}
        </h1>
        <p className="mt-4 max-w-2xl text-sm text-fg/70">
          {loadFailed
            ? "Try again. If the problem continues, contact your administrator."
            : "It may have been removed, or you may no longer have access to it."}
        </p>
        {loadFailed ? (
          <Button className="mt-6" onClick={() => window.location.reload()}>
            Try again
          </Button>
        ) : null}
      </div>
    )
  );
}
