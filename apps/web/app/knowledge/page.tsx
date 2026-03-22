import { AppShell } from "@/components/app-shell";
import { KnowledgePage } from "@/components/knowledge-page";
import { getProjects, listKnowledgeBooks, listDatasets } from "@/lib/api";

export default async function KnowledgeRoute() {
  const [projectsResult, booksResult, datasetsResult] = await Promise.allSettled([
    getProjects(),
    listKnowledgeBooks(),
    listDatasets(),
  ]);

  const projects =
    projectsResult.status === "fulfilled" ? projectsResult.value : [];
  const books =
    booksResult.status === "fulfilled" ? booksResult.value : [];
  const datasets =
    datasetsResult.status === "fulfilled" ? datasetsResult.value : [];

  return (
    <AppShell projects={projects}>
      <KnowledgePage initialBooks={books} initialDatasets={datasets} />
    </AppShell>
  );
}
