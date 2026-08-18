import type { NavigationRegistryItem, TenantNavigationConfig } from "@braedonsaunders/appkit-ui";

/**
 * Bidwright owns route metadata; AppKit owns the persisted ordering and
 * visibility contract. Keys are stable tenant data and must not be renamed.
 */
export type BidwrightNavigationRegistryItem = NavigationRegistryItem & {
  href: string;
  exact?: boolean;
  mobile?: boolean;
};

export const BIDWRIGHT_NAVIGATION_REGISTRY: readonly BidwrightNavigationRegistryItem[] = [
  {
    key: "dashboard",
    label: "Dashboard",
    description: "Workspace overview and estimating activity.",
    iconKey: "gauge",
    href: "/",
    exact: true,
    mobile: true,
    required: true,
  },
  {
    key: "projects",
    label: "Projects",
    description: "Estimates, documents, and project workspaces.",
    iconKey: "folder",
    href: "/projects",
    mobile: true,
  },
  {
    key: "intake",
    label: "Intake",
    description: "New bid opportunities and incoming documents.",
    iconKey: "download",
    href: "/intake",
    mobile: true,
  },
  {
    key: "quotes",
    label: "Quotes",
    description: "Prepared proposals and quote history.",
    iconKey: "file",
    href: "/quotes",
    mobile: true,
  },
  {
    key: "clients",
    label: "Clients",
    description: "Customer organizations and contacts.",
    iconKey: "building",
    href: "/clients",
    mobile: true,
  },
  {
    key: "library",
    label: "Library",
    description: "Reusable cost, assembly, and knowledge content.",
    iconKey: "library",
    href: "/library",
    mobile: true,
  },
  {
    key: "performance",
    label: "Performance",
    description: "Quote outcomes and estimating performance.",
    iconKey: "trending-up",
    href: "/performance",
  },
  {
    key: "settings",
    label: "Settings",
    description: "Organization configuration and navigation.",
    iconKey: "settings",
    href: "/settings",
    mobile: true,
    required: true,
  },
  {
    key: "profile",
    label: "Profile",
    description: "Personal account and runtime credentials.",
    iconKey: "circle-user",
    href: "/profile",
  },
];

export type BidwrightNavigationConfig = TenantNavigationConfig;
