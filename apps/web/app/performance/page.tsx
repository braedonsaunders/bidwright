"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { PerformanceDashboard } from "@/components/performance-dashboard";
import { getProjects, type ProjectListItem } from "@/lib/api";

export default function PerformancePage() {
  const [projects, setProjects] = useState<ProjectListItem[]>([]);

  useEffect(() => {
    getProjects().then(setProjects).catch(() => {});
  }, []);

  return (
    <AppShell projects={projects}>
      <PerformanceDashboard projects={projects} />
    </AppShell>
  );
}
