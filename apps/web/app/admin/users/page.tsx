"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  adminDeleteUser,
  adminListOrganizations,
  adminListOrgUsers,
  adminMoveUser,
  adminUpdateUser,
  type AdminOrg,
  type AuthUser,
} from "@/lib/api";
import {
  Badge,
  Button,
  Drawer,
  Input,
  Label,
  PageHeader,
  RecordList,
  type RecordColumn,
  SearchSelect,
} from "@appkit/ui";
import { Loader2, Save, Trash2, Users } from "lucide-react";

interface UserWithOrg extends AuthUser {
  orgName: string;
  orgSlug: string;
}

function formatDate(value: string | null) {
  if (!value) return "Never";
  return new Intl.DateTimeFormat("en-CA", { dateStyle: "medium" }).format(new Date(value));
}

export default function AllUsersPage() {
  const [users, setUsers] = useState<UserWithOrg[]>([]);
  const [orgs, setOrgs] = useState<AdminOrg[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterOrg, setFilterOrg] = useState("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selectedUser = users.find((user) => user.id === selectedId) ?? null;

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const organizations = await adminListOrganizations();
      setOrgs(organizations);
      const grouped = await Promise.all(organizations.map(async (org) => {
        const orgUsers = await adminListOrgUsers(org.id);
        return orgUsers.map((user) => ({ ...user, orgName: org.name, orgSlug: org.slug }));
      }));
      setUsers(grouped.flat());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  const filteredUsers = useMemo(() => {
    const query = search.trim().toLowerCase();
    return users.filter((user) => {
      if (filterOrg !== "all" && user.organizationId !== filterOrg) return false;
      if (!query) return true;
      return [user.name, user.email, user.orgName, user.orgSlug, user.role]
        .some((value) => value.toLowerCase().includes(query));
    });
  }, [filterOrg, search, users]);

  const columns = useMemo<RecordColumn<UserWithOrg>[]>(() => [
    {
      key: "name",
      label: "User",
      width: "28%",
      render: (user) => (
        <div className="min-w-0">
          <div className="truncate font-medium text-fg">{user.name}</div>
          <div className="truncate text-xs text-fg-muted">{user.email}</div>
        </div>
      ),
    },
    {
      key: "orgName",
      label: "Organization",
      width: "24%",
      render: (user) => (
        <div className="min-w-0">
          <div className="truncate text-fg">{user.orgName}</div>
          <div className="truncate text-xs text-fg-muted">{user.orgSlug}</div>
        </div>
      ),
    },
    {
      key: "role",
      label: "Role",
      render: (user) => <Badge variant={user.role === "admin" ? "info" : "outline"}>{user.role}</Badge>,
    },
    {
      key: "active",
      label: "Status",
      render: (user) => <Badge variant={user.active ? "success" : "destructive"}>{user.active ? "Active" : "Inactive"}</Badge>,
    },
    {
      key: "lastLoginAt",
      label: "Last login",
      format: (value) => formatDate(value ? String(value) : null),
    },
  ], []);

  return (
    <>
      <div className="space-y-5">
        <PageHeader
          title="People"
          description="Review every user across the deployment and manage account access."
        />

        {loading ? (
          <div className="flex items-center justify-center py-16 text-sm text-fg-muted">
            <Loader2 className="mr-2 size-4 animate-spin" /> Loading people…
          </div>
        ) : (
          <RecordList
            columns={columns}
            rows={filteredUsers}
            getRowId={(user) => user.id}
            search={{ value: search, onChange: setSearch, placeholder: "Search people, email, organization, or role…" }}
            filters={(
              <SearchSelect
                className="w-56"
                value={filterOrg}
                onChange={setFilterOrg}
                searchable
                options={[
                  { value: "all", label: "All organizations" },
                  ...orgs.map((org) => ({ value: org.id, label: org.name })),
                ]}
                ariaLabel="Filter by organization"
              />
            )}
            empty={{
              icon: <Users />,
              title: search || filterOrg !== "all" ? "No people match these filters" : "No people found",
              description: search || filterOrg !== "all"
                ? "Try a broader search or select all organizations."
                : "Users appear here after they are added to an organization.",
            }}
            onRowClick={(user) => setSelectedId(user.id)}
          />
        )}
      </div>

      <UserDetailDrawer
        user={selectedUser}
        organizations={orgs}
        onClose={() => setSelectedId(null)}
        onSaved={async () => {
          setSelectedId(null);
          await fetchAll();
        }}
      />
    </>
  );
}

function UserDetailDrawer({
  user,
  organizations,
  onClose,
  onSaved,
}: {
  user: UserWithOrg | null;
  organizations: AdminOrg[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("estimator");
  const [active, setActive] = useState(true);
  const [organizationId, setOrganizationId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    setName(user.name);
    setEmail(user.email);
    setRole(user.role);
    setActive(user.active);
    setOrganizationId(user.organizationId ?? "");
    setError(null);
  }, [user]);

  async function save() {
    if (!user) return;
    setSaving(true);
    setError(null);
    try {
      await adminUpdateUser(user.id, { name, email, role, active });
      if (organizationId !== user.organizationId) {
        await adminMoveUser(user.id, organizationId);
      }
      await onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to update user");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!user || !confirm(`Delete ${user.name} (${user.email}) from ${user.orgName}? This is permanent.`)) return;
    setSaving(true);
    setError(null);
    try {
      await adminDeleteUser(user.id);
      await onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to delete user");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer
      open={Boolean(user)}
      onClose={onClose}
      size="md"
      title={user?.name ?? "User"}
      description={user ? `${user.email} · ${user.orgName}` : undefined}
      footer={(
        <div className="flex w-full items-center justify-between gap-2">
          <Button variant="destructive" size="sm" onClick={() => void remove()} disabled={saving}>
            <Trash2 className="size-3.5" /> Delete
          </Button>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={onClose} disabled={saving}>Cancel</Button>
            <Button size="sm" onClick={() => void save()} disabled={saving || !name.trim() || !email.trim() || !organizationId}>
              <Save className="size-3.5" /> {saving ? "Saving…" : "Save user"}
            </Button>
          </div>
        </div>
      )}
    >
      <div className="space-y-5">
        {error && <div className="rounded-lg border border-danger/30 bg-danger-subtle px-3 py-2 text-sm text-danger">{error}</div>}

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="platform-user-name">Name</Label>
            <Input id="platform-user-name" value={name} onChange={(event) => setName(event.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="platform-user-email">Email</Label>
            <Input id="platform-user-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>Home organization</Label>
          <SearchSelect
            value={organizationId}
            onChange={setOrganizationId}
            searchable
            sheetTitle="Home organization"
            options={organizations.map((org) => ({ value: org.id, label: `${org.name} · ${org.slug}` }))}
          />
          {user && organizationId !== user.organizationId && (
            <p className="text-xs text-warning">Saving will move this user out of {user.orgName}.</p>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Role</Label>
            <SearchSelect
              value={role}
              onChange={setRole}
              searchable={false}
              options={[
                { value: "admin", label: "Admin" },
                { value: "estimator", label: "Estimator" },
                { value: "viewer", label: "Viewer" },
              ]}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Account status</Label>
            <SearchSelect
              value={active ? "active" : "inactive"}
              onChange={(value) => setActive(value === "active")}
              searchable={false}
              options={[
                { value: "active", label: "Active" },
                { value: "inactive", label: "Inactive" },
              ]}
            />
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Metric label="Created" value={formatDate(user?.createdAt ?? null)} />
          <Metric label="Last login" value={formatDate(user?.lastLoginAt ?? null)} />
        </div>
      </div>
    </Drawer>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-bg-subtle px-4 py-3">
      <div className="text-xs font-medium uppercase tracking-wide text-fg-subtle">{label}</div>
      <div className="mt-1 font-medium text-fg">{value}</div>
    </div>
  );
}
