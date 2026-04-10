"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { KnowledgePage } from "@/components/knowledge-page";
import {
  getProjects,
  listKnowledgeBooks,
  listKnowledgeLibraryCabinets,
  listDatasets,
  type ProjectListItem,
  type KnowledgeBookRecord,
  type KnowledgeLibraryCabinetRecord,
  type DatasetRecord,
} from "@/lib/api";

export default function KnowledgeRoute() {
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [books, setBooks] = useState<KnowledgeBookRecord[]>([]);
  const [cabinets, setCabinets] = useState<KnowledgeLibraryCabinetRecord[]>([]);
  const [datasets, setDatasets] = useState<DatasetRecord[]>([]);

  useEffect(() => {
    Promise.allSettled([getProjects(), listKnowledgeBooks(), listKnowledgeLibraryCabinets(), listDatasets()]).then(
      ([projectsResult, booksResult, cabinetsResult, datasetsResult]) => {
        if (projectsResult.status === "fulfilled") setProjects(projectsResult.value);
        if (booksResult.status === "fulfilled") setBooks(booksResult.value);
        if (cabinetsResult.status === "fulfilled") setCabinets(cabinetsResult.value);
        if (datasetsResult.status === "fulfilled") setDatasets(datasetsResult.value);
      },
    );
  }, []);

  return (
    <AppShell projects={projects}>
      <KnowledgePage initialBooks={books} initialCabinets={cabinets} initialDatasets={datasets} />
    </AppShell>
  );
}
