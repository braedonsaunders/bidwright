"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { login } from "@/lib/api";
import { Button, Input, Label, Card, CardBody, CardHeader, CardTitle } from "@/components/ui";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const result = await login(email, password || undefined);
      localStorage.setItem("bw_token", result.token);
      localStorage.setItem("bw_user", JSON.stringify(result.user));
      router.push("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg p-4">
      <div className="w-full max-w-sm">
        {/* Logo / Brand */}
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-fg">Bidwright</h1>
          <p className="mt-1 text-sm text-fg/40">Sign in to your account</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Login</CardTitle>
          </CardHeader>
          <CardBody>
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div className="rounded-lg border border-danger/30 bg-danger/10 px-4 py-2 text-sm text-danger">
                  {error}
                </div>
              )}

              <div>
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="admin@bidwright.app"
                  required
                  autoFocus
                  autoComplete="email"
                />
              </div>

              <div>
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Optional in dev mode"
                  autoComplete="current-password"
                />
                <p className="mt-1 text-xs text-fg/30">
                  Password is optional in development mode.
                </p>
              </div>

              <Button
                type="submit"
                variant="accent"
                className="w-full"
                disabled={loading || !email.trim()}
              >
                {loading ? "Signing in..." : "Sign In"}
              </Button>
            </form>

            <div className="mt-4 border-t border-line pt-4">
              <p className="mb-2 text-xs font-medium text-fg/40">Dev accounts:</p>
              <div className="space-y-1">
                <button
                  type="button"
                  onClick={() => { setEmail("admin@bidwright.app"); setPassword(""); }}
                  className="block w-full rounded-lg border border-line bg-bg/30 px-3 py-1.5 text-left text-xs text-fg/60 hover:bg-panel2/50 transition-colors"
                >
                  admin@bidwright.app (Admin)
                </button>
                <button
                  type="button"
                  onClick={() => { setEmail("estimator@bidwright.app"); setPassword(""); }}
                  className="block w-full rounded-lg border border-line bg-bg/30 px-3 py-1.5 text-left text-xs text-fg/60 hover:bg-panel2/50 transition-colors"
                >
                  estimator@bidwright.app (Estimator)
                </button>
              </div>
            </div>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
