"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import {
  adminCreateOrganization,
  adminCreateOrgUser,
  adminDeleteOrganization,
  adminDeleteUser,
  adminListOrganizations,
  adminListOrgUsers,
  adminUpdateOrganization,
  adminUpdateOrgLimits,
  adminUpdateUser,
  seedSampleData,
  type AdminOrg,
  type AuthUser,
  type OrgLimits,
} from "@/lib/api";
import {
  Badge,
  Button,
  Drawer,
  EmptyState,
  Input,
  Label,
  PageHeader,
  RecordList,
  type RecordColumn,
  SearchSelect,
  SubtabNav,
} from "@braedonsaunders/appkit-ui";
import {
  Building2,
  ExternalLink,
  Loader2,
  Plus,
  Save,
  Trash2,
  UserPlus,
} from "lucide-react";

type OrganizationTab = "overview" | "users" | "limits";

function formatDate(value: string | null) {
  if (!value) return "Never";
  return new Intl.DateTimeFormat("en-CA", { dateStyle: "medium" }).format(new Date(value));
}

export default function OrganizationsPage() {
  const { impersonate } = useAuth();
  const [orgs, setOrgs] = useState<AdminOrg[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedTab, setSelectedTab] = useState<OrganizationTab>("overview");
  const [orgUsers, setOrgUsers] = useState<Record<string, AuthUser[]>>({});
  const [usersLoading, setUsersLoading] = useState(false);

  const selectedOrg = orgs.find((org) => org.id === selectedId) ?? null;

  const fetchOrgs = useCallback(async () => {
    setLoading(true);
    try {
      setOrgs(await adminListOrganizations());
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshOrgUsers = useCallback(async (orgId: string) => {
    setUsersLoading(true);
    try {
      const users = await adminListOrgUsers(orgId);
      setOrgUsers((current) => ({ ...current, [orgId]: users }));
    } finally {
      setUsersLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchOrgs();
  }, [fetchOrgs]);

  const openOrganization = useCallback((org: AdminOrg) => {
    setSelectedId(org.id);
    setSelectedTab("overview");
    if (!orgUsers[org.id]) void refreshOrgUsers(org.id);
  }, [orgUsers, refreshOrgUsers]);

  const filteredOrgs = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return orgs;
    return orgs.filter((org) => [org.name, org.slug].some((value) => value.toLowerCase().includes(query)));
  }, [orgs, search]);

  const columns = useMemo<RecordColumn<AdminOrg>[]>(() => [
    {
      key: "name",
      label: "Organization",
      width: "32%",
      render: (org) => (
        <div className="min-w-0">
          <div className="truncate font-medium text-fg">{org.name}</div>
          <div className="truncate text-xs text-fg-muted">{org.slug}</div>
        </div>
      ),
    },
    {
      key: "userCount",
      label: "Users",
      kind: "amount",
      format: (value, org) => `${Number(value).toLocaleString()}${org.limits.maxUsers > 0 ? ` / ${org.limits.maxUsers.toLocaleString()}` : ""}`,
    },
    {
      key: "projectCount",
      label: "Projects",
      kind: "amount",
      format: (value, org) => `${Number(value).toLocaleString()}${org.limits.maxProjects > 0 ? ` / ${org.limits.maxProjects.toLocaleString()}` : ""}`,
    },
    {
      key: "limits",
      label: "Capacity",
      render: (org) => (
        org.limits.maxUsers > 0 || org.limits.maxProjects > 0 ? (
          <Badge variant="warning">Limited</Badge>
        ) : (
          <Badge variant="secondary">Unlimited</Badge>
        )
      ),
    },
    {
      key: "createdAt",
      label: "Created",
      format: (value) => formatDate(String(value)),
    },
  ], []);

  return (
    <>
      <div className="space-y-5">
        <PageHeader
          title="Organizations"
          description="Provision tenants, manage capacity, and enter organization workspaces."
          actions={(
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus className="size-4" /> New organization
            </Button>
          )}
        />

        {loading ? (
          <div className="flex items-center justify-center py-16 text-sm text-fg-muted">
            <Loader2 className="mr-2 size-4 animate-spin" /> Loading organizations…
          </div>
        ) : (
          <RecordList
            columns={columns}
            rows={filteredOrgs}
            getRowId={(org) => org.id}
            search={{ value: search, onChange: setSearch, placeholder: "Search organizations…" }}
            empty={{
              icon: <Building2 />,
              title: search ? "No organizations match this search" : "No organizations yet",
              description: search ? "Try a broader organization name or slug." : "Create the first tenant to get started.",
              action: search ? undefined : (
                <Button size="sm" onClick={() => setCreating(true)}>
                  <Plus className="size-4" /> New organization
                </Button>
              ),
            }}
            onRowClick={openOrganization}
          />
        )}
      </div>

      <CreateOrganizationDrawer
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={async () => {
          setCreating(false);
          await fetchOrgs();
        }}
      />

      <Drawer
        open={Boolean(selectedOrg)}
        onClose={() => setSelectedId(null)}
        size="xl"
        title={selectedOrg?.name ?? "Organization"}
        description={selectedOrg ? `${selectedOrg.slug} · Created ${formatDate(selectedOrg.createdAt)}` : undefined}
        subtabs={selectedOrg ? (
          <SubtabNav
            active={selectedTab}
            onSelect={(key) => setSelectedTab(key as OrganizationTab)}
            tabs={[
              { key: "overview", label: "Overview" },
              { key: "users", label: "Users", count: selectedOrg.userCount },
              { key: "limits", label: "Capacity" },
            ]}
          />
        ) : undefined}
        headerActions={selectedOrg ? (
          <Button size="sm" variant="outline" onClick={() => void impersonate(selectedOrg.id)}>
            <ExternalLink className="size-3.5" /> Enter workspace
          </Button>
        ) : undefined}
      >
        {selectedOrg && selectedTab === "overview" && (
          <OrganizationOverview
            org={selectedOrg}
            onSaved={async () => {
              await fetchOrgs();
            }}
            onDeleted={async () => {
              setSelectedId(null);
              await fetchOrgs();
            }}
          />
        )}
        {selectedOrg && selectedTab === "users" && (
          <OrganizationUsers
            orgId={selectedOrg.id}
            users={orgUsers[selectedOrg.id]}
            loading={usersLoading}
            onRefresh={async () => {
              await Promise.all([refreshOrgUsers(selectedOrg.id), fetchOrgs()]);
            }}
          />
        )}
        {selectedOrg && selectedTab === "limits" && (
          <OrganizationLimits
            key={`${selectedOrg.id}:${JSON.stringify(selectedOrg.limits)}`}
            orgId={selectedOrg.id}
            limits={selectedOrg.limits}
            onSaved={(limits) => {
              setOrgs((current) => current.map((org) => org.id === selectedOrg.id ? { ...org, limits } : org));
            }}
          />
        )}
      </Drawer>
    </>
  );
}

function OrganizationOverview({
  org,
  onSaved,
  onDeleted,
}: {
  org: AdminOrg;
  onSaved: () => Promise<void>;
  onDeleted: () => Promise<void>;
}) {
  const [name, setName] = useState(org.name);
  const [slug, setSlug] = useState(org.slug);
  const [saving, setSaving] = useState(false);
  const [busyAction, setBusyAction] = useState<"sample" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setName(org.name);
    setSlug(org.slug);
  }, [org.id, org.name, org.slug]);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await adminUpdateOrganization(org.id, { name, slug });
      await onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to update organization");
    } finally {
      setSaving(false);
    }
  }

  async function loadSampleData() {
    if (!confirm(`Load sample data into "${org.name}"?`)) return;
    setBusyAction("sample");
    try {
      await seedSampleData(org.id);
      await onSaved();
    } finally {
      setBusyAction(null);
    }
  }

  async function remove() {
    if (!confirm(`Delete "${org.name}"? This permanently deletes all its data.`)) return;
    setBusyAction("delete");
    try {
      await adminDeleteOrganization(org.id);
      await onDeleted();
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-3">
        <Metric label="Users" value={org.userCount.toLocaleString()} />
        <Metric label="Projects" value={org.projectCount.toLocaleString()} />
        <Metric label="Created" value={formatDate(org.createdAt)} />
      </div>

      {error && <div className="rounded-lg border border-danger/30 bg-danger-subtle px-3 py-2 text-sm text-danger">{error}</div>}

      <section className="space-y-4 rounded-xl border border-border bg-surface p-4">
        <div>
          <h3 className="text-sm font-semibold text-fg">Organization identity</h3>
          <p className="text-sm text-fg-muted">The tenant name and stable URL identifier.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="organization-name">Name</Label>
            <Input id="organization-name" value={name} onChange={(event) => setName(event.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="organization-slug">Slug</Label>
            <Input id="organization-slug" value={slug} onChange={(event) => setSlug(event.target.value)} />
          </div>
        </div>
        <div className="flex justify-end">
          <Button size="sm" onClick={() => void save()} disabled={saving || !name.trim() || !slug.trim()}>
            <Save className="size-3.5" /> {saving ? "Saving…" : "Save organization"}
          </Button>
        </div>
      </section>

      <section className="rounded-xl border border-border bg-surface p-4">
        <h3 className="text-sm font-semibold text-fg">Deployment actions</h3>
        <p className="mt-1 text-sm text-fg-muted">Load demonstration records or permanently remove this tenant.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => void loadSampleData()} disabled={busyAction !== null}>
            {busyAction === "sample" ? "Loading…" : "Load sample data"}
          </Button>
          <Button variant="destructive" size="sm" onClick={() => void remove()} disabled={busyAction !== null}>
            <Trash2 className="size-3.5" /> {busyAction === "delete" ? "Deleting…" : "Delete organization"}
          </Button>
        </div>
      </section>
    </div>
  );
}

function OrganizationUsers({
  orgId,
  users,
  loading,
  onRefresh,
}: {
  orgId: string;
  users?: AuthUser[];
  loading: boolean;
  onRefresh: () => Promise<void>;
}) {
  const [adding, setAdding] = useState(false);
  const [selectedUser, setSelectedUser] = useState<AuthUser | null>(null);

  const columns = useMemo<RecordColumn<AuthUser>[]>(() => [
    {
      key: "name",
      label: "User",
      render: (user) => (
        <div>
          <div className="font-medium text-fg">{user.name}</div>
          <div className="text-xs text-fg-muted">{user.email}</div>
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
    { key: "lastLoginAt", label: "Last login", format: (value) => formatDate(value ? String(value) : null) },
  ], []);

  if (loading && !users) {
    return <div className="flex items-center justify-center py-16 text-sm text-fg-muted"><Loader2 className="mr-2 size-4 animate-spin" /> Loading users…</div>;
  }

  return (
    <>
      <RecordList
        columns={columns}
        rows={users ?? []}
        getRowId={(user) => user.id}
        toolbarActions={(
          <Button size="sm" onClick={() => setAdding(true)}>
            <UserPlus className="size-3.5" /> Add user
          </Button>
        )}
        empty={{
          title: "No users in this organization",
          description: "Add the first person who can access this tenant.",
          action: <Button size="sm" onClick={() => setAdding(true)}><UserPlus className="size-3.5" /> Add user</Button>,
        }}
        onRowClick={setSelectedUser}
      />

      <AddUserDrawer open={adding} orgId={orgId} onClose={() => setAdding(false)} onCreated={async () => {
        setAdding(false);
        await onRefresh();
      }} />
      <UserDrawer user={selectedUser} onClose={() => setSelectedUser(null)} onSaved={async () => {
        setSelectedUser(null);
        await onRefresh();
      }} />
    </>
  );
}

function UserDrawer({ user, onClose, onSaved }: { user: AuthUser | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const [role, setRole] = useState("estimator");
  const [active, setActive] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user) return;
    setRole(user.role);
    setActive(user.active);
  }, [user]);

  async function save() {
    if (!user) return;
    setSaving(true);
    try {
      await adminUpdateUser(user.id, { role, active });
      await onSaved();
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!user || !confirm(`Remove ${user.name} (${user.email}) from this organization?`)) return;
    setSaving(true);
    try {
      await adminDeleteUser(user.id);
      await onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer
      open={Boolean(user)}
      onClose={onClose}
      stacked
      size="sm"
      title={user?.name ?? "User"}
      description={user?.email}
      footer={(
        <div className="flex w-full items-center justify-between">
          <Button variant="destructive" size="sm" onClick={() => void remove()} disabled={saving}>
            <Trash2 className="size-3.5" /> Remove
          </Button>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
            <Button size="sm" onClick={() => void save()} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
          </div>
        </div>
      )}
    >
      <div className="space-y-4">
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
    </Drawer>
  );
}

function AddUserDrawer({
  open,
  orgId,
  onClose,
  onCreated,
}: {
  open: boolean;
  orgId: string;
  onClose: () => void;
  onCreated: () => Promise<void>;
}) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState("estimator");
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setSaving(true);
    setError(null);
    try {
      await adminCreateOrgUser(orgId, { email, name, role, password: password || undefined });
      setEmail("");
      setName("");
      setRole("estimator");
      setPassword("");
      await onCreated();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to create user");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      stacked
      size="sm"
      title="Add user"
      description="Create a login identity in this organization."
      footer={(
        <div className="flex w-full justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={() => void create()} disabled={saving || !name.trim() || !email.trim()}>
            {saving ? "Adding…" : "Add user"}
          </Button>
        </div>
      )}
    >
      <div className="space-y-4">
        {error && <div className="rounded-lg border border-danger/30 bg-danger-subtle px-3 py-2 text-sm text-danger">{error}</div>}
        <div className="space-y-1.5"><Label>Name</Label><Input value={name} onChange={(event) => setName(event.target.value)} autoFocus /></div>
        <div className="space-y-1.5"><Label>Email</Label><Input type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></div>
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
        <div className="space-y-1.5"><Label>Password</Label><Input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Optional" /></div>
      </div>
    </Drawer>
  );
}

function OrganizationLimits({
  orgId,
  limits,
  onSaved,
}: {
  orgId: string;
  limits: OrgLimits;
  onSaved: (limits: OrgLimits) => void;
}) {
  const [values, setValues] = useState(limits);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      onSaved(await adminUpdateOrgLimits(orgId, values));
    } finally {
      setSaving(false);
    }
  }

  const fields: Array<{ key: keyof OrgLimits; label: string }> = [
    { key: "maxUsers", label: "Maximum users" },
    { key: "maxProjects", label: "Maximum projects" },
    { key: "maxStorage", label: "Maximum storage (MB)" },
    { key: "maxKnowledgeBooks", label: "Maximum knowledge books" },
  ];

  return (
    <section className="space-y-4 rounded-xl border border-border bg-surface p-4">
      <div>
        <h3 className="text-sm font-semibold text-fg">Organization capacity</h3>
        <p className="text-sm text-fg-muted">Use 0 for unlimited capacity.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {fields.map((field) => (
          <div key={field.key} className="space-y-1.5">
            <Label htmlFor={field.key}>{field.label}</Label>
            <Input
              id={field.key}
              type="number"
              min={0}
              value={values[field.key]}
              onChange={(event) => setValues((current) => ({ ...current, [field.key]: Number(event.target.value) }))}
            />
          </div>
        ))}
      </div>
      <div className="flex justify-end">
        <Button size="sm" onClick={() => void save()} disabled={saving}>
          <Save className="size-3.5" /> {saving ? "Saving…" : "Save capacity"}
        </Button>
      </div>
    </section>
  );
}

function CreateOrganizationDrawer({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [adminEmail, setAdminEmail] = useState("");
  const [adminName, setAdminName] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function changeName(value: string) {
    setName(value);
    if (!slugEdited) setSlug(value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""));
  }

  async function create() {
    setSaving(true);
    setError(null);
    try {
      await adminCreateOrganization({
        name,
        slug: slug || undefined,
        adminEmail: adminEmail || undefined,
        adminName: adminName || undefined,
        adminPassword: adminPassword || undefined,
      });
      setName("");
      setSlug("");
      setSlugEdited(false);
      setAdminEmail("");
      setAdminName("");
      setAdminPassword("");
      await onCreated();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to create organization");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      size="md"
      title="Create organization"
      description="Provision a new isolated Bidwright tenant."
      footer={(
        <div className="flex w-full justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={() => void create()} disabled={saving || !name.trim()}>
            {saving ? "Creating…" : "Create organization"}
          </Button>
        </div>
      )}
    >
      <div className="space-y-5">
        {error && <div className="rounded-lg border border-danger/30 bg-danger-subtle px-3 py-2 text-sm text-danger">{error}</div>}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="new-organization-name">Organization name</Label>
            <Input id="new-organization-name" value={name} onChange={(event) => changeName(event.target.value)} autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-organization-slug">Slug</Label>
            <Input id="new-organization-slug" value={slug} onChange={(event) => { setSlug(event.target.value); setSlugEdited(true); }} />
          </div>
        </div>
        <div className="space-y-4 border-t border-border pt-5">
          <div>
            <h3 className="text-sm font-semibold text-fg">Initial administrator</h3>
            <p className="text-sm text-fg-muted">Optional. You can add people later from the organization drawer.</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5"><Label>Name</Label><Input value={adminName} onChange={(event) => setAdminName(event.target.value)} /></div>
            <div className="space-y-1.5"><Label>Email</Label><Input type="email" value={adminEmail} onChange={(event) => setAdminEmail(event.target.value)} /></div>
          </div>
          <div className="space-y-1.5"><Label>Password</Label><Input type="password" value={adminPassword} onChange={(event) => setAdminPassword(event.target.value)} placeholder="Optional" /></div>
        </div>
      </div>
    </Drawer>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-bg-subtle px-4 py-3">
      <div className="text-xs font-medium uppercase tracking-wide text-fg-subtle">{label}</div>
      <div className="mt-1 text-lg font-semibold text-fg">{value}</div>
    </div>
  );
}
