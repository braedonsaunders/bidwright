"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { ProjectsList } from "@/components/projects-list";
import { getProjectsWithFilters, type ProjectListItem } from "@/lib/api";

export default function ProjectsPage() {
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getProjectsWithFilters()
      .then((res) => setProjects(res.projects))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <AppShell projects={projects}>
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-accent border-t-transparent" />
        </div>
      ) : (
        <ProjectsList projects={projects} />
      )}
    </AppShell>
  );
}
