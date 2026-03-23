"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useAuth } from "./auth-provider";

const PUBLIC_PATHS = ["/login", "/signup", "/setup"];

export function RequireAuth({ children, requireSuperAdmin }: { children: ReactNode; requireSuperAdmin?: boolean }) {
  const { user, loading, initialized, isSuperAdmin } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (loading) return;

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
  }, [user, loading, initialized, isSuperAdmin, requireSuperAdmin, pathname, router]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg">
        <div className="text-fg/40 text-sm">Loading...</div>
      </div>
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
