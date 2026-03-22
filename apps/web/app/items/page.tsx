import { AppShell } from "@/components/app-shell";
import { ItemsManager } from "@/components/items-manager";
import { getCatalogs, getProjects } from "@/lib/api";

export default async function ItemsPage() {
  const [projectsResult, catalogsResult] = await Promise.allSettled([
    getProjects(),
    getCatalogs(),
  ]);

  const projects =
    projectsResult.status === "fulfilled" ? projectsResult.value : [];
  const catalogs =
    catalogsResult.status === "fulfilled" ? catalogsResult.value : [];

  return (
    <AppShell projects={projects}>
      <ItemsManager catalogs={catalogs} />
    </AppShell>
  );
}
