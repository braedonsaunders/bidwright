"use client";

import { useEffect, useState } from "react";
import { PerformanceDashboard } from "@/components/performance-dashboard";
import { getProjects, type ProjectListItem } from "@/lib/api";

export default function PerformancePage() {
  const [projects, setProjects] = useState<ProjectListItem[]>([]);

  useEffect(() => {
    getProjects().then(setProjects).catch(() => {});
  }, []);

  return <PerformanceDashboard projects={projects} />;
}
