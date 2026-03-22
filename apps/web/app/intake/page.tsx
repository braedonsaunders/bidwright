import { AppShell } from "@/components/app-shell";
import { ProjectIntake } from "@/components/project-intake";
import { getCatalogs, getProjects } from "@/lib/api";

export default async function IntakePage() {
  const [projectsResult, catalogsResult] = await Promise.allSettled([getProjects(), getCatalogs()]);
  const projects = projectsResult.status === "fulfilled" ? projectsResult.value : [];
  const catalogs = catalogsResult.status === "fulfilled" ? catalogsResult.value : [];

  return (
    <AppShell projects={projects}>
      <ProjectIntake projects={projects} catalogs={catalogs} />
    </AppShell>
  );
}
