import Link from "next/link";
import { ArrowRight, TrendingUp } from "lucide-react";
import type { AiRun, CatalogSummary, ProjectListItem } from "@/lib/api";
import { formatCompactMoney, formatDateTime, formatMoney, formatPercent } from "@/lib/format";
import { AIReviewQueue } from "@/components/ai-review-queue";
import { Badge, Button, Card, CardBody, CardHeader, CardTitle, EmptyState, Progress } from "@/components/ui";

function statusTone(status: string) {
  switch (status.toLowerCase()) {
    case "review":
      return "warning" as const;
    case "estimate":
    case "closed":
      return "success" as const;
    default:
      return "default" as const;
  }
}

export function ProjectDashboard({
  projects,
  aiRuns,
  catalogs,
}: {
  projects: ProjectListItem[];
  aiRuns: AiRun[];
  catalogs: CatalogSummary[];
}) {
  const pipelineCount = projects.filter((p) => p.ingestionStatus !== "closed").length;
  const totalValue = projects.reduce((sum, p) => sum + p.latestRevision.subtotal, 0);
  const totalProfit = projects.reduce((sum, p) => sum + p.latestRevision.estimatedProfit, 0);
  const avgMargin = projects.length
    ? projects.reduce((sum, p) => sum + p.latestRevision.estimatedMargin, 0) / projects.length
    : 0;

  return (
    <div className="space-y-5">
      {/* KPI strip */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Projects" value={String(projects.length)} sub={`${pipelineCount} active`} />
        <KpiCard label="Pipeline value" value={formatCompactMoney(totalValue)} sub={`${formatCompactMoney(totalProfit)} projected profit`} />
        <KpiCard label="Avg margin" value={formatPercent(avgMargin, 1)} />
        <KpiCard label="AI runs" value={String(aiRuns.length)} sub={`${catalogs.length} catalogs`} />
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.3fr_0.7fr]">
        {/* Project list */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Projects</CardTitle>
              <Button size="xs" asChild>
                <Link href="/intake">New project</Link>
              </Button>
            </div>
          </CardHeader>
          <CardBody>
            {projects.length === 0 ? (
              <EmptyState>No projects yet. Upload a package to begin.</EmptyState>
            ) : (
              <div className="divide-y divide-line">
                {projects.map((project) => (
                  <Link
                    key={project.id}
                    href={`/projects/${project.id}`}
                    className="flex items-center gap-4 py-3 transition-colors hover:bg-panel2/40 -mx-5 px-5 first:pt-0 last:pb-0"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium">{project.name}</span>
                        <Badge tone={statusTone(project.ingestionStatus)}>{project.ingestionStatus}</Badge>
                      </div>
                      <div className="mt-1 flex items-center gap-2 text-xs text-fg/40">
                        <span>{project.clientName}</span>
                        <span>·</span>
                        <span>{project.location}</span>
                        <span>·</span>
                        <span>{project.quote.quoteNumber}</span>
                      </div>
                    </div>

                    <div className="hidden sm:flex items-center gap-6 text-right">
                      <div>
                        <div className="text-sm font-medium">{formatMoney(project.latestRevision.subtotal)}</div>
                        <div className="text-[11px] text-fg/35">subtotal</div>
                      </div>
                      <div>
                        <div className="text-sm font-medium">{formatPercent(project.latestRevision.estimatedMargin, 0)}</div>
                        <div className="text-[11px] text-fg/35">margin</div>
                      </div>
                      <ArrowRight className="h-3.5 w-3.5 text-fg/25" />
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardBody>
        </Card>

        {/* Right column */}
        <div className="space-y-5">
          <AIReviewQueue compact runs={aiRuns} />

          {catalogs.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Catalogs</CardTitle>
              </CardHeader>
              <CardBody className="space-y-2">
                {catalogs.map((catalog) => (
                  <div key={catalog.id} className="flex items-center justify-between rounded-lg bg-panel2/50 px-3 py-2">
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{catalog.name}</div>
                      <div className="text-[11px] text-fg/40">{catalog.scope}</div>
                    </div>
                    <Badge>{catalog.kind.replace("_", " ")}</Badge>
                  </div>
                ))}
              </CardBody>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function KpiCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card>
      <CardBody className="py-3">
        <div className="text-[11px] font-medium text-fg/40">{label}</div>
        <div className="mt-1 text-xl font-semibold">{value}</div>
        {sub && <div className="mt-1 text-[11px] text-fg/35">{sub}</div>}
      </CardBody>
    </Card>
  );
}
