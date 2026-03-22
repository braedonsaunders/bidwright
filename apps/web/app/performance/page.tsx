import { AppShell } from "@/components/app-shell";
import { PerformanceDashboard } from "@/components/performance-dashboard";
import { getProjects } from "@/lib/api";

export default async function PerformancePage() {
  const projects = await getProjects().catch(() => []);

  return (
    <AppShell projects={projects}>
      <PerformanceDashboard projects={projects} />
    </AppShell>
  );
}
