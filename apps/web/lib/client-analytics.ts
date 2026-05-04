import type { Customer, ProjectListItem } from "@/lib/api";
import { getClientDisplayName } from "@/lib/client-display";

export type ClientStage = "active" | "won" | "lost" | "other";

export type QuotedProject = ProjectListItem & {
  quote: NonNullable<ProjectListItem["quote"]>;
};

export interface ClientMetrics {
  activeCount: number;
  activeValue: number;
  avgMargin: number;
  lastActivityAt: string | null;
  lostCount: number;
  quoteCount: number;
  totalProfit: number;
  totalValue: number;
  winRate: number;
  wonCount: number;
  wonValue: number;
}

export interface ClientPortfolioRow {
  id: string;
  name: string;
  shortName: string;
  email: string;
  phone: string;
  location: string;
  active: boolean;
  customer: Customer;
  projects: QuotedProject[];
  metrics: ClientMetrics;
}

export function statusToClientStage(status?: string): ClientStage {
  switch ((status ?? "").toLowerCase()) {
    case "open":
    case "pending":
    case "review":
    case "estimate":
      return "active";
    case "awarded":
    case "closed":
      return "won";
    case "didnotget":
    case "declined":
    case "cancelled":
      return "lost";
    default:
      return "other";
  }
}

export function normalizeClientName(value?: string | null) {
  return (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

export function quotedProjects(projects: ProjectListItem[]): QuotedProject[] {
  return projects.filter((project): project is QuotedProject => project.quote != null);
}

export function projectMatchesCustomer(project: QuotedProject, customer: Customer) {
  if (project.quote.customerId) return project.quote.customerId === customer.id;

  const displayName = normalizeClientName(getClientDisplayName(project, project.quote));
  if (!displayName || displayName === "-") return false;

  return [customer.name, customer.shortName]
    .map(normalizeClientName)
    .filter(Boolean)
    .includes(displayName);
}

export function calculateClientMetrics(projects: QuotedProject[]): ClientMetrics {
  let activeCount = 0;
  let activeValue = 0;
  let lostCount = 0;
  let totalProfit = 0;
  let totalValue = 0;
  let wonCount = 0;
  let wonValue = 0;

  for (const project of projects) {
    const value = project.latestRevision?.subtotal ?? 0;
    const profit = project.latestRevision?.estimatedProfit ?? 0;
    const stage = statusToClientStage(project.quote.status);
    totalValue += value;
    totalProfit += profit;

    if (stage === "active") {
      activeCount += 1;
      activeValue += value;
    } else if (stage === "won") {
      wonCount += 1;
      wonValue += value;
    } else if (stage === "lost") {
      lostCount += 1;
    }
  }

  const quoteCount = projects.length;
  const decided = wonCount + lostCount;
  const avgMargin = quoteCount
    ? projects.reduce((sum, project) => sum + (project.latestRevision?.estimatedMargin ?? 0), 0) / quoteCount
    : 0;
  const lastActivityAt = projects.reduce<string | null>((latest, project) => {
    const current = project.updatedAt ?? project.createdAt;
    if (!latest) return current;
    return new Date(current).getTime() > new Date(latest).getTime() ? current : latest;
  }, null);

  return {
    activeCount,
    activeValue,
    avgMargin,
    lastActivityAt,
    lostCount,
    quoteCount,
    totalProfit,
    totalValue,
    winRate: decided > 0 ? wonCount / decided : 0,
    wonCount,
    wonValue,
  };
}

export function buildClientPortfolioRows(customers: Customer[], projects: ProjectListItem[]): ClientPortfolioRow[] {
  const quotes = quotedProjects(projects);
  const assignedProjectIds = new Set<string>();

  return customers.map((customer) => {
    const customerProjects = quotes.filter((project) => {
      if (assignedProjectIds.has(project.id)) return false;
      const matches = projectMatchesCustomer(project, customer);
      if (matches) assignedProjectIds.add(project.id);
      return matches;
    });
    const location = [customer.addressCity, customer.addressProvince].filter(Boolean).join(", ");

    return {
      id: customer.id,
      name: customer.name || "Untitled client",
      shortName: customer.shortName,
      email: customer.email,
      phone: customer.phone,
      location,
      active: customer.active,
      customer,
      projects: customerProjects,
      metrics: calculateClientMetrics(customerProjects),
    };
  });
}

export function getClientInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "CL";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}
