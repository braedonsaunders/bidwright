"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AdminHub,
  Badge,
  type AdminHubGroup,
  type LinkRender,
} from "@braedonsaunders/appkit-ui";
import { Building2, Library, Users } from "lucide-react";
import { adminListOrganizations, type AdminOrg } from "@/lib/api";

const nextLink: LinkRender = ({ href, children, className, title, ariaCurrent }) => (
  <Link
    href={href}
    className={className}
    title={title}
    aria-current={ariaCurrent}
  >
    {children}
  </Link>
);

export default function AdminOverviewPage() {
  const [orgs, setOrgs] = useState<AdminOrg[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    adminListOrganizations()
      .then(setOrgs)
      .catch((error) => console.error("Failed to fetch organizations:", error))
      .finally(() => setLoading(false));
  }, []);

  const groups = useMemo<AdminHubGroup[]>(() => {
    const totalUsers = orgs.reduce((sum, org) => sum + org.userCount, 0);
    const count = (value: number) => (
      <Badge variant="secondary">{loading ? "…" : value.toLocaleString()}</Badge>
    );

    return [
      {
        label: "Platform",
        description: "Tenant-level operations across the Bidwright deployment.",
        accent: "teal",
        cards: [
          {
            href: "/admin/organizations",
            title: "Organizations",
            description: "Provision tenants, configure limits, and enter an organization.",
            icon: <Building2 />,
            badge: count(orgs.length),
            linkLabel: "Manage organizations",
          },
          {
            href: "/admin/users",
            title: "People",
            description: "Review users across every organization and manage account state.",
            icon: <Users />,
            badge: count(totalUsers),
            linkLabel: "Manage people",
          },
          {
            href: "/admin/catalogs",
            title: "Shared library",
            description: "Curate catalog templates and copy resources between tenants.",
            icon: <Library />,
            linkLabel: "Manage library",
          },
        ],
      },
    ];
  }, [loading, orgs]);

  return <AdminHub groups={groups} linkRender={nextLink} />;
}
