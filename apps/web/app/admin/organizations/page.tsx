"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import {
  adminListOrganizations,
  adminCreateOrganization,
  adminDeleteOrganization,
  adminListOrgUsers,
  adminUpdateOrgLimits,
  adminCreateOrgUser,
  adminUpdateUser,
  adminDeleteUser,
  type AdminOrg,
  type AuthUser,
  type OrgLimits,
} from "@/lib/api";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Badge,
  ModalBackdrop,
  Select,
} from "@/components/ui";
import {
  Building2,
  ChevronDown,
  ChevronUp,
  Edit3,
  LogIn,
  Plus,
  Save,
  Settings,
  Trash2,
  UserPlus,
  Users,
  X,
} from "lucide-react";

export default function OrganizationsPage() {
  const { impersonate } = useAuth();
  const [orgs, setOrgs] = useState<AdminOrg[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [expandedOrg, setExpandedOrg] = useState<string | null>(null);
  const [expandedSection, setExpandedSection] = useState<"users" | "limits">("users");
  const [orgUsers, setOrgUsers] = useState<Record<string, AuthUser[]>>({});

  const fetchOrgs = useCallback(async () => {
    try {
      const data = await adminListOrganizations();
      setOrgs(data);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchOrgs(); }, [fetchOrgs]);

  const toggleOrg = useCallback(async (orgId: string, section: "users" | "limits") => {
    if (expandedOrg === orgId && expandedSection === section) {
      setExpandedOrg(null);
      return;
    }
    setExpandedOrg(orgId);
    setExpandedSection(section);
    if (section === "users" && !orgUsers[orgId]) {
      try {
        const users = await adminListOrgUsers(orgId);
        setOrgUsers((prev) => ({ ...prev, [orgId]: users }));
      } catch { /* ignore */ }
    }
  }, [expandedOrg, expandedSection, orgUsers]);

  const handleDelete = useCallback(async (orgId: string, orgName: string) => {
    if (!confirm(`Delete "${orgName}"? This permanently deletes all its data.`)) return;
    try {
      await adminDeleteOrganization(orgId);
      setOrgs((prev) => prev.filter((o) => o.id !== orgId));
    } catch { /* ignore */ }
  }, []);

  const refreshOrgUsers = useCallback(async (orgId: string) => {
    try {
      const users = await adminListOrgUsers(orgId);
      setOrgUsers((prev) => ({ ...prev, [orgId]: users }));
    } catch { /* ignore */ }
  }, []);

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold text-fg">Organizations</h2>
        <Button variant="accent" size="sm" onClick={() => setShowCreate(true)}>
          <Plus className="mr-1.5 h-4 w-4" />
          New Organization
        </Button>
      </div>

      {loading ? (
        <div className="text-xs text-fg/40">Loading...</div>
      ) : orgs.length === 0 ? (
        <Card>
          <CardBody>
            <div className="py-8 text-center text-sm text-fg/40">
              No organizations yet. Create one to get started.
            </div>
          </CardBody>
        </Card>
      ) : (
        <div className="space-y-2">
          {orgs.map((org) => (
            <Card key={org.id}>
              <CardBody>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-panel2">
                      <Building2 className="h-4 w-4 text-fg/40" />
                    </div>
                    <div>
                      <div className="font-medium text-sm text-fg">{org.name}</div>
                      <div className="text-xs text-fg/40">
                        {org.slug} &middot; Created {new Date(org.createdAt).toLocaleDateString()}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-4 text-xs text-fg/40">
                    <span>{org.userCount}{org.limits.maxUsers > 0 ? `/${org.limits.maxUsers}` : ""} users</span>
                    <span>{org.projectCount}{org.limits.maxProjects > 0 ? `/${org.limits.maxProjects}` : ""} projects</span>
                    <div className="flex items-center gap-1.5">
                      <Button
                        variant={expandedOrg === org.id && expandedSection === "users" ? "accent" : "ghost"}
                        size="xs"
                        onClick={() => toggleOrg(org.id, "users")}
                      >
                        <Users className="mr-1 h-3 w-3" />
                        Users
                        {expandedOrg === org.id && expandedSection === "users"
                          ? <ChevronUp className="ml-0.5 h-3 w-3" />
                          : <ChevronDown className="ml-0.5 h-3 w-3" />}
                      </Button>
                      <Button
                        variant={expandedOrg === org.id && expandedSection === "limits" ? "accent" : "ghost"}
                        size="xs"
                        onClick={() => toggleOrg(org.id, "limits")}
                      >
                        <Settings className="mr-1 h-3 w-3" />
                        Limits
                      </Button>
                      <Button variant="accent" size="xs" onClick={() => impersonate(org.id)}>
                        <LogIn className="mr-1 h-3 w-3" />
                        Enter
                      </Button>
                      <Button variant="danger" size="xs" onClick={() => handleDelete(org.id, org.name)}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                </div>

                {expandedOrg === org.id && expandedSection === "users" && (
                  <OrgUsersSection
                    orgId={org.id}
                    users={orgUsers[org.id]}
                    onRefresh={() => { refreshOrgUsers(org.id); fetchOrgs(); }}
                  />
                )}

                {expandedOrg === org.id && expandedSection === "limits" && (
                  <OrgLimitsSection
                    orgId={org.id}
                    limits={org.limits}
                    onSaved={(newLimits) => {
                      setOrgs((prev) =>
                        prev.map((o) => (o.id === org.id ? { ...o, limits: newLimits } : o))
                      );
                    }}
                  />
                )}
              </CardBody>
            </Card>
          ))}
        </div>
      )}

      {showCreate && (
        <CreateOrgModal
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); fetchOrgs(); }}
        />
      )}
    </div>
  );
}

// ── Org Users Section ─────────────────────────────────────────────────

function OrgUsersSection({
  orgId,
  users,
  onRefresh,
}: {
  orgId: string;
  users?: AuthUser[];
  onRefresh: () => void;
}) {
  const [showAddUser, setShowAddUser] = useState(false);
  const [editingUser, setEditingUser] = useState<string | null>(null);
  const [editRole, setEditRole] = useState("");

  const handleToggleActive = useCallback(async (user: AuthUser) => {
    try {
      await adminUpdateUser(user.id, { active: !user.active });
      onRefresh();
    } catch { /* ignore */ }
  }, [onRefresh]);

  const handleRoleChange = useCallback(async (userId: string) => {
    try {
      await adminUpdateUser(userId, { role: editRole });
      setEditingUser(null);
      onRefresh();
    } catch { /* ignore */ }
  }, [editRole, onRefresh]);

  const handleDeleteUser = useCallback(async (user: AuthUser) => {
    if (!confirm(`Remove ${user.name} (${user.email}) from this organization?`)) return;
    try {
      await adminDeleteUser(user.id);
      onRefresh();
    } catch { /* ignore */ }
  }, [onRefresh]);

  return (
    <div className="mt-3 border-t border-line pt-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-fg/50">Organization Users</span>
        <Button variant="ghost" size="xs" onClick={() => setShowAddUser(!showAddUser)}>
          <UserPlus className="mr-1 h-3 w-3" />
          Add User
        </Button>
      </div>

      {showAddUser && (
        <AddUserForm
          orgId={orgId}
          onCreated={() => { setShowAddUser(false); onRefresh(); }}
          onCancel={() => setShowAddUser(false)}
        />
      )}

      {!users ? (
        <div className="text-xs text-fg/40">Loading users...</div>
      ) : users.length === 0 ? (
        <div className="text-xs text-fg/40">No users.</div>
      ) : (
        <table className="w-full text-xs">
          <thead>
            <tr className="text-fg/30 border-b border-line">
              <th className="text-left py-1.5 font-medium">Name</th>
              <th className="text-left py-1.5 font-medium">Email</th>
              <th className="text-left py-1.5 font-medium">Role</th>
              <th className="text-left py-1.5 font-medium">Status</th>
              <th className="text-left py-1.5 font-medium">Last Login</th>
              <th className="text-right py-1.5 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b border-line/50">
                <td className="py-1.5 text-fg">{u.name}</td>
                <td className="py-1.5 text-fg/60">{u.email}</td>
                <td className="py-1.5">
                  {editingUser === u.id ? (
                    <div className="flex items-center gap-1">
                      <Select
                        size="xs"
                        className="w-28"
                        value={editRole}
                        onValueChange={setEditRole}
                        options={[
                          { value: "admin", label: "admin" },
                          { value: "estimator", label: "estimator" },
                          { value: "viewer", label: "viewer" },
                        ]}
                      />
                      <button onClick={() => handleRoleChange(u.id)} className="text-accent hover:text-accent/80">
                        <Save className="h-3 w-3" />
                      </button>
                      <button onClick={() => setEditingUser(null)} className="text-fg/30 hover:text-fg/60">
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => { setEditingUser(u.id); setEditRole(u.role); }}
                      className="group flex items-center gap-1"
                    >
                      <Badge tone={u.role === "admin" ? "info" : "default"} className="text-[10px]">
                        {u.role}
                      </Badge>
                      <Edit3 className="h-2.5 w-2.5 text-fg/20 opacity-0 group-hover:opacity-100 transition-opacity" />
                    </button>
                  )}
                </td>
                <td className="py-1.5">
                  <button onClick={() => handleToggleActive(u)}>
                    <Badge tone={u.active ? "success" : "danger"} className="text-[10px] cursor-pointer hover:opacity-80">
                      {u.active ? "Active" : "Inactive"}
                    </Badge>
                  </button>
                </td>
                <td className="py-1.5 text-fg/40">
                  {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleDateString() : "Never"}
                </td>
                <td className="py-1.5 text-right">
                  <Button variant="danger" size="xs" onClick={() => handleDeleteUser(u)}>
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ── Add User Form ─────────────────────────────────────────────────────

function AddUserForm({
  orgId,
  onCreated,
  onCancel,
}: {
  orgId: string;
  onCreated: () => void;
  onCancel: () => void;
}) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState("estimator");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await adminCreateOrgUser(orgId, { email, name, role, password: password || undefined });
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create user");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mb-3 rounded-lg border border-line bg-panel2/30 p-3">
      {error && (
        <div className="mb-2 rounded border border-danger/30 bg-danger/10 px-3 py-1.5 text-[11px] text-danger">
          {error}
        </div>
      )}
      <div className="grid grid-cols-4 gap-2">
        <Input
          placeholder="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="text-xs h-8"
          required
        />
        <Input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="text-xs h-8"
          required
        />
        <Select
          size="sm"
          value={role}
          onValueChange={setRole}
          options={[
            { value: "admin", label: "Admin" },
            { value: "estimator", label: "Estimator" },
            { value: "viewer", label: "Viewer" },
          ]}
        />
        <Input
          type="password"
          placeholder="Password (optional)"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="text-xs h-8"
        />
      </div>
      <div className="flex justify-end gap-2 mt-2">
        <Button variant="ghost" size="xs" type="button" onClick={onCancel}>Cancel</Button>
        <Button variant="accent" size="xs" type="submit" disabled={loading || !name.trim() || !email.trim()}>
          {loading ? "Adding..." : "Add User"}
        </Button>
      </div>
    </form>
  );
}

// ── Org Limits Section ────────────────────────────────────────────────

function OrgLimitsSection({
  orgId,
  limits,
  onSaved,
}: {
  orgId: string;
  limits: OrgLimits;
  onSaved: (limits: OrgLimits) => void;
}) {
  const [maxUsers, setMaxUsers] = useState(limits.maxUsers);
  const [maxProjects, setMaxProjects] = useState(limits.maxProjects);
  const [maxStorage, setMaxStorage] = useState(limits.maxStorage);
  const [maxKnowledgeBooks, setMaxKnowledgeBooks] = useState(limits.maxKnowledgeBooks);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const result = await adminUpdateOrgLimits(orgId, {
        maxUsers,
        maxProjects,
        maxStorage,
        maxKnowledgeBooks,
      });
      onSaved(result);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch { /* ignore */ }
    finally { setSaving(false); }
  }, [orgId, maxUsers, maxProjects, maxStorage, maxKnowledgeBooks, onSaved]);

  return (
    <div className="mt-3 border-t border-line pt-3">
      <span className="text-xs font-medium text-fg/50 mb-2 block">Organization Limits</span>
      <p className="text-[11px] text-fg/30 mb-3">Set to 0 for unlimited.</p>
      <div className="grid grid-cols-4 gap-3">
        <div>
          <Label className="text-[10px]">Max Users</Label>
          <Input
            type="number"
            min={0}
            value={maxUsers}
            onChange={(e) => setMaxUsers(Number(e.target.value))}
            className="text-xs h-8"
          />
        </div>
        <div>
          <Label className="text-[10px]">Max Projects</Label>
          <Input
            type="number"
            min={0}
            value={maxProjects}
            onChange={(e) => setMaxProjects(Number(e.target.value))}
            className="text-xs h-8"
          />
        </div>
        <div>
          <Label className="text-[10px]">Max Storage (MB)</Label>
          <Input
            type="number"
            min={0}
            value={maxStorage}
            onChange={(e) => setMaxStorage(Number(e.target.value))}
            className="text-xs h-8"
          />
        </div>
        <div>
          <Label className="text-[10px]">Max Knowledge Books</Label>
          <Input
            type="number"
            min={0}
            value={maxKnowledgeBooks}
            onChange={(e) => setMaxKnowledgeBooks(Number(e.target.value))}
            className="text-xs h-8"
          />
        </div>
      </div>
      <div className="flex items-center gap-2 mt-3">
        <Button variant="accent" size="xs" onClick={handleSave} disabled={saving}>
          <Save className="mr-1 h-3 w-3" />
          {saving ? "Saving..." : "Save Limits"}
        </Button>
        {saved && <span className="text-[10px] text-success">Saved!</span>}
      </div>
    </div>
  );
}

// ── Create Org Modal ──────────────────────────────────────────────────

function CreateOrgModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [adminEmail, setAdminEmail] = useState("");
  const [adminName, setAdminName] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleNameChange = useCallback((value: string) => {
    setName(value);
    if (!slugEdited) {
      setSlug(value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""));
    }
  }, [slugEdited]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await adminCreateOrganization({
        name,
        slug: slug || undefined,
        adminEmail: adminEmail || undefined,
        adminName: adminName || undefined,
        adminPassword: adminPassword || undefined,
      });
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create org");
    } finally {
      setLoading(false);
    }
  }

  return (
    <ModalBackdrop open={true} onClose={onClose} size="md">
      <CardHeader>
        <CardTitle>Create Organization</CardTitle>
      </CardHeader>
      <CardBody>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="rounded-lg border border-danger/30 bg-danger/10 px-4 py-2 text-sm text-danger">
              {error}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="orgName">Organization Name</Label>
              <Input id="orgName" value={name} onChange={(e) => handleNameChange(e.target.value)} placeholder="Acme Corp" required autoFocus />
            </div>
            <div>
              <Label htmlFor="orgSlug">Slug</Label>
              <Input id="orgSlug" value={slug} onChange={(e) => { setSlug(e.target.value); setSlugEdited(true); }} placeholder="acme-corp" />
            </div>
          </div>
          <div className="border-t border-line pt-3">
            <p className="text-xs text-fg/40 mb-3">Admin User (optional)</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="adminName">Name</Label>
                <Input id="adminName" value={adminName} onChange={(e) => setAdminName(e.target.value)} placeholder="Jane Smith" />
              </div>
              <div>
                <Label htmlFor="adminEmail">Email</Label>
                <Input id="adminEmail" type="email" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} placeholder="jane@acme.com" />
              </div>
            </div>
            <div className="mt-3">
              <Label htmlFor="adminPassword">Password</Label>
              <Input id="adminPassword" type="password" value={adminPassword} onChange={(e) => setAdminPassword(e.target.value)} placeholder="Optional" />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" type="button" onClick={onClose}>Cancel</Button>
            <Button variant="accent" type="submit" disabled={loading || !name.trim()}>
              {loading ? "Creating..." : "Create"}
            </Button>
          </div>
        </form>
      </CardBody>
    </ModalBackdrop>
  );
}
