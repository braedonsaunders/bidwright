import { redirect } from "next/navigation";
import { getProjects } from "@/lib/api";

export default async function QuoteDetailPage({
  params,
}: {
  params: Promise<{ quoteId: string }>;
}) {
  const { quoteId } = await params;

  try {
    const projects = await getProjects();
    const project = projects.find((p) => p.quote.id === quoteId);

    if (project) {
      redirect(`/projects/${project.id}`);
    }
  } catch {
    // fall through to message below
  }

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="text-center">
        <h1 className="text-lg font-semibold text-fg">Redirecting...</h1>
        <p className="mt-2 text-sm text-fg/50">
          Quote not found. The project workspace may have been removed.
        </p>
      </div>
    </div>
  );
}
