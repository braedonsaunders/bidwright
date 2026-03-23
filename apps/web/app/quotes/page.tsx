"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { QuotesList } from "@/components/quotes-list";
import { getProjects, type ProjectListItem } from "@/lib/api";

export default function QuotesPage() {
  const [projects, setProjects] = useState<ProjectListItem[]>([]);

  useEffect(() => {
    getProjects().then(setProjects).catch(() => {});
  }, []);

  return (
    <AppShell projects={projects}>
      <QuotesList projects={projects} />
    </AppShell>
  );
}
