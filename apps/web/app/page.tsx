"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { ProjectDashboard } from "@/components/project-dashboard";
import { getProjects } from "@/lib/api";
import type { ProjectListItem } from "@/lib/api";

export default function HomePage() {
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.allSettled([getProjects()])
      .then(([p]) => {
        if (p.status === "fulfilled") setProjects(p.value);
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
      <ProjectDashboard projects={projects} />
    </AppShell>
  );
}
