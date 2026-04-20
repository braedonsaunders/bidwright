"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { Building2, Database, LayoutDashboard, LogOut, Shield, Users } from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import { Button } from "@/components/ui";
import { cn } from "@/lib/utils";

const adminNav = [
  { href: "/admin", label: "Overview", icon: LayoutDashboard },
  { href: "/admin/organizations", label: "Organizations", icon: Building2 },
  { href: "/admin/users", label: "All Users", icon: Users },
  { href: "/admin/datasets", label: "Datasets", icon: Database },
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

  return (
    <div className="flex min-h-screen bg-bg text-fg">
      <aside className="flex w-60 shrink-0 flex-col border-r border-line bg-panel">
        <div className="flex items-center gap-2.5 border-b border-line px-4 py-4">
          <Shield className="h-5 w-5 text-accent" />
          <div>
            <h1 className="text-sm font-bold text-fg">Bidwright</h1>
            <p className="text-[10px] text-fg/30">System Administration</p>
          </div>
        </div>

        <nav className="flex-1 space-y-0.5 px-3 py-3">
          {adminNav.map((item) => {
            const Icon = item.icon;
            const active = item.href === "/admin"
              ? pathname === "/admin"
              : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-medium transition-colors",
                  active
                    ? "bg-accent/10 text-accent"
                    : "text-fg/50 hover:bg-panel2/50 hover:text-fg/70"
                )}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-line px-4 py-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-accent/10">
              <Shield className="h-3.5 w-3.5 text-accent" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium text-fg/70">{user.name}</p>
              <p className="truncate text-[10px] text-fg/30">{user.email}</p>
            </div>
          </div>
          <Button variant="ghost" size="xs" className="mt-2 w-full" onClick={logout}>
            <LogOut className="mr-1.5 h-3 w-3" />
            Sign Out
          </Button>
        </div>
      </aside>

      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  );
}
