"use client";

import { useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { updateProfile } from "@/lib/api";
import { Button, Card, CardBody, CardHeader, CardTitle, Input, Label, Badge } from "@/components/ui";
import { AppShell } from "@/components/app-shell";

export default function ProfilePage() {
  const { user, organization, isSuperAdmin, refreshUser } = useAuth();

  const [name, setName] = useState(user?.name ?? "");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  async function handleSaveName(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      await updateProfile({ name });
      await refreshUser();
      setMessage({ type: "success", text: "Name updated." });
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "Update failed" });
    } finally {
      setSaving(false);
    }
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      setMessage({ type: "error", text: "Passwords do not match." });
      return;
    }
    if (newPassword.length < 8) {
      setMessage({ type: "error", text: "Password must be at least 8 characters." });
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      await updateProfile({ currentPassword, newPassword });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setMessage({ type: "success", text: "Password changed." });
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "Update failed" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-xl space-y-6">
        <h1 className="text-xl font-bold text-fg">Profile</h1>

        {message && (
          <div className={`rounded-lg border px-4 py-2 text-sm ${
            message.type === "success"
              ? "border-green-500/30 bg-green-500/10 text-green-600"
              : "border-danger/30 bg-danger/10 text-danger"
          }`}>
            {message.text}
          </div>
        )}

        {/* Account info */}
        <Card>
          <CardHeader>
            <CardTitle>Account</CardTitle>
          </CardHeader>
          <CardBody>
            <div className="space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-fg/50">Email</span>
                <span className="text-fg font-medium">{user?.email}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-fg/50">Role</span>
                <Badge tone={user?.role === "admin" ? "info" : "default"}>{user?.role}</Badge>
              </div>
              {organization && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-fg/50">Organization</span>
                  <span className="text-fg font-medium">{organization.name}</span>
                </div>
              )}
              {isSuperAdmin && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-fg/50">Access</span>
                  <Badge tone="warning">Super Admin</Badge>
                </div>
              )}
            </div>
          </CardBody>
        </Card>

        {/* Edit name */}
        <Card>
          <CardHeader>
            <CardTitle>Display Name</CardTitle>
          </CardHeader>
          <CardBody>
            <form onSubmit={handleSaveName} className="flex items-end gap-3">
              <div className="flex-1">
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your name"
                />
              </div>
              <Button type="submit" variant="accent" disabled={saving || name === user?.name}>
                {saving ? "Saving..." : "Save"}
              </Button>
            </form>
          </CardBody>
        </Card>

        {/* Change password */}
        <Card>
          <CardHeader>
            <CardTitle>Change Password</CardTitle>
          </CardHeader>
          <CardBody>
            <form onSubmit={handleChangePassword} className="space-y-3">
              <div>
                <Label htmlFor="currentPassword">Current Password</Label>
                <Input
                  id="currentPassword"
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="Enter current password"
                  autoComplete="current-password"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="newPassword">New Password</Label>
                  <Input
                    id="newPassword"
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Min 8 characters"
                    autoComplete="new-password"
                  />
                </div>
                <div>
                  <Label htmlFor="confirmPassword">Confirm</Label>
                  <Input
                    id="confirmPassword"
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Confirm"
                    autoComplete="new-password"
                  />
                </div>
              </div>
              <Button
                type="submit"
                variant="accent"
                disabled={saving || !currentPassword || !newPassword}
              >
                {saving ? "Changing..." : "Change Password"}
              </Button>
            </form>
          </CardBody>
        </Card>
      </div>
    </AppShell>
  );
}
