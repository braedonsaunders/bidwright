"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useAuth } from "@/components/auth-provider";
import { BidwrightLogo } from "@/components/brand-logo";
import { Button, Input, Label, Card, CardBody, CardHeader, CardTitle } from "@/components/ui";

export default function SignupPage() {
  const t = useTranslations("Auth.signup");
  const { signup } = useAuth();
  const [orgName, setOrgName] = useState("");
  const [orgSlug, setOrgSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleOrgNameChange = useCallback((value: string) => {
    setOrgName(value);
    if (!slugEdited) {
      setOrgSlug(value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""));
    }
  }, [slugEdited]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError(t("passwordMismatch"));
      return;
    }
    if (password.length < 8) {
      setError(t("passwordTooShort"));
      return;
    }

    setLoading(true);
    try {
      await signup({ orgName, orgSlug, email, name, password });
    } catch (err) {
      setError(err instanceof Error ? err.message : t("error"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg p-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <BidwrightLogo className="mx-auto h-24 w-auto max-w-[240px]" />
          <p className="mt-1 text-sm text-fg/40">{t("eyebrow")}</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>{t("title")}</CardTitle>
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
                  <Label htmlFor="orgName">{t("organizationName")}</Label>
                  <Input
                    id="orgName"
                    value={orgName}
                    onChange={(e) => handleOrgNameChange(e.target.value)}
                    placeholder={t("organizationNamePlaceholder")}
                    required
                    autoFocus
                  />
                </div>
                <div>
                  <Label htmlFor="orgSlug">{t("urlSlug")}</Label>
                  <Input
                    id="orgSlug"
                    value={orgSlug}
                    onChange={(e) => { setOrgSlug(e.target.value); setSlugEdited(true); }}
                    placeholder={t("urlSlugPlaceholder")}
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="name">{t("yourName")}</Label>
                  <Input
                    id="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={t("yourNamePlaceholder")}
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="email">{t("email")}</Label>
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder={t("emailPlaceholder")}
                    required
                    autoComplete="email"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="password">{t("password")}</Label>
                  <Input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={t("passwordPlaceholder")}
                    required
                    autoComplete="new-password"
                  />
                </div>
                <div>
                  <Label htmlFor="confirmPassword">{t("confirmPassword")}</Label>
                  <Input
                    id="confirmPassword"
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder={t("confirmPasswordPlaceholder")}
                    required
                    autoComplete="new-password"
                  />
                </div>
              </div>

              <Button
                type="submit"
                variant="accent"
                className="w-full"
                disabled={loading || !orgName.trim() || !email.trim() || !password.trim()}
              >
                {loading ? t("submitting") : t("submit")}
              </Button>
            </form>

            <div className="mt-4 border-t border-line pt-4 text-center">
              <Link href="/login" className="text-xs text-accent hover:underline">
                {t("signInLink")}
              </Link>
            </div>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
