import { AppShell } from "@/components/app-shell";
import { ProjectWorkspace } from "@/components/project-workspace";
import { getProjectWorkspace, getProjects } from "@/lib/api";

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const [projectsResult, workspaceResult] = await Promise.allSettled([
    getProjects(),
    getProjectWorkspace(projectId),
  ]);

  const projects = projectsResult.status === "fulfilled" ? projectsResult.value : [];
  const workspacePayload = workspaceResult.status === "fulfilled" ? workspaceResult.value : null;
  const workspace = workspacePayload?.workspace ?? null;

  return (
    <AppShell projects={projects}>
      {workspace && workspacePayload ? (
        <ProjectWorkspace initialData={workspacePayload} />
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
