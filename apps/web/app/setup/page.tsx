"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth-provider";
import { initSetup, seedSampleData, seedEssentials } from "@/lib/api";
import { Button, Input, Label, Card, CardBody, CardHeader, CardTitle } from "@/components/ui";
import { Database, Loader2 } from "lucide-react";

type Step = "welcome" | "admin" | "org" | "seed" | "done";

const STEPS: Step[] = ["welcome", "admin", "org", "seed", "done"];

export default function SetupPage() {
  const router = useRouter();
  const { refreshUser } = useAuth();
  const [step, setStep] = useState<Step>("welcome");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Admin fields
  const [adminName, setAdminName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  // Org fields
  const [orgName, setOrgName] = useState("");
  const [orgSlug, setOrgSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);

  // Result from init
  const [setupResult, setSetupResult] = useState<{ token: string; organization: { id: string; name: string; slug: string } | null } | null>(null);

  // Seed state
  const [seeding, setSeeding] = useState(false);
  const [seedDone, setSeedDone] = useState(false);

  const handleOrgNameChange = useCallback((value: string) => {
    setOrgName(value);
    if (!slugEdited) {
      setOrgSlug(value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""));
    }
  }, [slugEdited]);

  async function handleCreateAdmin() {
    setError(null);
    if (adminPassword !== confirmPassword) { setError("Passwords do not match"); return; }
    if (adminPassword.length < 8) { setError("Password must be at least 8 characters"); return; }
    setStep("org");
  }

  async function handleCreateOrg() {
    setError(null);
    setLoading(true);
    try {
      const result = await initSetup({
        email: adminEmail,
        name: adminName,
        password: adminPassword,
        orgName: orgName || undefined,
        orgSlug: orgSlug || undefined,
      });

      localStorage.setItem("bw_token", result.token);
      if (result.organization) {
        localStorage.setItem("bw_org", JSON.stringify(result.organization));
      }
      setSetupResult(result);
      await refreshUser();

      // Always seed entity categories for the org (required for app to function)
      if (result.organization) {
        try { await seedEssentials(result.organization.id); } catch { /* ok */ }
      }

      // If org was created, offer seed data. Otherwise skip to done.
      if (result.organization) {
        setStep("seed");
      } else {
        setStep("done");
        setTimeout(() => router.push("/"), 1500);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Setup failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleSeed() {
    if (!setupResult?.organization) return;
    setSeeding(true);
    setError(null);
    try {
      await seedSampleData(setupResult.organization.id);
      setSeedDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Seeding failed");
    } finally {
      setSeeding(false);
    }
  }

  function handleFinish() {
    setStep("done");
    setTimeout(() => router.push("/"), 1500);
  }

  const stepIndex = STEPS.indexOf(step);

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg p-4">
      <div className="w-full max-w-lg">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold text-fg">Bidwright</h1>
          <p className="mt-2 text-sm text-fg/40">First-time setup</p>
        </div>

        {/* Progress */}
        <div className="mb-6 flex items-center justify-center gap-2">
          {STEPS.map((s, i) => (
            <div key={s} className="flex items-center gap-2">
              <div className={`h-2.5 w-2.5 rounded-full transition-colors ${
                step === s ? "bg-accent" : stepIndex > i ? "bg-accent/50" : "bg-line"
              }`} />
              {i < STEPS.length - 1 && <div className="h-px w-6 bg-line" />}
            </div>
          ))}
        </div>

        <Card>
          <CardHeader>
            <CardTitle>
              {step === "welcome" && "Welcome to Bidwright"}
              {step === "admin" && "Create Super Admin"}
              {step === "org" && "Create Your Organization"}
              {step === "seed" && "Sample Data"}
              {step === "done" && "Setup Complete"}
            </CardTitle>
          </CardHeader>
          <CardBody>
            {error && (
              <div className="mb-4 rounded-lg border border-danger/30 bg-danger/10 px-4 py-2 text-sm text-danger">
                {error}
              </div>
            )}

            {step === "welcome" && (
              <div className="space-y-4">
                <p className="text-sm text-fg/60">
                  Let's get your system set up. You'll create a super admin account
                  that can manage all organizations and users, then create your first organization.
                </p>
                <Button variant="accent" className="w-full" onClick={() => setStep("admin")}>
                  Get Started
                </Button>
              </div>
            )}

            {step === "admin" && (
              <div className="space-y-4">
                <p className="text-xs text-fg/40 mb-3">
                  This account has full system access and can manage all organizations.
                </p>
                <div>
                  <Label htmlFor="adminName">Name</Label>
                  <Input id="adminName" value={adminName} onChange={(e) => setAdminName(e.target.value)} placeholder="Admin Name" required autoFocus />
                </div>
                <div>
                  <Label htmlFor="adminEmail">Email</Label>
                  <Input id="adminEmail" type="email" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} placeholder="admin@yourcompany.com" required autoComplete="email" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor="adminPassword">Password</Label>
                    <Input id="adminPassword" type="password" value={adminPassword} onChange={(e) => setAdminPassword(e.target.value)} placeholder="Min 8 characters" required autoComplete="new-password" />
                  </div>
                  <div>
                    <Label htmlFor="confirmPassword">Confirm</Label>
                    <Input id="confirmPassword" type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="Confirm" required autoComplete="new-password" />
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button variant="ghost" onClick={() => setStep("welcome")}>Back</Button>
                  <Button variant="accent" className="flex-1" disabled={!adminName.trim() || !adminEmail.trim() || !adminPassword.trim()} onClick={handleCreateAdmin}>
                    Next
                  </Button>
                </div>
              </div>
            )}

            {step === "org" && (
              <div className="space-y-4">
                <p className="text-xs text-fg/40 mb-3">
                  Create your first organization. You can create more later from the admin dashboard.
                </p>
                <div>
                  <Label htmlFor="orgName">Organization Name</Label>
                  <Input id="orgName" value={orgName} onChange={(e) => handleOrgNameChange(e.target.value)} placeholder="Acme Electrical" autoFocus />
                </div>
                {orgName && (
                  <div>
                    <Label htmlFor="orgSlug">URL Slug</Label>
                    <Input id="orgSlug" value={orgSlug} onChange={(e) => { setOrgSlug(e.target.value); setSlugEdited(true); }} placeholder="acme-electrical" />
                  </div>
                )}
                <div className="flex gap-2">
                  <Button variant="ghost" onClick={() => setStep("admin")}>Back</Button>
                  <Button variant="accent" className="flex-1" disabled={loading} onClick={handleCreateOrg}>
                    {loading ? "Setting up..." : orgName ? "Create Organization" : "Skip & Finish"}
                  </Button>
                </div>
              </div>
            )}

            {step === "seed" && (
              <div className="space-y-4">
                <p className="text-sm text-fg/60">
                  Would you like to populate <strong>{setupResult?.organization?.name}</strong> with
                  sample projects, quotes, catalogs, and customers? This is great for exploring the platform.
                </p>

                <div className="rounded-lg border border-line bg-panel2/30 p-4">
                  <div className="flex items-start gap-3">
                    <Database className="h-5 w-5 text-accent mt-0.5 shrink-0" />
                    <div className="text-xs text-fg/60 space-y-1">
                      <p className="font-medium text-fg/80">Sample data includes:</p>
                      <ul className="list-disc list-inside space-y-0.5">
                        <li>2 sample projects with quotes and line items</li>
                        <li>Material, labour, and equipment catalogs</li>
                        <li>Rate schedules with tiered pricing</li>
                        <li>Sample customers and departments</li>
                        <li>Entity categories (Labour, Material, Equipment, etc.)</li>
                      </ul>
                    </div>
                  </div>
                </div>

                {seedDone ? (
                  <div className="rounded-lg border border-green-500/30 bg-green-500/10 px-4 py-2 text-sm text-green-600">
                    Sample data loaded successfully.
                  </div>
                ) : null}

                <div className="flex gap-2">
                  {!seedDone ? (
                    <>
                      <Button variant="ghost" className="flex-1" onClick={handleFinish}>
                        Skip
                      </Button>
                      <Button variant="accent" className="flex-1" disabled={seeding} onClick={handleSeed}>
                        {seeding ? (
                          <><Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> Loading...</>
                        ) : (
                          "Load Sample Data"
                        )}
                      </Button>
                    </>
                  ) : (
                    <Button variant="accent" className="w-full" onClick={handleFinish}>
                      Continue to Dashboard
                    </Button>
                  )}
                </div>
              </div>
            )}

            {step === "done" && (
              <div className="space-y-4 text-center py-4">
                <div className="text-4xl">&#10003;</div>
                <p className="text-sm text-fg/60">
                  System initialized successfully. Redirecting...
                </p>
              </div>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
