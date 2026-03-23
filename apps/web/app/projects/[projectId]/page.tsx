"use client";

import { Suspense, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { ProjectWorkspace } from "@/components/project-workspace";
import { getProjectWorkspace, getProjects, type ProjectListItem, type WorkspaceResponse } from "@/lib/api";

export default function ProjectPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [workspacePayload, setWorkspacePayload] = useState<WorkspaceResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;

    Promise.allSettled([getProjects(), getProjectWorkspace(projectId)]).then(
      ([projectsResult, workspaceResult]) => {
        if (cancelled) return;
        setProjects(projectsResult.status === "fulfilled" ? projectsResult.value : []);
        setWorkspacePayload(workspaceResult.status === "fulfilled" ? workspaceResult.value : null);
        setLoading(false);
      },
    );

    return () => { cancelled = true; };
  }, [projectId]);

  const workspace = workspacePayload?.workspace ?? null;

  if (loading) {
    return (
      <AppShell projects={[]}>
        <div className="flex min-h-[50vh] items-center justify-center">
          <div className="text-sm text-fg/40">Loading project...</div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell projects={projects}>
      {workspace && workspacePayload ? (
        <Suspense>
          <ProjectWorkspace initialData={workspacePayload} />
        </Suspense>
      ) : (
        <div className="rounded-[28px] border border-line bg-panel/80 p-8">
          <p className="text-sm uppercase tracking-[0.24em] text-fg/55">Workspace unavailable</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight">The live API did not return this project.</h1>
          <p className="mt-4 max-w-2xl text-sm text-fg/70">
            The shell is connected to the live project list, but the workspace payload could not be loaded right now.
          </p>
        </div>
      )}
    </AppShell>
  );
}
