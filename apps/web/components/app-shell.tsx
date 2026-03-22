"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import {
  BookOpen,
  ChevronRight,
  FileText,
  FolderOpen,
  LayoutDashboard,
  Moon,
  Package,
  PackageOpen,
  Puzzle,
  Search,
  Settings,
  TrendingUp,
  Sun,
  User,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ProjectListItem } from "@/lib/api";
import { formatCompactMoney } from "@/lib/format";
import { Badge, Button, Input, Separator } from "@/components/ui";

const navItems = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/intake", label: "Intake", icon: PackageOpen },
  { href: "/quotes", label: "Quotes", icon: FileText },
  { href: "/items", label: "Items", icon: Package },
  { href: "/knowledge", label: "Knowledge", icon: BookOpen },
  { href: "/plugins", label: "Plugins", icon: Puzzle },
  { href: "/performance", label: "Performance", icon: TrendingUp },
  { href: "/settings", label: "Settings", icon: Settings },
];

function statusTone(status: string) {
  if (!status) return "default" as const;
  switch (status.toLowerCase()) {
    case "estimate": case "closed": return "success" as const;
    case "review": return "warning" as const;
    default: return "default" as const;
  }
}

function useTheme() {
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    const stored = localStorage.getItem("bidwright-theme");
    if (stored === "dark" || stored === "light") {
      setTheme(stored);
    } else if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
      setTheme("dark");
    }
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "dark") {
      root.classList.add("dark");
      root.classList.remove("light");
    } else {
      root.classList.add("light");
      root.classList.remove("dark");
    }
    localStorage.setItem("bidwright-theme", theme);
  }, [theme]);

  return { theme, toggle: () => setTheme((t) => (t === "dark" ? "light" : "dark")) };
}

export function AppShell({
  children,
  projects = [],
}: {
  children: ReactNode;
  projects?: ProjectListItem[];
}) {
  const pathname = usePathname();
  const { theme, toggle } = useTheme();

  return (
    <div className="flex min-h-screen bg-bg text-fg">
      {/* Sidebar */}
      <aside className="hidden w-60 shrink-0 border-r border-line bg-panel xl:flex xl:flex-col">
        <div className="flex items-center gap-2.5 px-5 py-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-accent-fg">
            <FolderOpen className="h-4 w-4" />
          </div>
          <span className="text-sm font-semibold tracking-tight">Bidwright</span>
        </div>

        <Separator />

        <nav className="flex-1 space-y-0.5 px-3 py-3">
          {navItems.map((item) => {
            const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] transition-colors",
                  active
                    ? "bg-accent/10 text-accent font-medium"
                    : "text-fg/55 hover:bg-panel2 hover:text-fg/80"
                )}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}

          {projects.length > 0 && (
            <>
              <div className="px-3 pb-1 pt-5">
                <span className="text-[11px] font-medium uppercase tracking-wider text-fg/30">
                  Projects
                </span>
              </div>
              {projects.slice(0, 6).map((project) => {
                const active = pathname.startsWith(`/projects/${project.id}`);
                return (
                  <Link
                    key={project.id}
                    href={`/projects/${project.id}`}
                    className={cn(
                      "flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-[13px] transition-colors",
                      active
                        ? "bg-accent/10 text-accent font-medium"
                        : "text-fg/55 hover:bg-panel2 hover:text-fg/80"
                    )}
                  >
                    <span className="truncate">{project.name}</span>
                    <Badge tone={statusTone(project.ingestionStatus)} className="shrink-0">
                      {project.ingestionStatus}
                    </Badge>
                  </Link>
                );
              })}
            </>
          )}
        </nav>

        {projects[0] && (
          <div className="border-t border-line px-4 py-3">
            <div className="flex items-center justify-between text-xs text-fg/40">
              <span>Active</span>
              <span>{formatCompactMoney(projects[0].latestRevision.subtotal)}</span>
            </div>
            <Link
              href={`/projects/${projects[0].id}`}
              className="mt-2 flex items-center justify-between rounded-lg bg-panel2 px-3 py-2 text-xs font-medium text-fg/70 transition-colors hover:bg-panel2/80 hover:text-fg"
            >
              <span className="truncate">{projects[0].name}</span>
              <ChevronRight className="h-3.5 w-3.5 shrink-0" />
            </Link>
          </div>
        )}

        <div className="border-t border-line px-4 py-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-panel2">
              <User className="h-3.5 w-3.5 text-fg/50" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-xs font-medium text-fg/70">Estimator</p>
            </div>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-line bg-panel px-5 py-3">
          <div className="relative flex-1 max-w-md">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg/25" />
            <Input className="h-8 pl-8 text-xs" placeholder="Search projects, quotes, or specs..." />
          </div>
          <button
            onClick={toggle}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-fg/40 transition-colors hover:bg-panel2 hover:text-fg/70"
            title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          >
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
        </header>

        <main className="flex-1 overflow-auto p-5">{children}</main>
      </div>
    </div>
  );
}
