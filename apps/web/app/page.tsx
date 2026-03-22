import { AppShell } from "@/components/app-shell";
import { ProjectDashboard } from "@/components/project-dashboard";
import { getAiRuns, getCatalogs, getProjects } from "@/lib/api";

export default async function HomePage() {
  const [projectsResult, aiRunsResult, catalogsResult] = await Promise.allSettled([
    getProjects(),
    getAiRuns(),
    getCatalogs(),
  ]);

  const projects = projectsResult.status === "fulfilled" ? projectsResult.value : [];
  const aiRuns = aiRunsResult.status === "fulfilled" ? aiRunsResult.value : [];
  const catalogs = catalogsResult.status === "fulfilled" ? catalogsResult.value : [];

  return (
    <AppShell projects={projects}>
      <ProjectDashboard projects={projects} aiRuns={aiRuns} catalogs={catalogs} />
    </AppShell>
  );
}
