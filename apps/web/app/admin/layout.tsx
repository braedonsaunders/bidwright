"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { Building2, LayoutDashboard, Library, LogOut, Shield, Users } from "lucide-react";
import { Button, SettingsShell, ThemeProvider, UiLinkProvider } from "@braedonsaunders/appkit-ui";
import { useAuth } from "@/components/auth-provider";

const adminNav = [
  { href: "/admin", label: "Overview", icon: LayoutDashboard },
  { href: "/admin/organizations", label: "Organizations", icon: Building2 },
  { href: "/admin/users", label: "People", icon: Users },
  { href: "/admin/catalogs", label: "Library", icon: Library },
];

export default function AdminLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, isSuperAdmin, loading, logout } = useAuth();

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace("/login");
      return;
    }
    if (!isSuperAdmin) {
      router.replace("/");
    }
  }, [loading, user, isSuperAdmin, router]);

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg">
        <div className="text-fg/40 text-sm">Loading...</div>
      </div>
    );
  }

  if (!isSuperAdmin) return null;

  const activeKey =
    adminNav.find((item) =>
      item.href === "/admin" ? pathname === "/admin" : pathname.startsWith(item.href),
    )?.href ?? "/admin";

  return (
    <UiLinkProvider link={Link}>
      <ThemeProvider storageKey="bidwright-theme">
        <div className="h-screen bg-bg text-fg">
          <SettingsShell
            title="System administration"
            description="Manage Bidwright organizations, people, access, and shared libraries."
            back={{ href: "/", label: "Back to Bidwright" }}
            contentWidth="full"
            nav={[
              {
                label: "Platform",
                items: adminNav.map((item) => {
                  const Icon = item.icon;
                  return { key: item.href, label: item.label, icon: <Icon /> };
                }),
              },
            ]}
            activeKey={activeKey}
            onSelect={(href) => router.push(href)}
            actions={
              <div className="flex items-center gap-2">
                <span className="hidden items-center gap-2 text-xs text-fg-muted md:flex">
                  <Shield className="size-3.5 text-primary" />
                  {user.name}
                </span>
                <Button variant="ghost" size="sm" onClick={logout}>
                  <LogOut className="size-3.5" />
                  Sign out
                </Button>
              </div>
            }
          >
            {children}
          </SettingsShell>
        </div>
      </ThemeProvider>
    </UiLinkProvider>
  );
}
