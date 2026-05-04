"use client";

import { Suspense, useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { SettingsPage } from "@/components/settings-page";
import {
  getProjects,
  listPlugins,
  listDatasets,
  type ProjectListItem,
  type DatasetRecord,
} from "@/lib/api";

export default function SettingsRoute() {
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [plugins, setPlugins] = useState<any[]>([]);
  const [datasets, setDatasets] = useState<DatasetRecord[]>([]);

  useEffect(() => {
    Promise.allSettled([
      getProjects(),
      listPlugins(),
      listDatasets(),
    ]).then(([projectsR, pluginsR, datasetsR]) => {
      if (projectsR.status === "fulfilled") setProjects(projectsR.value);
      if (pluginsR.status === "fulfilled") setPlugins(pluginsR.value);
      if (datasetsR.status === "fulfilled") setDatasets(datasetsR.value);
    });
  }, []);

  return (
    <AppShell projects={projects}>
      <Suspense fallback={<div className="px-6 py-10 text-sm text-fg/40">Loading settings...</div>}>
        <SettingsPage
          initialPlugins={plugins}
          initialDatasets={datasets}
        />
      </Suspense>
    </AppShell>
  );
}
