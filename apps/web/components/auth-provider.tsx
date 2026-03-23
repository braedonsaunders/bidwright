"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useRouter, usePathname } from "next/navigation";
import type { AuthUser, OrgInfo, MeResponse } from "@/lib/api";
import {
  login as apiLogin,
  signup as apiSignup,
  superLogin as apiSuperLogin,
  logout as apiLogout,
  getCurrentUser,
  getSetupStatus,
  adminImpersonate,
  adminStopImpersonation,
  adminGetMyMemberships,
} from "@/lib/api";

// ---------------------------------------------------------------------------
// Context shape
// ---------------------------------------------------------------------------

interface AuthContextValue {
  user: AuthUser | null;
  organization: OrgInfo | null;
  token: string | null;
  isSuperAdmin: boolean;
  impersonating: boolean;
  /** True when the super admin is impersonating an org they also belong to as a user */
  isOwnOrg: boolean;
  loading: boolean;
  initialized: boolean | null; // null = unknown, true = system set up, false = needs setup
  login: (email: string, password: string, orgSlug?: string) => Promise<void>;
  signup: (data: { orgName: string; orgSlug: string; email: string; name: string; password: string }) => Promise<void>;
  superLogin: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  impersonate: (orgId: string) => Promise<void>;
  stopImpersonation: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

const PUBLIC_PATHS = ["/login", "/signup", "/setup"];

export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [organization, setOrganization] = useState<OrgInfo | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [impersonating, setImpersonating] = useState(false);
  const [myOrgIds, setMyOrgIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [initialized, setInitialized] = useState<boolean | null>(null);

  // Check setup status + validate token on mount
  useEffect(() => {
    (async () => {
      try {
        // Check if system is initialized
        const status = await getSetupStatus();
        setInitialized(status.initialized);

        if (!status.initialized) {
          setLoading(false);
          if (pathname !== "/setup") {
            router.replace("/setup");
          }
          return;
        }

        // Check for existing token
        const storedToken = localStorage.getItem("bw_token");
        if (!storedToken) {
          setLoading(false);
          return;
        }

        setToken(storedToken);
        const me = await getCurrentUser();
        setUser(me.user);
        setOrganization(me.organization);
        setIsSuperAdmin(me.isSuperAdmin);
        setImpersonating(me.impersonating);
        if (me.isSuperAdmin) {
          try {
            const m = await adminGetMyMemberships();
            setMyOrgIds(m.organizationIds);
          } catch { /* ignore */ }
        }
      } catch {
        // Token invalid or API unreachable
        localStorage.removeItem("bw_token");
        localStorage.removeItem("bw_user");
        localStorage.removeItem("bw_org");
        setToken(null);
        setUser(null);
      } finally {
        setLoading(false);
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const refreshUser = useCallback(async () => {
    try {
      const me = await getCurrentUser();
      setUser(me.user);
      setOrganization(me.organization);
      setIsSuperAdmin(me.isSuperAdmin);
      setImpersonating(me.impersonating);
    } catch {
      // ignore
    }
  }, []);

  const login = useCallback(async (email: string, password: string, orgSlug?: string) => {
    const result = await apiLogin(email, password, orgSlug);
    localStorage.setItem("bw_token", result.token);
    localStorage.setItem("bw_user", JSON.stringify(result.user));
    if (result.organization) {
      localStorage.setItem("bw_org", JSON.stringify(result.organization));
    }
    setToken(result.token);
    setUser(result.user);
    setOrganization(result.organization ?? null);
    const superAdmin = !!(result as any).isSuperAdmin;
    setIsSuperAdmin(superAdmin);
    setImpersonating(false);
    // Super admins without an org land on admin panel
    if (superAdmin && !result.organization) {
      router.push("/admin");
    } else {
      router.push("/");
    }
  }, [router]);

  const signupFn = useCallback(async (data: { orgName: string; orgSlug: string; email: string; name: string; password: string }) => {
    const result = await apiSignup(data);
    localStorage.setItem("bw_token", result.token);
    localStorage.setItem("bw_user", JSON.stringify(result.user));
    localStorage.setItem("bw_org", JSON.stringify(result.organization));
    setToken(result.token);
    setUser(result.user);
    setOrganization(result.organization);
    setIsSuperAdmin(false);
    setImpersonating(false);
    setInitialized(true);
    router.push("/");
  }, [router]);

  const superLoginFn = useCallback(async (email: string, password: string) => {
    const result = await apiSuperLogin(email, password);
    localStorage.setItem("bw_token", result.token);
    setToken(result.token);
    setUser({ id: result.superAdmin.id, email: result.superAdmin.email, name: result.superAdmin.name, role: "admin", active: true });
    setOrganization(null);
    setIsSuperAdmin(true);
    setImpersonating(false);
    try {
      const m = await adminGetMyMemberships();
      setMyOrgIds(m.organizationIds);
    } catch { /* ignore */ }
    router.push("/admin");
  }, [router]);

  const logoutFn = useCallback(async () => {
    try { await apiLogout(); } catch { /* ignore */ }
    localStorage.removeItem("bw_token");
    localStorage.removeItem("bw_user");
    localStorage.removeItem("bw_org");
    localStorage.removeItem("bw_super_token");
    setToken(null);
    setUser(null);
    setOrganization(null);
    setIsSuperAdmin(false);
    setImpersonating(false);
    router.push("/login");
  }, [router]);

  const impersonateFn = useCallback(async (orgId: string) => {
    // Save current super admin token
    const currentToken = localStorage.getItem("bw_token");
    if (currentToken) {
      localStorage.setItem("bw_super_token", currentToken);
    }
    const result = await adminImpersonate(orgId);
    localStorage.setItem("bw_token", result.token);
    localStorage.setItem("bw_org", JSON.stringify(result.organization));
    setToken(result.token);
    setOrganization(result.organization);
    setImpersonating(true);
    router.push("/");
  }, [router]);

  const stopImpersonationFn = useCallback(async () => {
    try { await adminStopImpersonation(); } catch { /* ignore */ }
    const superToken = localStorage.getItem("bw_super_token");
    if (superToken) {
      localStorage.setItem("bw_token", superToken);
      localStorage.removeItem("bw_super_token");
      setToken(superToken);
    }
    localStorage.removeItem("bw_org");
    setOrganization(null);
    setImpersonating(false);
    // Refresh user info with the restored super admin token
    try {
      const me = await getCurrentUser();
      setUser(me.user);
      setIsSuperAdmin(me.isSuperAdmin);
    } catch { /* ignore */ }
    router.push("/admin");
  }, [router]);

  const isOwnOrg = impersonating && !!organization && myOrgIds.includes(organization.id);

  return (
    <AuthContext.Provider
      value={{
        user,
        organization,
        token,
        isSuperAdmin,
        impersonating,
        isOwnOrg,
        loading,
        initialized,
        login,
        signup: signupFn,
        superLogin: superLoginFn,
        logout: logoutFn,
        impersonate: impersonateFn,
        stopImpersonation: stopImpersonationFn,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Impersonation banner
// ---------------------------------------------------------------------------

export function ImpersonationBanner() {
  const { impersonating, isOwnOrg, organization, stopImpersonation } = useAuth();
  const pathname = usePathname();
  const [dismissed, setDismissed] = useState(false);

  // Don't show on admin page, if dismissed, or if it's the admin's own org
  if (!impersonating || pathname.startsWith("/admin") || dismissed || isOwnOrg) return null;

  return (
    <div className="relative z-[100] flex items-center justify-center gap-3 bg-amber-500 px-4 py-1 text-xs font-medium text-black">
      <span>Viewing as <strong>{organization?.name ?? "Unknown"}</strong></span>
      <button
        onClick={stopImpersonation}
        className="rounded bg-black/20 px-1.5 py-0.5 text-[10px] font-semibold hover:bg-black/30 transition-colors"
      >
        Return to Admin
      </button>
      <button
        onClick={() => setDismissed(true)}
        className="absolute right-2 top-1/2 -translate-y-1/2 rounded px-1 text-black/50 hover:text-black hover:bg-black/10 transition-colors"
        aria-label="Dismiss"
      >
        &times;
      </button>
    </div>
  );
}
