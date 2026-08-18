"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { ShieldAlert } from "lucide-react";
import {
  AccountMenu,
  AppShell as AppkitAppShell,
  Badge,
  GlobalSearch,
  NavigationModeProvider,
  resolveNavigationItems,
  ThemeProvider,
  ThemeToggle,
  UiLinkProvider,
  useNavigationMode,
  type GlobalSearchResult,
  type LinkRender,
  type SidebarNavGroup,
  type TenantNavigationConfig,
} from "@braedonsaunders/appkit-ui";
import { PageTransition } from "@braedonsaunders/appkit-ui/page-transition";
import { BidwrightMark } from "@/components/brand-logo";
import { ImpersonationBanner, useAuth } from "@/components/auth-provider";
import {
  getCustomers,
  getNavigationConfig,
  getProjects,
  listMyOrganizations,
  switchOrganization,
  type Customer,
  type ProjectListItem,
  type UserOrganization,
} from "@/lib/api";
import { BIDWRIGHT_NAVIGATION_REGISTRY } from "@/lib/navigation-config";
import { isDemoMode } from "@/lib/demo-mode";
import { formatCompactMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

const nextLink: LinkRender = ({
  href,
  children,
  className,
  title,
  ariaCurrent,
  role,
  dataWalkthrough,
}) => (
  <Link
    href={href}
    className={className}
    title={title}
    aria-current={ariaCurrent}
    role={role}
    data-walkthrough={dataWalkthrough}
  >
    {children}
  </Link>
);

const SHELLLESS_PATHS = [
  "/login",
  "/signup",
  "/setup",
  "/admin",
  "/takeoff-viewer",
  "/qa",
];

function isShelllessPath(pathname: string): boolean {
  return SHELLLESS_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );
}

/**
 * The persistent authenticated application frame. Keeping this above routed
 * pages makes Bidwright behave like its AppKit siblings: navigation, search,
 * theme, and account state survive soft route changes.
 */
export function ApplicationFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  if (isShelllessPath(pathname)) return children;

  return (
    <UiLinkProvider link={Link}>
      <ThemeProvider storageKey="bidwright-theme">
        <NavigationModeProvider
          defaultMode="topbar"
          cookieName="bidwright-navigation-mode"
        >
          <BidwrightShell>{children}</BidwrightShell>
        </NavigationModeProvider>
      </ThemeProvider>
    </UiLinkProvider>
  );
}

function BidwrightShell({ children }: { children: ReactNode }) {
  const t = useTranslations("AppShell");
  const pathname = usePathname();
  const router = useRouter();
  const navigation = useNavigationMode();
  const {
    user,
    organization,
    impersonating,
    isSuperAdmin,
    loading: authLoading,
    logout,
    refreshUser,
  } = useAuth();
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [organizations, setOrganizations] = useState<UserOrganization[]>([]);
  const [navigationConfig, setNavigationConfig] =
    useState<TenantNavigationConfig | null>(null);

  useEffect(() => {
    if (authLoading) return;
    let cancelled = false;
    setNavigationConfig(null);

    Promise.allSettled([
      getProjects(),
      getCustomers(),
      listMyOrganizations(),
      getNavigationConfig(),
    ]).then(([projectsResult, customersResult, organizationsResult, navigationResult]) => {
      if (cancelled) return;
      if (projectsResult.status === "fulfilled") {
        setProjects(projectsResult.value);
      }
      if (customersResult.status === "fulfilled") {
        setCustomers(customersResult.value);
      }
      if (organizationsResult.status === "fulfilled") {
        setOrganizations(organizationsResult.value);
      }
      if (navigationResult.status === "fulfilled") {
        setNavigationConfig(navigationResult.value.config);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [authLoading, organization?.id]);

  useEffect(() => {
    const handleNavigationUpdate = (event: Event) => {
      const detail = (event as CustomEvent<TenantNavigationConfig>).detail;
      if (detail) setNavigationConfig(detail);
    };
    window.addEventListener(
      "bidwright:navigation-updated",
      handleNavigationUpdate,
    );
    return () =>
      window.removeEventListener(
        "bidwright:navigation-updated",
        handleNavigationUpdate,
      );
  }, []);

  const navigationRegistry = useMemo(
    () =>
      BIDWRIGHT_NAVIGATION_REGISTRY.map((item) => ({
        ...item,
        label:
          item.key === "profile"
            ? t("profile")
            : t(`nav.${item.key}` as Parameters<typeof t>[0]),
      })),
    [t],
  );

  const groups = useMemo<SidebarNavGroup[]>(
    () =>
      resolveNavigationItems(navigationRegistry, navigationConfig)
        .filter((item) => !item.hidden)
        .map((item) => ({
          id: item.key,
          label: item.label,
          items: [
            {
              href: item.href,
              label: item.label,
              iconKey: item.iconKey,
              exact: item.exact,
              mobile: item.mobile,
            },
          ],
        })),
    [navigationConfig, navigationRegistry],
  );

  const search = useCallback(
    async (
      query: string,
      signal: AbortSignal,
    ): Promise<GlobalSearchResult> => {
      signal.throwIfAborted();
      const term = query.trim().toLowerCase();

      const projectHits = projects
        .filter(
          (project) =>
            project.name.toLowerCase().includes(term) ||
            project.clientName?.toLowerCase().includes(term) ||
            project.location?.toLowerCase().includes(term),
        )
        .map((project) => ({
          id: project.id,
          type: "project",
          title: project.name,
          subtitle: [project.clientName, project.location]
            .filter(Boolean)
            .join(" · "),
          href: `/projects/${project.id}`,
          iconKey: "folder",
          meta: project.latestRevision
            ? formatCompactMoney(project.latestRevision.subtotal)
            : undefined,
        }));

      const seenQuotes = new Set<string>();
      const quoteHits = projects.flatMap((project) => {
        const entries = project.quotes?.length
          ? project.quotes
          : project.quote
            ? [{ quote: project.quote, latestRevision: project.latestRevision }]
            : [];

        return entries.flatMap(({ quote, latestRevision }) => {
          if (seenQuotes.has(quote.id)) return [];
          const searchable =
            `${quote.quoteNumber} ${quote.title ?? ""} ${quote.status} ${project.name}`.toLowerCase();
          if (!searchable.includes(term)) return [];
          seenQuotes.add(quote.id);
          return [
            {
              id: quote.id,
              type: "quote",
              title: quote.title || quote.quoteNumber,
              subtitle: `${quote.quoteNumber} · ${project.name}`,
              href: `/quotes/${quote.id}`,
              iconKey: "file",
              badge: quote.status,
              meta: latestRevision
                ? formatCompactMoney(latestRevision.subtotal)
                : undefined,
            },
          ];
        });
      });

      const clientHits = customers
        .filter(
          (customer) =>
            customer.name.toLowerCase().includes(term) ||
            customer.shortName?.toLowerCase().includes(term) ||
            customer.email?.toLowerCase().includes(term) ||
            customer.addressCity?.toLowerCase().includes(term),
        )
        .map((customer) => ({
          id: customer.id,
          type: "client",
          title: customer.name,
          subtitle: [customer.email, customer.addressCity]
            .filter(Boolean)
            .join(" · "),
          href: `/clients/${customer.id}`,
          iconKey: "building",
        }));

      const resultGroups = [
        {
          id: "projects",
          label: t("nav.projects"),
          hits: projectHits.slice(0, 6),
        },
        {
          id: "quotes",
          label: t("nav.quotes"),
          hits: quoteHits.slice(0, 6),
        },
        {
          id: "clients",
          label: t("nav.clients"),
          hits: clientHits.slice(0, 6),
        },
      ].filter((group) => group.hits.length > 0);

      return {
        groups: resultGroups,
        total: resultGroups.reduce((total, group) => total + group.hits.length, 0),
      };
    },
    [customers, projects, t],
  );

  const organizationOptions = useMemo(() => {
    if (organizations.length > 0) {
      return organizations.map((item) => ({
        value: item.organizationId,
        label: item.name,
        description: item.current ? item.role : `${item.role} · ${item.slug}`,
      }));
    }
    return organization
      ? [
          {
            value: organization.id,
            label: organization.name,
            description: organization.slug,
          },
        ]
      : [];
  }, [organization, organizations]);

  const fittedWorkspace =
    pathname.startsWith("/clients") ||
    pathname.startsWith("/performance") ||
    pathname.startsWith("/projects") ||
    pathname.startsWith("/settings") ||
    pathname.startsWith("/quotes") ||
    pathname.startsWith("/profile");
  const flushWorkspace =
    pathname.startsWith("/library") ||
    pathname === "/clients" ||
    pathname === "/projects" ||
    pathname === "/quotes" ||
    pathname === "/settings";

  return (
    <AppkitAppShell
      groups={groups}
      pathname={pathname}
      navigationMode={navigation.mode}
      topNavigationItemClassName="font-normal"
      topNavigationInactiveItemClassName="text-fg-subtle hover:text-fg-muted"
      linkRender={nextLink}
      brand={<BrandHomeLink />}
      headerMiddle={
        <GlobalSearch
          search={search}
          onNavigate={(hit) => router.push(hit.href)}
          className="hidden w-56 shrink-0 lg:block xl:w-80"
          minimumQueryLength={1}
          labels={{
            placeholder: t("searchPlaceholder"),
            ariaLabel: t("searchPlaceholder"),
            clear: "Clear search",
            searching: "Searching…",
            noMatches: (query) => t("noResults", { query }),
            navigate: "navigate",
            open: "open",
            close: "close",
            resultCount: (count) => `${count} result${count === 1 ? "" : "s"}`,
          }}
        />
      }
      header={
        <>
          {isDemoMode ? (
            <Badge variant="warning" className="hidden sm:inline-flex">
              Public demo
            </Badge>
          ) : null}
          <AccountMenu
            name={authLoading ? t("loading") : user?.name ?? t("notSignedIn")}
            email={user?.email ?? ""}
            contextLabel={organization?.name ?? (isSuperAdmin ? t("superAdmin") : t("personal"))}
            contextTone={impersonating ? "warning" : "default"}
            roleLabel={user?.role}
            status={
              impersonating
                ? { label: "Impersonating", variant: "warning" }
                : isDemoMode
                  ? { label: "Demo workspace", variant: "warning" }
                  : undefined
            }
            organization={
              organization && organizationOptions.length > 0
                ? {
                    label: t("organizations"),
                    summary: organization.name,
                    value: organization.id,
                    options: organizationOptions,
                    onChange: async (organizationId) => {
                      if (organizationId === organization.id) return;
                      await switchOrganization(organizationId);
                      await refreshUser();
                      window.location.assign("/");
                    },
                  }
                : undefined
            }
            navigation={{
              label: "Menu layout",
              summary: navigation.mode === "topbar" ? "Top bar" : "Sidebar",
              value: navigation.mode,
              options: [
                {
                  value: "topbar",
                  label: "Top bar",
                  description: "Module menus across the workspace",
                },
                {
                  value: "sidebar",
                  label: "Sidebar",
                  description: "A collapsible navigation rail",
                },
              ],
              onChange: (mode) =>
                navigation.setMode(mode === "sidebar" ? "sidebar" : "topbar"),
            }}
            elevatedAccess={
              isSuperAdmin
                ? { label: t("adminPanel"), href: "/admin" }
                : undefined
            }
            onSignOut={isDemoMode ? undefined : logout}
            labels={{
              menu: authLoading ? t("loading") : user?.name ?? t("notSignedIn"),
              account: t("profile"),
              signOut: t("signOut"),
            }}
          />
        </>
      }
      banner={
        impersonating || isDemoMode ? (
          <>
            <ImpersonationBanner />
            {isDemoMode ? (
              <div className="flex shrink-0 items-center justify-center gap-2 border-b border-warning/30 bg-warning-subtle px-4 py-1 text-xs text-warning">
                <ShieldAlert size={14} />
                Database editing is enabled; agents, uploads, delivery, and external integrations are disabled.
              </div>
            ) : null}
          </>
        ) : undefined
      }
      sidebarFooter={<SidebarFooter projects={projects} />}
      sidebarCollapsedFooter={
        <div className="flex justify-center">
          <ThemeToggle collapsed />
        </div>
      }
      mobileFooter={<ThemeToggle />}
      moreLabel="More"
      menuLabel="Menu"
      primaryNavigationLabel="Primary navigation"
    >
      <PageTransition navigationKey={pathname}>
        <div
          className={cn(
            "flex min-h-0 flex-1 flex-col",
            flushWorkspace
              ? "overflow-hidden p-0"
              : fittedWorkspace
                ? "overflow-hidden p-5"
                : "overflow-y-auto p-5",
          )}
        >
          {children}
        </div>
      </PageTransition>
    </AppkitAppShell>
  );
}

function BrandHomeLink() {
  return (
    <div className="flex h-14 items-center gap-3">
      <Link
        href="/"
        aria-label="Bidwright home"
        className="flex items-center gap-2 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
      >
        <BidwrightMark className="size-8" />
        <span className="translate-y-px text-sm font-semibold leading-5 tracking-tight text-fg">Bidwright</span>
      </Link>
      <span aria-hidden="true" className="h-6 w-px shrink-0 bg-border/70" />
    </div>
  );
}

function SidebarFooter({ projects }: { projects: ProjectListItem[] }) {
  return (
    <div className="space-y-3">
      {projects.length > 0 ? (
        <div>
          <div className="px-1 pb-1 text-[10px] font-semibold tracking-wider text-fg-subtle uppercase">
            Recent
          </div>
          <div className="space-y-0.5">
            {projects.slice(0, 3).map((project) => (
              <Link
                key={project.id}
                href={`/projects/${project.id}`}
                className="block rounded-md px-2 py-1.5 transition-colors hover:bg-surface-hover"
              >
                <span className="block truncate text-xs font-medium text-fg">
                  {project.name}
                </span>
                <span className="block truncate text-[10px] text-fg-subtle">
                  {project.clientName}
                </span>
              </Link>
            ))}
          </div>
        </div>
      ) : null}
      <ThemeToggle />
      <div className="px-1 text-[10px] text-fg-subtle">
        AppKit workspace · v0.1.0
      </div>
    </div>
  );
}
