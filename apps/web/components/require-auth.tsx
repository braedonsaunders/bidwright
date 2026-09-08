"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { RefreshCw, TriangleAlert } from "lucide-react";
import { useAuth, type AuthBootstrapError } from "./auth-provider";
import { isDemoMode } from "@/lib/demo-mode";

const PUBLIC_PATHS = ["/login", "/signup", "/setup"];

/**
 * Shown when the API answered with something other than "not signed in".
 * Rendering `null` here — the old behaviour — left a blank page whenever the
 * backend was down, which is exactly when the user most needs to be told what
 * happened and given a way to retry.
 */
function BackendUnavailable({ error, onRetry }: { error: AuthBootstrapError; onRetry: () => Promise<void> }) {
  const [retrying, setRetrying] = useState(false);

  const headline = error.source === "setup-status"
    ? "Bidwright could not reach its API"
    : "Bidwright could not start your session";
  const detail = error.status === 0
    ? "The request never reached the server. It may be starting up, or the connection was blocked."
    : `The server answered with HTTP ${error.status}.`;

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg p-6">
      <div className="w-full max-w-md rounded-xl border border-line bg-panel p-6 text-center shadow-xl">
        <TriangleAlert className="mx-auto mb-3 h-8 w-8 text-warning" />
        <h1 className="text-base font-semibold">{headline}</h1>
        <p className="mt-2 text-sm text-fg/60">{detail}</p>
        <p className="mt-3 break-words rounded-lg border border-line bg-panel2/50 px-3 py-2 text-left text-[11px] leading-relaxed text-fg/40">
          {error.message}
        </p>
        <button
          type="button"
          disabled={retrying}
          onClick={async () => {
            setRetrying(true);
            try {
              await onRetry();
            } finally {
              setRetrying(false);
            }
          }}
          className="mt-4 inline-flex items-center gap-2 rounded-lg border border-line bg-panel2 px-3 py-1.5 text-sm font-medium transition-colors hover:bg-panel2/70 disabled:opacity-50"
        >
          <RefreshCw className={retrying ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} />
          {retrying ? "Retrying..." : "Try again"}
        </button>
      </div>
    </div>
  );
}

export function RequireAuth({ children, requireSuperAdmin }: { children: ReactNode; requireSuperAdmin?: boolean }) {
  const t = useTranslations("Common");
  const { user, loading, initialized, isSuperAdmin, authError, retryBootstrap } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const demoMode = isDemoMode;

  useEffect(() => {
    if (loading) return;
    // A backend failure is not an authorization answer — redirecting on it
    // would bounce the user to a login screen that cannot work either.
    if (authError) return;

    if (demoMode) {
      if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
        router.replace("/");
        return;
      }
      if (requireSuperAdmin && !isSuperAdmin) {
        router.replace("/");
      }
      return;
    }

    // If system not initialized, redirect to setup
    if (initialized === false && pathname !== "/setup") {
      router.replace("/setup");
      return;
    }

    // If on a public path, don't enforce auth
    if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) return;

    // If not logged in, redirect to login
    if (!user) {
      router.replace("/login");
      return;
    }

    // If super admin required but user is not super admin
    if (requireSuperAdmin && !isSuperAdmin) {
      router.replace("/");
      return;
    }
  }, [user, loading, initialized, isSuperAdmin, requireSuperAdmin, pathname, router, demoMode, authError]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg">
        <div className="text-fg/40 text-sm">{t("loading")}</div>
      </div>
    );
  }

  const onPublicPath = PUBLIC_PATHS.some((p) => pathname.startsWith(p));

  // The backend is unusable. In normal mode the public paths (login/setup)
  // still render so their own forms can report the failure in context. The
  // demo has no such form — its identity comes from the API itself — so every
  // demo path gets the explanation rather than a blank screen.
  if (authError && !user && (!onPublicPath || demoMode)) {
    return <BackendUnavailable error={authError} onRetry={retryBootstrap} />;
  }

  if (demoMode && onPublicPath) return null;

  // Demo mode with no identity and no recorded failure means the web bundle
  // was built for the demo but the API it is talking to was not. Say that
  // rather than rendering nothing.
  if (demoMode && !user) {
    return (
      <BackendUnavailable
        error={{
          message: "The API did not return a demo identity. This build runs in demo mode; the API it reached does not.",
          status: 401,
          source: "session",
        }}
        onRetry={retryBootstrap}
      />
    );
  }

  // On public paths, always render
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) return <>{children}</>;

  // If setup needed, don't render app content
  if (initialized === false) return null;

  // If not authed, don't render
  if (!user) return null;

  // If super admin required but not super admin, don't render
  if (requireSuperAdmin && !isSuperAdmin) return null;

  return <>{children}</>;
}
