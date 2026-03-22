import { AppShell } from "@/components/app-shell";
import { QuotesList } from "@/components/quotes-list";
import { getProjects } from "@/lib/api";

export default async function QuotesPage() {
  const projectsResult = await getProjects().catch(() => []);

  return (
    <AppShell projects={projectsResult}>
      <QuotesList projects={projectsResult} />
    </AppShell>
  );
}
