"use client";

import { useEffect, useState } from "react";

import { AppShell } from "@/components/app-shell";
import { LibraryPage } from "@/components/library-page";
import {
  getCatalogs,
  getProjects,
  listAssemblies,
  listDatasets,
  listPersonas,
  listKnowledgeBooks,
  listKnowledgeDocuments,
  listKnowledgeLibraryCabinets,
  listLaborUnitLibraries,
  listRateSchedules,
  type AssemblySummaryRecord,
  type CatalogSummary,
  type DatasetRecord,
  type EstimatorPersona,
  type KnowledgeBookRecord,
  type KnowledgeDocumentRecord,
  type KnowledgeLibraryCabinetRecord,
  type LaborUnitLibraryRecord,
  type ProjectListItem,
  type RateSchedule,
} from "@/lib/api";

export default function LibraryRoute() {
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [catalogs, setCatalogs] = useState<CatalogSummary[]>([]);
  const [rateSchedules, setRateSchedules] = useState<RateSchedule[]>([]);
  const [assemblies, setAssemblies] = useState<AssemblySummaryRecord[]>([]);
  const [knowledgeBooks, setKnowledgeBooks] = useState<KnowledgeBookRecord[]>([]);
  const [knowledgeDocuments, setKnowledgeDocuments] = useState<KnowledgeDocumentRecord[]>([]);
  const [knowledgeCabinets, setKnowledgeCabinets] = useState<KnowledgeLibraryCabinetRecord[]>([]);
  const [datasets, setDatasets] = useState<DatasetRecord[]>([]);
  const [laborUnitLibraries, setLaborUnitLibraries] = useState<LaborUnitLibraryRecord[]>([]);
  const [playbooks, setPlaybooks] = useState<EstimatorPersona[]>([]);

  useEffect(() => {
    Promise.allSettled([
      getProjects(),
      getCatalogs(),
      listRateSchedules(),
      listAssemblies(),
      listKnowledgeBooks(),
      listKnowledgeDocuments(),
      listKnowledgeLibraryCabinets(),
      listDatasets(),
      listLaborUnitLibraries(),
      listPersonas(),
    ]).then(([projectsR, catalogsR, ratesR, assembliesR, booksR, documentsR, cabinetsR, datasetsR, laborUnitsR, playbooksR]) => {
      if (projectsR.status === "fulfilled") setProjects(projectsR.value);
      if (catalogsR.status === "fulfilled") setCatalogs(catalogsR.value);
      if (ratesR.status === "fulfilled") setRateSchedules(ratesR.value);
      if (assembliesR.status === "fulfilled") setAssemblies(assembliesR.value);
      if (booksR.status === "fulfilled") setKnowledgeBooks(booksR.value);
      if (documentsR.status === "fulfilled") setKnowledgeDocuments(documentsR.value);
      if (cabinetsR.status === "fulfilled") setKnowledgeCabinets(cabinetsR.value);
      if (datasetsR.status === "fulfilled") setDatasets(datasetsR.value);
      if (laborUnitsR.status === "fulfilled") setLaborUnitLibraries(laborUnitsR.value);
      if (playbooksR.status === "fulfilled") setPlaybooks(playbooksR.value);
    });
  }, []);

  return (
    <AppShell projects={projects}>
      <LibraryPage
        catalogs={catalogs}
        rateSchedules={rateSchedules}
        assemblies={assemblies}
        knowledgeBooks={knowledgeBooks}
        knowledgeDocuments={knowledgeDocuments}
        knowledgeCabinets={knowledgeCabinets}
        datasets={datasets}
        laborUnitLibraries={laborUnitLibraries}
        playbooks={playbooks}
      />
    </AppShell>
  );
}
