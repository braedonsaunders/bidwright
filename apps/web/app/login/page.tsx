"use client";

import type { FormEvent } from "react";
import { useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, Eye, EyeOff, LockKeyhole, Mail } from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import { BidwrightMark } from "@/components/brand-logo";
import { Button, Input, Label } from "@/components/ui";

const sweepLines = [
  { top: "12%", delay: 0, duration: 8.4 },
  { top: "31%", delay: 1.8, duration: 9.2 },
  { top: "58%", delay: 0.9, duration: 7.6 },
  { top: "78%", delay: 2.7, duration: 10 },
];

const nodePoints = [
  { left: "13%", top: "22%", delay: 0.2 },
  { left: "32%", top: "14%", delay: 1.1 },
  { left: "58%", top: "28%", delay: 0.7 },
  { left: "77%", top: "18%", delay: 1.8 },
  { left: "21%", top: "66%", delay: 1.5 },
  { left: "46%", top: "74%", delay: 0.5 },
  { left: "69%", top: "62%", delay: 2.2 },
  { left: "86%", top: "82%", delay: 1 },
];

export default function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      await login(email.trim(), password);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="relative h-screen overflow-hidden bg-[#090b0b] text-[#f4f1e8]">
      <div
        aria-hidden="true"
        className="absolute inset-0"
        style={{
          backgroundImage:
            "radial-gradient(circle at 18% 14%, rgba(37, 118, 96, 0.36), transparent 30%), radial-gradient(circle at 86% 22%, rgba(191, 139, 55, 0.22), transparent 34%), radial-gradient(circle at 54% 86%, rgba(72, 103, 118, 0.24), transparent 36%), linear-gradient(135deg, #090b0b 0%, #121715 46%, #080909 100%)",
        }}
      />
      <motion.div
        aria-hidden="true"
        className="absolute inset-[-18%] opacity-50"
        animate={{ rotate: [0, 1.8, 0], scale: [1, 1.035, 1] }}
        transition={{ duration: 18, repeat: Infinity, ease: "easeInOut" }}
        style={{
          backgroundImage:
            "linear-gradient(rgba(238, 236, 224, 0.07) 1px, transparent 1px), linear-gradient(90deg, rgba(238, 236, 224, 0.07) 1px, transparent 1px)",
          backgroundSize: "52px 52px",
        }}
      />
      <div
        aria-hidden="true"
        className="absolute inset-0 opacity-25"
        style={{
          backgroundImage:
            "linear-gradient(30deg, transparent 0 47%, rgba(238, 236, 224, 0.18) 48%, transparent 49% 100%), linear-gradient(150deg, transparent 0 47%, rgba(38, 150, 121, 0.18) 48%, transparent 49% 100%)",
          backgroundSize: "240px 180px",
        }}
      />

      {sweepLines.map((line) => (
        <motion.div
          key={line.top}
          aria-hidden="true"
          className="absolute h-px w-[58vw] bg-gradient-to-r from-transparent via-[#e1ac56]/70 to-transparent"
          style={{ top: line.top, left: "-65vw" }}
          animate={{ x: ["0vw", "180vw"], opacity: [0, 0.75, 0] }}
          transition={{ duration: line.duration, repeat: Infinity, ease: "easeInOut", delay: line.delay }}
        />
      ))}

      <motion.div
        aria-hidden="true"
        className="absolute left-[8%] top-[12%] h-[72vh] w-[72vh] rounded-full border border-white/10"
        animate={{ rotate: 360 }}
        transition={{ duration: 70, repeat: Infinity, ease: "linear" }}
      />
      <motion.div
        aria-hidden="true"
        className="absolute left-[18%] top-[22%] h-[44vh] w-[44vh] rounded-full border border-dashed border-[#269679]/20"
        animate={{ rotate: -360 }}
        transition={{ duration: 56, repeat: Infinity, ease: "linear" }}
      />

      <div aria-hidden="true" className="absolute inset-0">
        {nodePoints.map((point) => (
          <motion.span
            key={`${point.left}-${point.top}`}
            className="absolute h-1.5 w-1.5 rounded-full bg-[#f1c06a] shadow-[0_0_22px_rgba(241,192,106,0.85)]"
            style={{ left: point.left, top: point.top }}
            animate={{ opacity: [0.18, 0.95, 0.22], scale: [0.75, 1.35, 0.85] }}
            transition={{ duration: 3.8, repeat: Infinity, ease: "easeInOut", delay: point.delay }}
          />
        ))}
      </div>

      <div
        aria-hidden="true"
        className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_0%,transparent_54%,rgba(0,0,0,0.42)_100%)]"
      />

      <section className="relative z-10 flex h-full items-center justify-center px-4 py-6 sm:px-6">
        <motion.div
          initial={{ opacity: 0, y: 18, scale: 0.985 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.55, ease: "easeOut" }}
          className="w-full max-w-[430px]"
        >
          <div className="mb-6 flex items-center justify-center gap-3">
            <BidwrightMark className="h-11 w-11 drop-shadow-[0_12px_22px_rgba(0,0,0,0.42)]" variant="light" />
            <h1 className="text-xl font-semibold text-white">Bidwright</h1>
          </div>

          <div className="rounded-lg border border-white/14 bg-[#eef0e8]/95 p-5 text-[#101514] shadow-2xl shadow-black/45 backdrop-blur-xl sm:p-7">
            <div className="mb-7">
              <h2 className="text-3xl font-semibold leading-tight">Sign in</h2>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <AnimatePresence initial={false}>
                {error && (
                  <motion.div
                    initial={{ opacity: 0, y: -6, height: 0 }}
                    animate={{ opacity: 1, y: 0, height: "auto" }}
                    exit={{ opacity: 0, y: -6, height: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
                      {error}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              <div>
                <Label htmlFor="email" className="text-xs font-semibold uppercase tracking-[0.12em] text-[#4b5651]">
                  Email
                </Label>
                <div className="relative mt-2">
                  <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#78837d]" />
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@company.com"
                    required
                    autoFocus
                    autoComplete="email"
                    className="h-12 rounded-lg border-[#cbd3c8] bg-white pl-10 text-[15px] text-[#101514] shadow-inner shadow-[#e4e8df] placeholder:text-[#78837d] focus:border-[#1b7766]/65 focus:ring-[#1b7766]/20"
                  />
                </div>
              </div>

              <div>
                <Label htmlFor="password" className="text-xs font-semibold uppercase tracking-[0.12em] text-[#4b5651]">
                  Password
                </Label>
                <div className="relative mt-2">
                  <LockKeyhole className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#78837d]" />
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter your password"
                    required
                    autoComplete="current-password"
                    className="h-12 rounded-lg border-[#cbd3c8] bg-white pl-10 pr-11 text-[15px] text-[#101514] shadow-inner shadow-[#e4e8df] placeholder:text-[#5f6b64] focus:border-[#1b7766]/65 focus:ring-[#1b7766]/20"
                  />
                  <button
                    type="button"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    title={showPassword ? "Hide password" : "Show password"}
                    onClick={() => setShowPassword((visible) => !visible)}
                    className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-[#68736d] transition-colors hover:bg-[#e4e8df] hover:text-[#101514] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1b7766]/30"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <Button
                type="submit"
                variant="accent"
                className="h-12 w-full rounded-lg bg-[#101514] text-[15px] font-semibold text-white shadow-lg shadow-[#101514]/25 hover:bg-[#1d2a27]"
                disabled={loading || !email.trim() || !password.trim()}
              >
                {loading ? (
                  <>
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/25 border-t-white" />
                    Signing in
                  </>
                ) : (
                  <>
                    Continue
                    <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </Button>
            </form>

            <div className="mt-6 flex items-center justify-between border-t border-[#d9ded3] pt-5 text-sm">
              <span className="text-[#66716a]">No account?</span>
              <Link
                href="/signup"
                className="font-semibold text-[#1b7766] transition-colors hover:text-[#13584c] hover:underline"
              >
                Create account
              </Link>
            </div>
          </div>
        </motion.div>
      </section>
    </main>
  );
}
