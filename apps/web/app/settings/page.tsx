import { AppShell } from "@/components/app-shell";
import { SettingsPage } from "@/components/settings-page";
import { getProjects } from "@/lib/api";

export default async function SettingsRoute() {
  const projects = await getProjects().catch(() => []);

  return (
    <AppShell projects={projects}>
      <SettingsPage />
    </AppShell>
  );
}
