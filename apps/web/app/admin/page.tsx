"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { adminListOrganizations, type AdminOrg } from "@/lib/api";
import { Card, CardBody } from "@/components/ui";
import { Building2, Users, FolderOpen } from "lucide-react";

export default function AdminOverviewPage() {
  const [orgs, setOrgs] = useState<AdminOrg[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    adminListOrganizations()
      .then(setOrgs)
      .catch((err) => { console.error("Failed to fetch orgs:", err); })
      .finally(() => setLoading(false));
  }, []);

  const totalUsers = orgs.reduce((s, o) => s + o.userCount, 0);
  const totalProjects = orgs.reduce((s, o) => s + o.projectCount, 0);

  return (
    <div className="p-6">
      <h2 className="text-xl font-bold text-fg mb-6">Overview</h2>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        <Link href="/admin/organizations">
          <Card>
            <CardBody>
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent/10">
                  <Building2 className="h-5 w-5 text-accent" />
                </div>
                <div>
                  <div className="text-2xl font-bold text-fg">{loading ? "..." : orgs.length}</div>
                  <div className="text-xs text-fg/40">Organizations</div>
                </div>
              </div>
            </CardBody>
          </Card>
        </Link>
        <Card>
          <CardBody>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/10">
                <Users className="h-5 w-5 text-blue-500" />
              </div>
              <div>
                <div className="text-2xl font-bold text-fg">{loading ? "..." : totalUsers}</div>
                <div className="text-xs text-fg/40">Total Users</div>
              </div>
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/10">
                <FolderOpen className="h-5 w-5 text-emerald-500" />
              </div>
              <div>
                <div className="text-2xl font-bold text-fg">{loading ? "..." : totalProjects}</div>
                <div className="text-xs text-fg/40">Total Projects</div>
              </div>
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500/10">
                <Building2 className="h-5 w-5 text-amber-500" />
              </div>
              <div>
                <div className="text-2xl font-bold text-fg">{loading ? "..." : orgs.filter((o) => o.limits.maxUsers > 0 || o.limits.maxProjects > 0).length}</div>
                <div className="text-xs text-fg/40">With Limits</div>
              </div>
            </div>
          </CardBody>
        </Card>
      </div>

      {/* Recent orgs */}
      <h3 className="text-sm font-semibold text-fg mb-3">Recent Organizations</h3>
      {loading ? (
        <div className="text-xs text-fg/40">Loading...</div>
      ) : orgs.length === 0 ? (
        <Card>
          <CardBody>
            <div className="py-6 text-center text-sm text-fg/40">
              No organizations yet.{" "}
              <Link href="/admin/organizations" className="text-accent hover:underline">
                Create one
              </Link>
            </div>
          </CardBody>
        </Card>
      ) : (
        <div className="space-y-2">
          {orgs.slice(0, 5).map((org) => (
            <Card key={org.id}>
              <CardBody>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium text-fg">{org.name}</div>
                    <div className="text-xs text-fg/40">
                      {org.slug} &middot; {org.userCount} users &middot; {org.projectCount} projects
                    </div>
                  </div>
                  <Link href="/admin/organizations" className="text-xs text-accent hover:underline">
                    Manage
                  </Link>
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
