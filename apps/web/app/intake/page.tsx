"use client";

import { useEffect, useState } from "react";
import { ProjectIntake } from "@/components/project-intake";
import { getProjects } from "@/lib/api";
import type { ProjectListItem } from "@/lib/api";

export default function IntakePage() {
  const [projects, setProjects] = useState<ProjectListItem[]>([]);

  useEffect(() => {
    getProjects().then(setProjects).catch(() => {});
  }, []);

  return <ProjectIntake projects={projects} />;
}
