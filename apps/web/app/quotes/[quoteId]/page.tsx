"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { getProjects } from "@/lib/api";

export default function QuoteDetailPage() {
  const { quoteId } = useParams<{ quoteId: string }>();
  const router = useRouter();

  useEffect(() => {
    if (!quoteId) return;
    getProjects()
      .then((projects) => {
        const project = projects.find((p) => p.quote?.id === quoteId);
        if (project) {
          router.replace(`/projects/${project.id}`);
        }
      })
      .catch(() => {});
  }, [quoteId, router]);

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
