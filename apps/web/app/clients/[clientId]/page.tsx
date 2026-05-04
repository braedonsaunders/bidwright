"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { ClientDetail } from "@/components/client-detail";
import {
  getCustomer,
  getProjectsWithFilters,
  type CustomerWithContacts,
  type OrgDepartment,
  type OrgUser,
  type ProjectListItem,
} from "@/lib/api";

export default function ClientDetailPage() {
  const { clientId } = useParams<{ clientId: string }>();
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [users, setUsers] = useState<OrgUser[]>([]);
  const [departments, setDepartments] = useState<OrgDepartment[]>([]);
  const [customer, setCustomer] = useState<CustomerWithContacts | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!clientId) return;
    setLoading(true);
    const customerRequest = getCustomer(clientId).catch(() => null);

    Promise.allSettled([getProjectsWithFilters(), customerRequest])
      .then(([projectsResult, customerResult]) => {
        if (projectsResult.status === "fulfilled") {
          setProjects(projectsResult.value.projects);
          setUsers(projectsResult.value.users);
          setDepartments(projectsResult.value.departments);
        }
        if (customerResult.status === "fulfilled") setCustomer(customerResult.value);
      })
      .finally(() => setLoading(false));
  }, [clientId]);

  return (
    <AppShell projects={projects}>
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-accent border-t-transparent" />
        </div>
      ) : (
        <ClientDetail
          customer={customer}
          projects={projects}
          users={users}
          departments={departments}
        />
      )}
    </AppShell>
  );
}
