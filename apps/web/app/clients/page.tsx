"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { ClientsList } from "@/components/clients-list";
import {
  getCustomers,
  getProjectsWithFilters,
  type Customer,
  type ProjectListItem,
} from "@/lib/api";

export default function ClientsPage() {
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.allSettled([getProjectsWithFilters(), getCustomers()])
      .then(([projectsResult, customersResult]) => {
        if (projectsResult.status === "fulfilled") setProjects(projectsResult.value.projects);
        if (customersResult.status === "fulfilled") setCustomers(customersResult.value);
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <AppShell projects={projects}>
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-accent border-t-transparent" />
        </div>
      ) : (
        <ClientsList customers={customers} projects={projects} />
      )}
    </AppShell>
  );
}
