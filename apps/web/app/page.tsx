"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { ProjectDashboard } from "@/components/project-dashboard";
import { getAiRuns, getCatalogs, getProjects } from "@/lib/api";
import type { AiRun, CatalogSummary, ProjectListItem } from "@/lib/api";

export default function HomePage() {
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [aiRuns, setAiRuns] = useState<AiRun[]>([]);
  const [catalogs, setCatalogs] = useState<CatalogSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.allSettled([getProjects(), getAiRuns(), getCatalogs()])
      .then(([p, a, c]) => {
        if (p.status === "fulfilled") setProjects(p.value);
        if (a.status === "fulfilled") setAiRuns(a.value);
        if (c.status === "fulfilled") setCatalogs(c.value);
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <AppShell projects={[]}>
        <div className="flex items-center justify-center py-20">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-accent border-t-transparent" />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell projects={projects}>
      <ProjectDashboard projects={projects} aiRuns={aiRuns} catalogs={catalogs} />
    </AppShell>
  );
}
