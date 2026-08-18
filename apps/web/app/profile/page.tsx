"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useAuth } from "@/components/auth-provider";
import { updateProfile } from "@/lib/api";
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Input,
  Label,
  SettingsRow,
  SettingsSection,
} from "@braedonsaunders/appkit-ui";

export default function ProfilePage() {
  const t = useTranslations("Profile");
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
      setMessage({ type: "success", text: t("messages.nameUpdated") });
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : t("messages.updateFailed") });
    } finally {
      setSaving(false);
    }
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      setMessage({ type: "error", text: t("messages.passwordMismatch") });
      return;
    }
    if (newPassword.length < 8) {
      setMessage({ type: "error", text: t("messages.passwordTooShort") });
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      await updateProfile({ currentPassword, newPassword });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setMessage({ type: "success", text: t("messages.passwordChanged") });
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : t("messages.updateFailed") });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
        {message && (
          <Alert variant={message.type === "success" ? "success" : "destructive"}>
            <AlertDescription>{message.text}</AlertDescription>
          </Alert>
        )}

        <SettingsSection title={t("account.title")} description="Your membership and organization context.">
          <SettingsRow title={t("account.email")} control={<span className="text-sm font-medium text-fg">{user?.email}</span>} />
          <SettingsRow
            title={t("account.role")}
            control={<Badge variant={user?.role === "admin" ? "info" : "secondary"}>{user?.role}</Badge>}
          />
          {organization ? (
            <SettingsRow
              title={t("account.organization")}
              control={<span className="text-sm font-medium text-fg">{organization.name}</span>}
            />
          ) : null}
          {isSuperAdmin ? (
            <SettingsRow
              title={t("account.access")}
              control={<Badge variant="warning">{t("account.superAdmin")}</Badge>}
            />
          ) : null}
        </SettingsSection>

        <SettingsSection title={t("displayName.title")} description="Choose the name shown to other members.">
          <SettingsRow title={t("displayName.name")} stacked>
            <form onSubmit={handleSaveName} className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="flex-1">
                <Label htmlFor="name">{t("displayName.name")}</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t("displayName.placeholder")}
                />
              </div>
              <Button type="submit" variant="default" disabled={saving || name === user?.name}>
                {saving ? t("actions.saving") : t("actions.save")}
              </Button>
            </form>
          </SettingsRow>
        </SettingsSection>

        <SettingsSection title={t("password.title")} description="Update the password used for direct Bidwright sign-in.">
          <SettingsRow title={t("password.title")} stacked>
            <form onSubmit={handleChangePassword} className="space-y-3">
              <div>
                <Label htmlFor="currentPassword">{t("password.current")}</Label>
                <Input
                  id="currentPassword"
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder={t("password.currentPlaceholder")}
                  autoComplete="current-password"
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="newPassword">{t("password.new")}</Label>
                  <Input
                    id="newPassword"
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder={t("password.newPlaceholder")}
                    autoComplete="new-password"
                  />
                </div>
                <div>
                  <Label htmlFor="confirmPassword">{t("password.confirm")}</Label>
                  <Input
                    id="confirmPassword"
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder={t("password.confirmPlaceholder")}
                    autoComplete="new-password"
                  />
                </div>
              </div>
              <Button
                type="submit"
                variant="default"
                disabled={saving || !currentPassword || !newPassword}
              >
                {saving ? t("actions.changing") : t("actions.changePassword")}
              </Button>
            </form>
          </SettingsRow>
        </SettingsSection>
    </div>
  );
}
