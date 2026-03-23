"use client";

import { useCallback, useEffect, useState } from "react";
import {
  adminListOrganizations,
  adminListOrgUsers,
  adminUpdateUser,
  adminDeleteUser,
  adminMoveUser,
  type AdminOrg,
  type AuthUser,
} from "@/lib/api";
import {
  Button,
  Card,
  CardBody,
  Badge,
  Input,
  ModalBackdrop,
  CardHeader,
  CardTitle,
  Label,
} from "@/components/ui";
import { ArrowRight, Edit3, Save, Search, Trash2, X } from "lucide-react";

interface UserWithOrg extends AuthUser {
  orgName: string;
  orgSlug: string;
}

export default function AllUsersPage() {
  const [users, setUsers] = useState<UserWithOrg[]>([]);
  const [orgs, setOrgs] = useState<AdminOrg[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterOrg, setFilterOrg] = useState<string>("all");
  const [editingUser, setEditingUser] = useState<string | null>(null);
  const [editRole, setEditRole] = useState("");
  const [moveUser, setMoveUser] = useState<UserWithOrg | null>(null);

  const fetchAll = useCallback(async () => {
    try {
      const orgsData = await adminListOrganizations();
      setOrgs(orgsData);
      const allUsers: UserWithOrg[] = [];
      for (const org of orgsData) {
        const orgUsers = await adminListOrgUsers(org.id);
        for (const u of orgUsers) {
          allUsers.push({ ...u, orgName: org.name, orgSlug: org.slug });
        }
      }
      setUsers(allUsers);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const filteredUsers = users.filter((u) => {
    const matchSearch = !search.trim() ||
      u.name.toLowerCase().includes(search.toLowerCase()) ||
      u.email.toLowerCase().includes(search.toLowerCase());
    const matchOrg = filterOrg === "all" || u.organizationId === filterOrg;
    return matchSearch && matchOrg;
  });

  const handleRoleChange = useCallback(async (userId: string) => {
    try {
      await adminUpdateUser(userId, { role: editRole });
      setEditingUser(null);
      setUsers((prev) =>
        prev.map((u) => (u.id === userId ? { ...u, role: editRole as AuthUser["role"] } : u))
      );
    } catch { /* ignore */ }
  }, [editRole]);

  const handleToggleActive = useCallback(async (user: UserWithOrg) => {
    try {
      await adminUpdateUser(user.id, { active: !user.active });
      setUsers((prev) =>
        prev.map((u) => (u.id === user.id ? { ...u, active: !u.active } : u))
      );
    } catch { /* ignore */ }
  }, []);

  const handleDeleteUser = useCallback(async (user: UserWithOrg) => {
    if (!confirm(`Delete ${user.name} (${user.email}) from ${user.orgName}? This is permanent.`)) return;
    try {
      await adminDeleteUser(user.id);
      setUsers((prev) => prev.filter((u) => u.id !== user.id));
    } catch { /* ignore */ }
  }, []);

  const handleMoveUser = useCallback(async (userId: string, targetOrgId: string) => {
    try {
      await adminMoveUser(userId, targetOrgId);
      setMoveUser(null);
      fetchAll();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to move user");
    }
  }, [fetchAll]);

  return (
    <div className="p-6">
      <h2 className="text-xl font-bold text-fg mb-4">All Users</h2>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg/25" />
          <Input
            className="h-8 pl-8 text-xs"
            placeholder="Search by name or email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select
          className="rounded-lg border border-line bg-panel px-3 py-1.5 text-xs text-fg"
          value={filterOrg}
          onChange={(e) => setFilterOrg(e.target.value)}
        >
          <option value="all">All Organizations</option>
          {orgs.map((org) => (
            <option key={org.id} value={org.id}>{org.name}</option>
          ))}
        </select>
        <span className="text-xs text-fg/40">{filteredUsers.length} users</span>
      </div>

      {loading ? (
        <div className="text-xs text-fg/40">Loading...</div>
      ) : users.length === 0 ? (
        <Card>
          <CardBody>
            <div className="py-8 text-center text-sm text-fg/40">No users found.</div>
          </CardBody>
        </Card>
      ) : (
        <Card>
          <CardBody className="p-0">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-fg/30 border-b border-line">
                  <th className="text-left px-4 py-2.5 font-medium">Name</th>
                  <th className="text-left px-4 py-2.5 font-medium">Email</th>
                  <th className="text-left px-4 py-2.5 font-medium">Organization</th>
                  <th className="text-left px-4 py-2.5 font-medium">Role</th>
                  <th className="text-left px-4 py-2.5 font-medium">Status</th>
                  <th className="text-left px-4 py-2.5 font-medium">Last Login</th>
                  <th className="text-right px-4 py-2.5 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map((u) => (
                  <tr key={u.id} className="border-b border-line/50 hover:bg-panel2/30">
                    <td className="px-4 py-2 text-fg font-medium">{u.name}</td>
                    <td className="px-4 py-2 text-fg/60">{u.email}</td>
                    <td className="px-4 py-2">
                      <span className="text-fg/60">{u.orgName}</span>
                      <span className="text-fg/20 ml-1">({u.orgSlug})</span>
                    </td>
                    <td className="px-4 py-2">
                      {editingUser === u.id ? (
                        <div className="flex items-center gap-1">
                          <select
                            className="rounded border border-line bg-panel px-1.5 py-0.5 text-[10px] text-fg"
                            value={editRole}
                            onChange={(e) => setEditRole(e.target.value)}
                          >
                            <option value="admin">admin</option>
                            <option value="estimator">estimator</option>
                            <option value="viewer">viewer</option>
                          </select>
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
                    <td className="px-4 py-2">
                      <button onClick={() => handleToggleActive(u)}>
                        <Badge tone={u.active ? "success" : "danger"} className="text-[10px] cursor-pointer hover:opacity-80">
                          {u.active ? "Active" : "Inactive"}
                        </Badge>
                      </button>
                    </td>
                    <td className="px-4 py-2 text-fg/40">
                      {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleDateString() : "Never"}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="xs" onClick={() => setMoveUser(u)} title="Move to another org">
                          <ArrowRight className="h-3 w-3" />
                        </Button>
                        <Button variant="danger" size="xs" onClick={() => handleDeleteUser(u)}>
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardBody>
        </Card>
      )}

      {moveUser && (
        <MoveUserModal
          user={moveUser}
          orgs={orgs}
          onMove={handleMoveUser}
          onClose={() => setMoveUser(null)}
        />
      )}
    </div>
  );
}

// ── Move User Modal ───────────────────────────────────────────────────

function MoveUserModal({
  user,
  orgs,
  onMove,
  onClose,
}: {
  user: UserWithOrg;
  orgs: AdminOrg[];
  onMove: (userId: string, targetOrgId: string) => Promise<void>;
  onClose: () => void;
}) {
  const [targetOrgId, setTargetOrgId] = useState("");
  const [loading, setLoading] = useState(false);

  const availableOrgs = orgs.filter((o) => o.id !== user.organizationId);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!targetOrgId) return;
    setLoading(true);
    await onMove(user.id, targetOrgId);
    setLoading(false);
  }

  return (
    <ModalBackdrop open={true} onClose={onClose} size="sm">
      <CardHeader>
        <CardTitle>Move User</CardTitle>
      </CardHeader>
      <CardBody>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="text-sm text-fg/60">
            Move <strong className="text-fg">{user.name}</strong> ({user.email})
            from <strong className="text-fg">{user.orgName}</strong> to:
          </div>
          <div>
            <Label>Target Organization</Label>
            <select
              className="w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm text-fg"
              value={targetOrgId}
              onChange={(e) => setTargetOrgId(e.target.value)}
              required
            >
              <option value="">Select organization...</option>
              {availableOrgs.map((org) => (
                <option key={org.id} value={org.id}>{org.name} ({org.slug})</option>
              ))}
            </select>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" type="button" onClick={onClose}>Cancel</Button>
            <Button variant="accent" type="submit" disabled={loading || !targetOrgId}>
              {loading ? "Moving..." : "Move User"}
            </Button>
          </div>
        </form>
      </CardBody>
    </ModalBackdrop>
  );
}
