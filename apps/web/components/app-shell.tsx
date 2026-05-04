"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  Building2,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  FileText,
  LayoutDashboard,
  Library,
  LogOut,
  Monitor,
  Moon,
  PackageOpen,
  Search,
  Settings,
  Shield,
  TrendingUp,
  Sun,
  User,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ProjectListItem, UserOrganization } from "@/lib/api";
import { searchTools, listMyOrganizations, switchOrganization } from "@/lib/api";
import { formatCompactMoney } from "@/lib/format";
import { Badge, Button, Input, Separator } from "@/components/ui";
import { useAuth } from "@/components/auth-provider";
import { BidwrightMark } from "@/components/brand-logo";

const navItems = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/intake", label: "Intake", icon: PackageOpen },
  { href: "/quotes", label: "Quotes", icon: FileText },
  { href: "/clients", label: "Clients", icon: Building2 },
  { href: "/library", label: "Library", icon: Library, activePaths: ["/library", "/knowledge"] },
  { href: "/performance", label: "Performance", icon: TrendingUp },
  { href: "/settings", label: "Settings", icon: Settings },
];

type ThemePreference = "light" | "dark" | "system";
type ResolvedTheme = "light" | "dark";

const THEME_OPTIONS: Array<{ value: ThemePreference; label: string; icon: typeof Sun }> = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
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
  const [theme, setTheme] = useState<ThemePreference>("system");
  const [systemDark, setSystemDark] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem("bidwright-theme");
    if (stored === "dark" || stored === "light" || stored === "system") {
      setTheme(stored);
    }
  }, []);

  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const syncSystemTheme = () => setSystemDark(query.matches);
    syncSystemTheme();
    query.addEventListener("change", syncSystemTheme);
    return () => query.removeEventListener("change", syncSystemTheme);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "dark") {
      root.classList.add("dark");
      root.classList.remove("light");
    } else if (theme === "light") {
      root.classList.add("light");
      root.classList.remove("dark");
    } else {
      root.classList.remove("light");
      root.classList.remove("dark");
    }
    localStorage.setItem("bidwright-theme", theme);
  }, [theme]);

  const resolvedTheme: ResolvedTheme = theme === "system" ? (systemDark ? "dark" : "light") : theme;
  return { theme, resolvedTheme, setTheme };
}

export function AppShell({
  children,
  projects: projectsProp,
}: {
  children: ReactNode;
  projects?: ProjectListItem[];
}) {
  const pathname = usePathname();
  const { theme, resolvedTheme, setTheme } = useTheme();
  const {
    user: authUser,
    organization: authOrg,
    impersonating,
    isSuperAdmin,
    loading: authLoading,
    logout,
    refreshUser,
  } = useAuth();
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [orgSwitcherOpen, setOrgSwitcherOpen] = useState(false);
  const [myOrgs, setMyOrgs] = useState<UserOrganization[]>([]);
  const [orgsLoaded, setOrgsLoaded] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Array<{ id: string; name: string; description: string; pluginId: string }>>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);

  // Self-fetch projects so sidebar always has data regardless of page
  const [selfProjects, setSelfProjects] = useState<ProjectListItem[]>([]);
  useEffect(() => {
    import("@/lib/api").then(({ getProjects }) =>
      getProjects().then(setSelfProjects).catch(() => {})
    );
  }, []);
  const projects = projectsProp && projectsProp.length > 0 ? projectsProp : selfProjects;

  // Active project selection (persisted in localStorage)
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [projectSelectorOpen, setProjectSelectorOpen] = useState(false);
  const [themeMenuOpen, setThemeMenuOpen] = useState(false);
  const projectSelectorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const stored = localStorage.getItem("bw_active_project");
    if (stored) setActiveProjectId(stored);
  }, []);

  // Auto-select first project if none selected
  useEffect(() => {
    if (!activeProjectId && projects.length > 0) {
      setActiveProjectId(projects[0].id);
      localStorage.setItem("bw_active_project", projects[0].id);
    }
  }, [activeProjectId, projects]);

  // Also detect active project from URL
  useEffect(() => {
    const match = pathname.match(/^\/projects\/([^/]+)/);
    if (match && match[1] !== activeProjectId) {
      setActiveProjectId(match[1]);
      localStorage.setItem("bw_active_project", match[1]);
    }
  }, [pathname, activeProjectId]);

  const activeProject = projects.find((p) => p.id === activeProjectId) ?? projects[0] ?? null;
  const themeOption = THEME_OPTIONS.find((option) => option.value === theme) ?? THEME_OPTIONS[2];
  const ThemeIcon = themeOption.icon;
  const flushWorkspace = pathname.startsWith("/library");
  const fittedWorkspace = pathname.startsWith("/clients");

  // Filter sidebar projects by search query
  const filteredProjects = searchQuery.trim()
    ? projects.filter((p) =>
        p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.clientName?.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : projects;

  const handleSearchSubmit = useCallback(async (query: string) => {
    if (!query.trim()) {
      setSearchResults([]);
      setSearchOpen(false);
      return;
    }
    try {
      const results = await searchTools(query);
      setSearchResults(results);
      setSearchOpen(true);
    } catch {
      setSearchResults([]);
      setSearchOpen(false);
    }
  }, []);

  // Close dropdowns when clicking outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      if (searchRef.current && !searchRef.current.contains(target)) {
        setSearchOpen(false);
      }
      if (projectSelectorRef.current && !projectSelectorRef.current.contains(target)) {
        setProjectSelectorOpen(false);
        setThemeMenuOpen(false);
      }
      // Close org switcher and user menu on outside clicks
      const sidebar = document.querySelector("aside");
      if (sidebar && !sidebar.contains(target)) {
        setOrgSwitcherOpen(false);
        setUserMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className="flex h-screen overflow-hidden bg-bg text-fg">
      {/* Sidebar */}
      <aside className="hidden w-60 shrink-0 border-r border-line bg-panel xl:flex xl:flex-col">
        <div className="border-b border-line px-3 py-3">
          <div className="relative">
            <button
              onClick={async () => {
                if (!orgsLoaded) {
                  try {
                    const orgs = await listMyOrganizations();
                    setMyOrgs(orgs);
                  } catch { /* ignore */ }
                  setOrgsLoaded(true);
                }
                setOrgSwitcherOpen((v) => !v);
              }}
              className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-panel2/50 transition-colors"
            >
              <BidwrightMark className="h-8 w-8" />
              <div className="min-w-0 flex-1 text-left">
                <p className="text-sm font-semibold tracking-tight truncate">
                  Bidwright
                </p>
                <p className="truncate text-[10px] font-medium uppercase tracking-widest text-fg/30">
                  {authOrg?.name ?? (isSuperAdmin ? "Super Admin" : "Personal")}
                </p>
              </div>
              <ChevronsUpDown className="h-3.5 w-3.5 text-fg/25 shrink-0" />
            </button>

            {orgSwitcherOpen && (
              <div className="absolute left-0 right-0 top-full z-50 mt-1 rounded-lg border border-line bg-panel shadow-lg py-1">
                <div className="px-3 py-1.5 text-[10px] font-medium uppercase tracking-wider text-fg/30">
                  Organizations
                </div>
                {myOrgs.length === 0 && (
                  <div className="px-3 py-2 text-xs text-fg/40">No other organizations</div>
                )}
                {myOrgs.map((org) => (
                  <button
                    key={org.organizationId}
                    onClick={async () => {
                      if (org.current) {
                        setOrgSwitcherOpen(false);
                        return;
                      }
                      try {
                        await switchOrganization(org.organizationId);
                        await refreshUser();
                        setOrgSwitcherOpen(false);
                        window.location.href = "/";
                      } catch { /* ignore */ }
                    }}
                    className={cn(
                      "flex w-full items-center gap-2 px-3 py-2 text-xs transition-colors",
                      org.current ? "text-accent bg-accent/5" : "text-fg/60 hover:bg-panel2 hover:text-fg"
                    )}
                  >
                    <span className="flex-1 text-left truncate">{org.name}</span>
                    {org.current && <Check className="h-3 w-3 text-accent" />}
                  </button>
                ))}
                {isSuperAdmin && (
                  <>
                    <div className="my-1 border-t border-line" />
                    <Link
                      href="/admin"
                      onClick={() => setOrgSwitcherOpen(false)}
                      className="flex items-center gap-2 px-3 py-2 text-xs text-amber-500/80 hover:bg-amber-500/10 hover:text-amber-500 transition-colors"
                    >
                      <Shield className="h-3 w-3" />
                      Admin Panel
                    </Link>
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        <div ref={searchRef} className="px-3 pt-3">
          <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg/25" />
          <Input
            className="h-8 pl-8 text-xs"
            placeholder="Search..."
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              if (!e.target.value.trim()) {
                setSearchResults([]);
                setSearchOpen(false);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                handleSearchSubmit(searchQuery);
              }
              if (e.key === "Escape") {
                setSearchOpen(false);
              }
            }}
          />
          {searchOpen && searchResults.length > 0 && (
            <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-64 overflow-y-auto rounded-lg border border-line bg-panel shadow-lg">
              <div className="px-3 py-1.5 text-[10px] font-medium uppercase tracking-wider text-fg/30">
                Tools ({searchResults.length})
              </div>
              {searchResults.map((result) => (
                <div
                  key={result.id}
                  className="flex flex-col gap-0.5 border-t border-line/50 px-3 py-2 text-xs hover:bg-panel2 cursor-pointer"
                  onClick={() => setSearchOpen(false)}
                >
                  <span className="font-medium text-fg/80">{result.name}</span>
                  {result.description && (
                    <span className="text-[11px] text-fg/40 truncate">{result.description}</span>
                  )}
                </div>
              ))}
            </div>
          )}
          {searchOpen && searchResults.length === 0 && searchQuery.trim() && (
            <div className="absolute left-0 right-0 top-full z-50 mt-1 rounded-lg border border-line bg-panel shadow-lg px-3 py-3 text-xs text-fg/40">
              No tools found for "{searchQuery}"
            </div>
          )}
          </div>
        </div>

        <nav className="flex-1 space-y-0.5 px-3 py-3">
          {navItems.map((item) => {
            const active = item.href === "/"
              ? pathname === "/"
              : (item.activePaths ?? [item.href]).some((href) => pathname.startsWith(href));
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

          {(() => {
            const quotesToShow = searchQuery.trim()
              ? filteredProjects
                  .flatMap((p) => p.quote ? [{ ...p.quote, projectName: p.name }] : [])
              : activeProject?.quote
                ? [{ ...activeProject.quote, projectName: activeProject.name }]
                : [];
            return quotesToShow.length > 0 && (
              <>
                <div className="px-3 pb-1 pt-5">
                  <span className="text-[11px] font-medium uppercase tracking-wider text-fg/30">
                    Quotes{searchQuery.trim() ? ` (${quotesToShow.length})` : ""}
                  </span>
                </div>
                {quotesToShow.slice(0, 6).map((quote) => {
                  const isActive = pathname.startsWith(`/quotes/${quote.id}`);
                  return (
                    <Link
                      key={quote.id}
                      href={`/quotes/${quote.id}`}
                      className={cn(
                        "flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-[13px] transition-colors",
                        isActive
                          ? "bg-accent/10 text-accent font-medium"
                          : "text-fg/55 hover:bg-panel2 hover:text-fg/80"
                      )}
                    >
                      <div className="min-w-0 flex-1">
                        <span className="block truncate">{quote.title || quote.quoteNumber}</span>
                        {searchQuery.trim() && (
                          <span className="block truncate text-[10px] text-fg/30">{quote.projectName}</span>
                        )}
                      </div>
                      <Badge tone={statusTone(quote.status)} className="shrink-0">
                        {quote.status}
                      </Badge>
                    </Link>
                  );
                })}
              </>
            );
          })()}
        </nav>

        {activeProject && (
          <div ref={projectSelectorRef} className="relative border-t border-line px-4 py-3">
            <div className="flex items-center justify-between text-xs text-fg/40">
              <span>Active Project</span>
              <div className="flex items-center gap-1">
                <span>{formatCompactMoney(activeProject.latestRevision?.subtotal ?? 0)}</span>
                <div className="relative">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setThemeMenuOpen((open) => !open);
                    }}
                    className="rounded-md p-1 text-fg/40 transition-colors hover:bg-panel2/50 hover:text-fg/70"
                    title={`Theme: ${themeOption.label}${theme === "system" ? ` (${resolvedTheme})` : ""}`}
                  >
                    <ThemeIcon className="h-3.5 w-3.5" />
                  </button>
                  {themeMenuOpen ? (
                    <div className="absolute bottom-full right-0 z-50 mb-1 w-32 rounded-lg border border-line bg-panel p-1 shadow-lg">
                      {THEME_OPTIONS.map((option) => {
                        const Icon = option.icon;
                        const selected = theme === option.value;
                        return (
                          <button
                            key={option.value}
                            type="button"
                            className={cn(
                              "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-panel2",
                              selected ? "text-accent" : "text-fg/70",
                            )}
                            onClick={(event) => {
                              event.stopPropagation();
                              setTheme(option.value);
                              setThemeMenuOpen(false);
                            }}
                          >
                            <Icon className="h-3.5 w-3.5" />
                            <span className="min-w-0 flex-1">{option.label}</span>
                            {selected ? <Check className="h-3.5 w-3.5" /> : null}
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
            <button
              onClick={() => setProjectSelectorOpen((v) => !v)}
              className="mt-2 flex w-full items-center justify-between rounded-lg bg-panel2 px-3 py-2 text-xs font-medium text-fg/70 transition-colors hover:bg-panel2/80 hover:text-fg"
            >
              <span className="truncate">{activeProject.name}</span>
              <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 transition-transform", projectSelectorOpen && "rotate-180")} />
            </button>

            {projectSelectorOpen && projects.length > 0 && (
              <div className="absolute bottom-full left-3 right-3 mb-1 max-h-56 overflow-y-auto rounded-lg border border-line bg-panel shadow-lg py-1 z-50">
                <div className="px-3 py-1.5 text-[10px] font-medium uppercase tracking-wider text-fg/30">
                  Switch Project
                </div>
                {projects.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => {
                      setActiveProjectId(p.id);
                      localStorage.setItem("bw_active_project", p.id);
                      setProjectSelectorOpen(false);
                    }}
                    className={cn(
                      "flex w-full items-center gap-2 px-3 py-2 text-xs transition-colors",
                      p.id === activeProject.id
                        ? "text-accent bg-accent/5"
                        : "text-fg/60 hover:bg-panel2 hover:text-fg"
                    )}
                  >
                    <span className="flex-1 text-left truncate">{p.name}</span>
                    {p.id === activeProject.id && <Check className="h-3 w-3 text-accent" />}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="relative border-t border-line px-4 py-3">
          <button
            onClick={() => setUserMenuOpen((v) => !v)}
            className="flex w-full items-center gap-2.5 rounded-lg px-1 py-1 -mx-1 hover:bg-panel2/50 transition-colors"
          >
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-panel2">
              <User className="h-3.5 w-3.5 text-fg/50" />
            </div>
            <div className="min-w-0 flex-1 text-left">
              <p className="truncate text-xs font-medium text-fg/70">
                {authLoading ? "Loading..." : authUser?.name ?? "Not signed in"}
              </p>
              <p className="truncate text-[10px] text-fg/30">{authUser?.email ?? ""}</p>
            </div>
            <ChevronRight className={cn("h-3 w-3 text-fg/30 transition-transform", userMenuOpen && "rotate-90")} />
          </button>

          {userMenuOpen && (
            <div className="absolute bottom-full left-3 right-3 mb-1 rounded-lg border border-line bg-panel shadow-lg py-1 z-50">
              <Link
                href="/profile"
                onClick={() => setUserMenuOpen(false)}
                className="flex items-center gap-2 px-3 py-2 text-xs text-fg/60 hover:bg-panel2 hover:text-fg transition-colors"
              >
                <User className="h-3.5 w-3.5" />
                Profile
              </Link>
              <div className="my-1 border-t border-line" />
              <button
                onClick={() => { setUserMenuOpen(false); logout(); }}
                className="flex w-full items-center gap-2 px-3 py-2 text-xs text-danger/70 hover:bg-danger/10 hover:text-danger transition-colors"
              >
                <LogOut className="h-3.5 w-3.5" />
                Sign Out
              </button>
            </div>
          )}
        </div>
      </aside>

      {/* Main content */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <main
          className={cn(
            "flex min-h-0 flex-1 flex-col",
            flushWorkspace ? "overflow-hidden p-0" : fittedWorkspace ? "overflow-hidden p-5" : "overflow-y-auto p-5",
          )}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
