"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { QuotesList } from "@/components/quotes-list";
import { getProjectsWithFilters, type ProjectListItem, type OrgUser, type OrgDepartment } from "@/lib/api";

export default function QuotesPage() {
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [users, setUsers] = useState<OrgUser[]>([]);
  const [departments, setDepartments] = useState<OrgDepartment[]>([]);

  useEffect(() => {
    getProjectsWithFilters()
      .then((res) => {
        setProjects(res.projects);
        setUsers(res.users);
        setDepartments(res.departments);
      })
      .catch(() => {});
  }, []);

  return (
    <AppShell projects={projects}>
      <QuotesList projects={projects} users={users} departments={departments} />
    </AppShell>
  );
}
