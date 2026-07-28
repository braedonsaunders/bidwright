"use client";

import { Suspense, useEffect, useState } from "react";
import { SettingsPage } from "@/components/settings-page";
import {
  listPlugins,
  listDatasets,
  type DatasetRecord,
} from "@/lib/api";

export default function SettingsRoute() {
  const [plugins, setPlugins] = useState<any[]>([]);
  const [datasets, setDatasets] = useState<DatasetRecord[]>([]);

  useEffect(() => {
    Promise.allSettled([
      listPlugins(),
      listDatasets(),
    ]).then(([pluginsR, datasetsR]) => {
      if (pluginsR.status === "fulfilled") setPlugins(pluginsR.value);
      if (datasetsR.status === "fulfilled") setDatasets(datasetsR.value);
    });
  }, []);

  return (
    <Suspense fallback={<div className="px-6 py-10 text-sm text-fg/40">Loading settings...</div>}>
      <SettingsPage
        initialPlugins={plugins}
        initialDatasets={datasets}
      />
    </Suspense>
  );
}
