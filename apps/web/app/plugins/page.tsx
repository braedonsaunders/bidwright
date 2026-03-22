import { AppShell } from "@/components/app-shell";
import { PluginsPage } from "@/components/plugins-page";
import { getProjects, listPlugins } from "@/lib/api";

export default async function PluginsRoute() {
  const [projectsResult, pluginsResult] = await Promise.allSettled([
    getProjects(),
    listPlugins(),
  ]);

  const projects =
    projectsResult.status === "fulfilled" ? projectsResult.value : [];
  const plugins =
    pluginsResult.status === "fulfilled" ? pluginsResult.value : [];

  return (
    <AppShell projects={projects}>
      <PluginsPage initialPlugins={plugins} />
    </AppShell>
  );
}
