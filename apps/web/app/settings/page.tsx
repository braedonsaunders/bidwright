"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { SettingsPage } from "@/components/settings-page";
import {
  getProjects,
  getCatalogs,
  listRateSchedules,
  listPlugins,
  listDatasets,
  type ProjectListItem,
  type CatalogSummary,
  type RateSchedule,
  type DatasetRecord,
} from "@/lib/api";

export default function SettingsRoute() {
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [catalogs, setCatalogs] = useState<CatalogSummary[]>([]);
  const [schedules, setSchedules] = useState<RateSchedule[]>([]);
  const [plugins, setPlugins] = useState<any[]>([]);
  const [datasets, setDatasets] = useState<DatasetRecord[]>([]);

  useEffect(() => {
    Promise.allSettled([
      getProjects(),
      getCatalogs(),
      listRateSchedules(),
      listPlugins(),
      listDatasets(),
    ]).then(([projectsR, catalogsR, schedulesR, pluginsR, datasetsR]) => {
      if (projectsR.status === "fulfilled") setProjects(projectsR.value);
      if (catalogsR.status === "fulfilled") setCatalogs(catalogsR.value);
      if (schedulesR.status === "fulfilled") setSchedules(schedulesR.value);
      if (pluginsR.status === "fulfilled") setPlugins(pluginsR.value);
      if (datasetsR.status === "fulfilled") setDatasets(datasetsR.value);
    });
  }, []);

  return (
    <AppShell projects={projects}>
      <SettingsPage
        initialCatalogs={catalogs}
        initialSchedules={schedules}
        initialPlugins={plugins}
        initialDatasets={datasets}
      />
    </AppShell>
  );
}
