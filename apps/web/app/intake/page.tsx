"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { ProjectIntake } from "@/components/project-intake";
import { getProjects } from "@/lib/api";
import type { ProjectListItem } from "@/lib/api";

export default function IntakePage() {
  const [projects, setProjects] = useState<ProjectListItem[]>([]);

  useEffect(() => {
    getProjects().then(setProjects).catch(() => {});
  }, []);

  return (
    <AppShell projects={projects}>
      <ProjectIntake projects={projects} />
    </AppShell>
  );
}
