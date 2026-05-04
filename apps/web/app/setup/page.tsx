"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { useAuth } from "@/components/auth-provider";
import { BidwrightMark } from "@/components/brand-logo";
import { initSetup, seedSampleData, seedEssentials } from "@/lib/api";
import { Button, Input, Label } from "@/components/ui";
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Check,
  CheckCircle2,
  ClipboardCheck,
  Database,
  Gauge,
  Loader2,
  LockKeyhole,
  Mail,
  Map,
  Rocket,
  ShieldCheck,
  Sparkles,
  UserRoundCog,
  UsersRound,
  type LucideIcon,
} from "lucide-react";

type Step = "welcome" | "admin" | "org" | "seed" | "done";

const STEPS: Step[] = ["welcome", "admin", "org", "seed", "done"];

const STEP_META: Record<Step, { label: string; eyebrow: string; title: string; summary: string; Icon: LucideIcon }> = {
  welcome: {
    label: "Start",
    eyebrow: "First run",
    title: "Stand up the command center.",
    summary: "Create the system owner, shape the first organization, and decide how much demo context to bring in.",
    Icon: Sparkles,
  },
  admin: {
    label: "Owner",
    eyebrow: "System owner",
    title: "Create the super admin.",
    summary: "This account can manage organizations, users, limits, and cross-organization setup.",
    Icon: UserRoundCog,
  },
  org: {
    label: "Org",
    eyebrow: "First organization",
    title: "Name the estimating shop.",
    summary: "Set the first organization profile so projects, pricing, people, and settings have a home.",
    Icon: Building2,
  },
  seed: {
    label: "Data",
    eyebrow: "Starting library",
    title: "Choose the opening dataset.",
    summary: "Entity categories are created automatically. Add sample projects and catalogs when you want a guided sandbox.",
    Icon: Database,
  },
  done: {
    label: "Launch",
    eyebrow: "Ready",
    title: "Bidwright is ready.",
    summary: "The workspace is initialized and the first organization has the essentials it needs to start estimating.",
    Icon: Rocket,
  },
};

const setupChecklist = [
  { label: "Organization shell", detail: "Name, slug, tenant settings", Icon: Building2 },
  { label: "Admin access", detail: "Super admin plus org admin", Icon: ShieldCheck },
  { label: "Estimating baseline", detail: "Categories, rates, catalogs", Icon: ClipboardCheck },
  { label: "Launch path", detail: "Dashboard, projects, knowledge", Icon: Rocket },
];

const previewDefaults = {
  adminName: "Avery Morgan",
  adminEmail: "avery@summitbuilds.example",
  adminPassword: "Bidwright!2026",
  orgName: "Summit Builders",
  orgSlug: "summit-builders",
};

function isDemoSetupPreview() {
  if (typeof window === "undefined") return false;
  const params = new URLSearchParams(window.location.search);
  return params.get("demo") === "1" || params.get("preview") === "1";
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export default function SetupPage() {
  const router = useRouter();
  const { refreshUser, initialized } = useAuth();
  const [demoMode, setDemoMode] = useState(false);
  const [step, setStep] = useState<Step>("welcome");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [adminName, setAdminName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [orgName, setOrgName] = useState("");
  const [orgSlug, setOrgSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);

  const [setupResult, setSetupResult] = useState<{ organization: { id: string; name: string; slug: string } | null } | null>(null);
  const [seeding, setSeeding] = useState(false);
  const [seedDone, setSeedDone] = useState(false);

  useEffect(() => {
    const preview = isDemoSetupPreview();
    setDemoMode(preview);

    if (preview) {
      setAdminName(previewDefaults.adminName);
      setAdminEmail(previewDefaults.adminEmail);
      setAdminPassword(previewDefaults.adminPassword);
      setConfirmPassword(previewDefaults.adminPassword);
      setOrgName(previewDefaults.orgName);
      setOrgSlug(previewDefaults.orgSlug);
    }
  }, []);

  useEffect(() => {
    if (initialized === true && !demoMode && !isDemoSetupPreview()) {
      router.replace("/");
    }
  }, [demoMode, initialized, router]);

  const handleOrgNameChange = useCallback((value: string) => {
    setOrgName(value);
    if (!slugEdited) {
      setOrgSlug(value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""));
    }
  }, [slugEdited]);

  function validateAdmin() {
    if (!adminName.trim()) return "Enter the admin name.";
    if (!adminEmail.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail.trim())) return "Enter a valid admin email.";
    if (adminPassword.length < 8) return "Password must be at least 8 characters.";
    if (adminPassword !== confirmPassword) return "Passwords do not match.";
    return null;
  }

  async function handleCreateAdmin() {
    setError(null);
    const validationError = validateAdmin();
    if (validationError) {
      setError(validationError);
      return;
    }
    setStep("org");
  }

  async function handleCreateOrg() {
    setError(null);
    setLoading(true);

    try {
      if (demoMode) {
        await wait(650);
        const organization = orgName.trim()
          ? { id: "demo-org", name: orgName.trim(), slug: orgSlug.trim() || "summit-builders" }
          : null;
        setSetupResult({ organization });
        setStep(organization ? "seed" : "done");
        return;
      }

      const result = await initSetup({
        email: adminEmail,
        name: adminName,
        password: adminPassword,
        orgName: orgName || undefined,
        orgSlug: orgSlug || undefined,
      });

      setSetupResult({ organization: result.organization });
      await refreshUser();

      if (result.organization) {
        try {
          await seedEssentials(result.organization.id);
        } catch {
          /* Essentials can be retried later from admin tools. */
        }
      }

      if (result.organization) {
        setStep("seed");
      } else {
        setStep("done");
        window.setTimeout(() => router.push("/"), 1500);
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
      if (demoMode) {
        await wait(800);
      } else {
        await seedSampleData(setupResult.organization.id);
      }
      setSeedDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Seeding failed");
    } finally {
      setSeeding(false);
    }
  }

  function handleFinish() {
    setStep("done");
    if (!demoMode) {
      window.setTimeout(() => router.push("/"), 1500);
    }
  }

  function restartPreview() {
    setStep("welcome");
    setError(null);
    setSeedDone(false);
    setSetupResult(null);
  }

  const stepIndex = STEPS.indexOf(step);
  const current = STEP_META[step];
  const CurrentIcon = current.Icon;
  const percent = Math.round(((stepIndex + 1) / STEPS.length) * 100);

  return (
    <main
      data-testid="first-run-walkthrough"
      className="relative h-dvh overflow-hidden bg-[#0a0d0c] text-[#f5f0e6]"
    >
      <div
        aria-hidden="true"
        className="absolute inset-0 opacity-45"
        style={{
          backgroundImage:
            "linear-gradient(rgba(245,240,230,0.07) 1px, transparent 1px), linear-gradient(90deg, rgba(245,240,230,0.07) 1px, transparent 1px), linear-gradient(135deg, rgba(206,153,68,0.13) 1px, transparent 1px)",
          backgroundSize: "42px 42px, 42px 42px, 180px 180px",
        }}
      />
      <motion.div
        aria-hidden="true"
        className="absolute left-0 top-[18%] h-px w-[58vw] bg-gradient-to-r from-transparent via-[#d99a36] to-transparent"
        animate={{ x: ["-65vw", "120vw"], opacity: [0, 0.9, 0] }}
        transition={{ duration: 8.5, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        aria-hidden="true"
        className="absolute bottom-[24%] left-0 h-px w-[46vw] bg-gradient-to-r from-transparent via-[#55b6a1] to-transparent"
        animate={{ x: ["-52vw", "118vw"], opacity: [0, 0.7, 0] }}
        transition={{ duration: 10.5, repeat: Infinity, ease: "easeInOut", delay: 1.2 }}
      />

      <div className="relative z-10 grid h-full grid-cols-1 lg:grid-cols-[minmax(340px,0.9fr)_minmax(440px,1.1fr)]">
        <aside className="hidden min-h-0 border-r border-white/10 px-8 py-8 lg:flex lg:flex-col xl:px-12">
          <div className="flex items-center gap-3">
            <BidwrightMark className="h-11 w-11 drop-shadow-[0_12px_22px_rgba(0,0,0,0.42)]" variant="light" />
            <div>
              <p className="text-lg font-semibold text-white">Bidwright</p>
              <p className="text-xs text-[#b8c1b8]">Organization setup</p>
            </div>
          </div>

          <div className="mt-12 max-w-[560px]">
            {demoMode ? (
              <div data-testid="setup-demo-badge" className="mb-4 inline-flex items-center gap-2 rounded-md border border-[#55b6a1]/35 bg-[#55b6a1]/12 px-3 py-1.5 text-xs font-medium text-[#a9eadc]">
                <Sparkles className="h-3.5 w-3.5" />
                Preview mode
              </div>
            ) : null}
            <p className="text-sm font-medium text-[#f0bf6d]">{current.eyebrow}</p>
            <h1 className="mt-3 max-w-[560px] text-5xl font-semibold leading-[1.02] text-white">
              {current.title}
            </h1>
            <p className="mt-5 max-w-[470px] text-[15px] leading-7 text-[#cbd2c9]">
              {current.summary}
            </p>
          </div>

          <div className="mt-10 grid gap-3">
            {setupChecklist.map((item, index) => {
              const ItemIcon = item.Icon;
              const active = index <= Math.min(stepIndex, setupChecklist.length - 1);
              return (
                <motion.div
                  key={item.label}
                  initial={false}
                  animate={{ opacity: active ? 1 : 0.55, x: active ? 0 : 5 }}
                  className="flex items-center gap-3 rounded-lg border border-white/10 bg-white/[0.045] px-4 py-3"
                >
                  <div className={`flex h-9 w-9 items-center justify-center rounded-md border ${
                    active ? "border-[#55b6a1]/45 bg-[#55b6a1]/14 text-[#a9eadc]" : "border-white/10 bg-white/5 text-[#89958f]"
                  }`}>
                    {active ? <Check className="h-4 w-4" /> : <ItemIcon className="h-4 w-4" />}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-white">{item.label}</p>
                    <p className="text-xs text-[#a7b0aa]">{item.detail}</p>
                  </div>
                </motion.div>
              );
            })}
          </div>

          <div className="mt-auto pt-8">
            <div className="rounded-lg border border-white/10 bg-[#0f1714]/80 p-4">
              <div className="flex items-center justify-between text-xs text-[#a7b0aa]">
                <span>Setup readiness</span>
                <span>{percent}%</span>
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/8">
                <motion.div
                  className="h-full rounded-full bg-[#d99a36]"
                  initial={false}
                  animate={{ width: `${percent}%` }}
                  transition={{ duration: 0.35, ease: "easeOut" }}
                />
              </div>
            </div>
          </div>
        </aside>

        <section className="flex min-h-0 flex-col overflow-y-auto px-4 py-5 sm:px-6 lg:px-10 lg:py-8">
          <div className="mx-auto flex w-full max-w-[720px] flex-1 flex-col justify-center py-5">
            <div className="mb-5 flex items-center justify-between gap-4 lg:hidden">
              <div className="flex items-center gap-3">
                <BidwrightMark className="h-10 w-10 drop-shadow-[0_10px_18px_rgba(0,0,0,0.38)]" variant="light" />
                <div>
                  <p className="font-semibold text-white">Bidwright</p>
                  <p className="text-xs text-[#b8c1b8]">First-run setup</p>
                </div>
              </div>
              {demoMode ? (
                <span className="rounded-md border border-[#55b6a1]/35 bg-[#55b6a1]/12 px-2.5 py-1 text-xs font-medium text-[#a9eadc]">
                  Preview
                </span>
              ) : null}
            </div>

            <div className="mb-5 grid grid-cols-5 gap-2">
              {STEPS.map((s, index) => {
                const meta = STEP_META[s];
                const active = s === step;
                const complete = stepIndex > index;
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => demoMode && index <= Math.max(stepIndex, 0) ? setStep(s) : undefined}
                    className={`min-h-[54px] rounded-lg border px-2 py-2 text-left transition-colors ${
                      active
                        ? "border-[#d99a36]/70 bg-[#d99a36]/16 text-white"
                        : complete
                          ? "border-[#55b6a1]/40 bg-[#55b6a1]/10 text-[#d8f4ed]"
                          : "border-white/10 bg-white/[0.045] text-[#99a39c]"
                    } ${demoMode && index <= stepIndex ? "cursor-pointer hover:border-[#d99a36]/50" : "cursor-default"}`}
                    aria-current={active ? "step" : undefined}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium">{meta.label}</span>
                      {complete ? <Check className="h-3.5 w-3.5" /> : null}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="overflow-hidden rounded-lg border border-white/12 bg-[#f3efe4] text-[#111615] shadow-2xl shadow-black/35">
              <div className="border-b border-[#d9d2c3] bg-[#ebe5d7] px-5 py-4 sm:px-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#101514] text-[#f0bf6d]">
                      <CurrentIcon className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="text-xs font-medium text-[#68736a]">{current.eyebrow}</p>
                      <h2 className="text-xl font-semibold leading-tight text-[#101514]">{current.title}</h2>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 rounded-md border border-[#d4ccb9] bg-white/55 px-3 py-1.5 text-xs font-medium text-[#5e675f]">
                    <Gauge className="h-3.5 w-3.5 text-[#b57720]" />
                    {percent}% ready
                  </div>
                </div>
              </div>

              <div className="p-5 sm:p-6">
                <AnimatePresence initial={false} mode="wait">
                  <motion.div
                    key={step}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.18, ease: "easeOut" }}
                  >
                    {error && (
                      <div className="mb-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
                        {error}
                      </div>
                    )}

                    {step === "welcome" && (
                      <div className="space-y-6" data-testid="setup-step-welcome">
                        <div className="grid grid-cols-3 gap-2 sm:gap-3">
                          {[
                            { value: "01", label: "Owner account" },
                            { value: "02", label: "Organization shell" },
                            { value: "03", label: "Starter data" },
                          ].map((item) => (
                            <div key={item.value} className="rounded-lg border border-[#d8d1c0] bg-white/55 p-3 sm:p-4">
                              <p className="font-mono text-xs font-semibold text-[#b57720]">{item.value}</p>
                              <p className="mt-2 text-xs font-semibold leading-5 text-[#111615] sm:text-sm">{item.label}</p>
                            </div>
                          ))}
                        </div>

                        <div className="rounded-lg border border-[#cbd8cf] bg-[#eef7f2] p-4">
                          <div className="flex items-start gap-3">
                            <Map className="mt-0.5 h-5 w-5 shrink-0 text-[#257d69]" />
                            <div>
                              <p className="text-sm font-semibold text-[#11231f]">First users land with the basics already in place.</p>
                              <p className="mt-1 text-sm leading-6 text-[#4d6258]">
                                The walkthrough creates the admin, sets the first organization, seeds required estimating categories, and offers a sample workspace for training.
                              </p>
                            </div>
                          </div>
                        </div>

                        <Button
                          variant="accent"
                          size="lg"
                          className="h-12 w-full rounded-lg bg-[#101514] text-white hover:bg-[#1c2925]"
                          onClick={() => setStep("admin")}
                        >
                          Start setup
                          <ArrowRight className="h-4 w-4" />
                        </Button>
                      </div>
                    )}

                    {step === "admin" && (
                      <div className="space-y-5" data-testid="setup-step-admin">
                        <div className="rounded-lg border border-[#d8d1c0] bg-white/55 p-4 text-sm leading-6 text-[#4f5a53]">
                          This account can administer every organization. You can add organization-specific users after launch.
                        </div>

                        <div className="grid gap-4">
                          <div>
                            <Label htmlFor="adminName" className="text-xs font-semibold text-[#4d5851]">Name</Label>
                            <Input
                              id="adminName"
                              value={adminName}
                              onChange={(e) => setAdminName(e.target.value)}
                              placeholder="Admin Name"
                              required
                              autoFocus
                              className="mt-2 h-12 border-[#c9d0c5] bg-white text-[#101514] placeholder:text-[#7b867d]"
                            />
                          </div>
                          <div>
                            <Label htmlFor="adminEmail" className="text-xs font-semibold text-[#4d5851]">Email</Label>
                            <div className="relative mt-2">
                              <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#7a857e]" />
                              <Input
                                id="adminEmail"
                                type="email"
                                value={adminEmail}
                                onChange={(e) => setAdminEmail(e.target.value)}
                                placeholder="admin@yourcompany.com"
                                required
                                autoComplete="email"
                                className="h-12 border-[#c9d0c5] bg-white pl-10 text-[#101514] placeholder:text-[#7b867d]"
                              />
                            </div>
                          </div>
                          <div className="grid gap-4 sm:grid-cols-2">
                            <div>
                              <Label htmlFor="adminPassword" className="text-xs font-semibold text-[#4d5851]">Password</Label>
                              <div className="relative mt-2">
                                <LockKeyhole className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#7a857e]" />
                                <Input
                                  id="adminPassword"
                                  type="password"
                                  value={adminPassword}
                                  onChange={(e) => setAdminPassword(e.target.value)}
                                  placeholder="Min 8 characters"
                                  required
                                  autoComplete="new-password"
                                  className="h-12 border-[#c9d0c5] bg-white pl-10 text-[#101514] placeholder:text-[#7b867d]"
                                />
                              </div>
                            </div>
                            <div>
                              <Label htmlFor="confirmPassword" className="text-xs font-semibold text-[#4d5851]">Confirm</Label>
                              <Input
                                id="confirmPassword"
                                type="password"
                                value={confirmPassword}
                                onChange={(e) => setConfirmPassword(e.target.value)}
                                placeholder="Confirm password"
                                required
                                autoComplete="new-password"
                                className="mt-2 h-12 border-[#c9d0c5] bg-white text-[#101514] placeholder:text-[#7b867d]"
                              />
                            </div>
                          </div>
                        </div>

                        <div className="flex gap-2">
                          <Button variant="ghost" className="h-11 rounded-lg text-[#4f5a53] hover:bg-[#e8e1d2]" onClick={() => setStep("welcome")}>
                            <ArrowLeft className="h-4 w-4" />
                            Back
                          </Button>
                          <Button
                            variant="accent"
                            className="h-11 flex-1 rounded-lg bg-[#101514] text-white hover:bg-[#1c2925]"
                            disabled={!adminName.trim() || !adminEmail.trim() || !adminPassword.trim()}
                            onClick={handleCreateAdmin}
                          >
                            Continue
                            <ArrowRight className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    )}

                    {step === "org" && (
                      <div className="space-y-5" data-testid="setup-step-org">
                        <div className="grid gap-4 lg:grid-cols-[1fr_220px]">
                          <div className="space-y-4">
                            <div>
                              <Label htmlFor="orgName" className="text-xs font-semibold text-[#4d5851]">Organization Name</Label>
                              <Input
                                id="orgName"
                                value={orgName}
                                onChange={(e) => handleOrgNameChange(e.target.value)}
                                placeholder="Acme Electrical"
                                autoFocus
                                className="mt-2 h-12 border-[#c9d0c5] bg-white text-[#101514] placeholder:text-[#7b867d]"
                              />
                            </div>
                            <div>
                              <Label htmlFor="orgSlug" className="text-xs font-semibold text-[#4d5851]">URL Slug</Label>
                              <Input
                                id="orgSlug"
                                value={orgSlug}
                                onChange={(e) => { setOrgSlug(e.target.value); setSlugEdited(true); }}
                                placeholder="acme-electrical"
                                disabled={!orgName.trim()}
                                className="mt-2 h-12 border-[#c9d0c5] bg-white text-[#101514] placeholder:text-[#7b867d] disabled:bg-[#eee8da]"
                              />
                            </div>
                          </div>

                          <div className="rounded-lg border border-[#d8d1c0] bg-[#111615] p-4 text-[#f5f0e6]">
                            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#d99a36]/16 text-[#f0bf6d]">
                              <UsersRound className="h-5 w-5" />
                            </div>
                            <p className="mt-4 text-sm font-semibold">{orgName.trim() || "Your organization"}</p>
                            <p className="mt-1 break-words font-mono text-xs text-[#aeb8af]">/{orgSlug.trim() || "organization-slug"}</p>
                            <div className="mt-5 space-y-2 text-xs text-[#bfc8bf]">
                              <div className="flex items-center gap-2"><CheckCircle2 className="h-3.5 w-3.5 text-[#55b6a1]" /> Tenant settings</div>
                              <div className="flex items-center gap-2"><CheckCircle2 className="h-3.5 w-3.5 text-[#55b6a1]" /> Admin membership</div>
                              <div className="flex items-center gap-2"><CheckCircle2 className="h-3.5 w-3.5 text-[#55b6a1]" /> Required categories</div>
                            </div>
                          </div>
                        </div>

                        <div className="flex gap-2">
                          <Button variant="ghost" className="h-11 rounded-lg text-[#4f5a53] hover:bg-[#e8e1d2]" onClick={() => setStep("admin")}>
                            <ArrowLeft className="h-4 w-4" />
                            Back
                          </Button>
                          <Button
                            variant="accent"
                            className="h-11 flex-1 rounded-lg bg-[#101514] text-white hover:bg-[#1c2925]"
                            disabled={loading}
                            onClick={handleCreateOrg}
                          >
                            {loading ? (
                              <>
                                <Loader2 className="h-4 w-4 animate-spin" />
                                Setting up
                              </>
                            ) : orgName.trim() ? (
                              <>
                                Create organization
                                <ArrowRight className="h-4 w-4" />
                              </>
                            ) : (
                              "Skip organization"
                            )}
                          </Button>
                        </div>
                      </div>
                    )}

                    {step === "seed" && (
                      <div className="space-y-5" data-testid="setup-step-seed">
                        <div className="rounded-lg border border-[#cbd8cf] bg-[#eef7f2] p-4">
                          <div className="flex items-start gap-3">
                            <Database className="mt-0.5 h-5 w-5 shrink-0 text-[#257d69]" />
                            <div>
                              <p className="text-sm font-semibold text-[#11231f]">
                                {setupResult?.organization?.name ?? "This organization"} already has required estimating categories.
                              </p>
                              <p className="mt-1 text-sm leading-6 text-[#4d6258]">
                                Sample data adds projects, quotes, catalogs, rates, customers, and departments for a richer first session.
                              </p>
                            </div>
                          </div>
                        </div>

                        <div className="grid gap-3 sm:grid-cols-2">
                          {["Sample projects", "Line items and phases", "Material catalogs", "Rate schedules"].map((item) => (
                            <div key={item} className="flex items-center gap-2 rounded-lg border border-[#d8d1c0] bg-white/55 px-3 py-3 text-sm font-medium text-[#29322e]">
                              <CheckCircle2 className="h-4 w-4 text-[#257d69]" />
                              {item}
                            </div>
                          ))}
                        </div>

                        {seedDone ? (
                          <div className="rounded-lg border border-[#9ac8b7] bg-[#e8f7ef] px-4 py-3 text-sm font-medium text-[#1f6c55]">
                            Sample data loaded successfully.
                          </div>
                        ) : null}

                        {!seedDone ? (
                          <div className="flex gap-2">
                            <Button variant="ghost" className="h-11 flex-1 rounded-lg text-[#4f5a53] hover:bg-[#e8e1d2]" onClick={handleFinish}>
                              Skip
                            </Button>
                            <Button
                              variant="accent"
                              className="h-11 flex-1 rounded-lg bg-[#101514] text-white hover:bg-[#1c2925]"
                              disabled={seeding}
                              onClick={handleSeed}
                            >
                              {seeding ? (
                                <>
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                  Loading
                                </>
                              ) : (
                                <>
                                  Load sample data
                                  <ArrowRight className="h-4 w-4" />
                                </>
                              )}
                            </Button>
                          </div>
                        ) : (
                          <Button variant="accent" className="h-11 w-full rounded-lg bg-[#101514] text-white hover:bg-[#1c2925]" onClick={handleFinish}>
                            Continue to dashboard
                            <ArrowRight className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    )}

                    {step === "done" && (
                      <div className="py-4 text-center" data-testid="setup-step-done">
                        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-lg bg-[#e8f7ef] text-[#257d69]">
                          <Check className="h-8 w-8" />
                        </div>
                        <h3 className="mt-5 text-2xl font-semibold text-[#101514]">
                          {demoMode ? "Preview complete." : "Setup complete."}
                        </h3>
                        <p className="mx-auto mt-2 max-w-[420px] text-sm leading-6 text-[#5a665e]">
                          {demoMode
                            ? "This demo used local preview data only. The real first-run path appears automatically when no super admin exists."
                            : "System initialized successfully. Redirecting to the dashboard."}
                        </p>
                        {demoMode ? (
                          <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
                            <Button variant="ghost" className="h-11 rounded-lg text-[#4f5a53] hover:bg-[#e8e1d2]" onClick={restartPreview}>
                              Replay walkthrough
                            </Button>
                            <Button variant="accent" className="h-11 rounded-lg bg-[#101514] text-white hover:bg-[#1c2925]" onClick={() => router.push("/")}>
                              Open app
                              <ArrowRight className="h-4 w-4" />
                            </Button>
                          </div>
                        ) : null}
                      </div>
                    )}
                  </motion.div>
                </AnimatePresence>
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
