"use client";

import { CheckCircle2, CircleAlert, Sparkles, XCircle } from "lucide-react";
import type { AiRun, Citation } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { Badge, Card, CardBody, CardHeader, CardTitle, EmptyState, Progress } from "@/components/ui";

const stateMap = {
  complete: { tone: "success" as const, icon: CheckCircle2, label: "Complete" },
  pending: { tone: "warning" as const, icon: CircleAlert, label: "Pending" },
  review: { tone: "warning" as const, icon: CircleAlert, label: "Review" },
  rejected: { tone: "danger" as const, icon: XCircle, label: "Rejected" },
  running: { tone: "info" as const, icon: Sparkles, label: "Running" },
};

function getState(status: string) {
  return stateMap[status.toLowerCase() as keyof typeof stateMap] ?? stateMap.pending;
}

export function AIReviewQueue({
  compact = false,
  runs,
  citations = [],
}: {
  compact?: boolean;
  runs: AiRun[];
  citations?: Citation[];
}) {
  const visibleItems = compact ? runs.slice(0, 3) : runs;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>AI Runs</CardTitle>
          {visibleItems.length > 0 && (
            <Badge tone="warning">{visibleItems.length}</Badge>
          )}
        </div>
      </CardHeader>
      <CardBody className="space-y-2">
        {visibleItems.length === 0 ? (
          <EmptyState>No AI runs</EmptyState>
        ) : (
          visibleItems.map((item) => {
            const state = getState(item.status);
            const Icon = state.icon;
            const progressValue = item.status === "complete" ? 100 : item.status === "running" ? 60 : 35;

            return (
              <div key={item.id} className="rounded-lg border border-line bg-panel2/40 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Icon className="h-3.5 w-3.5 text-fg/40" />
                      <span className="text-sm font-medium">{item.kind}</span>
                    </div>
                    <p className="mt-1 truncate text-xs text-fg/45">{item.input.question}</p>
                  </div>
                  <Badge tone={state.tone}>{state.label}</Badge>
                </div>

                <div className="mt-3 flex items-center gap-3">
                  <Progress value={progressValue} className="flex-1" />
                  <span className="text-[10px] text-fg/30">{formatDateTime(item.updatedAt)}</span>
                </div>

                {!compact && (
                  <div className="mt-2 flex gap-4 text-[11px] text-fg/35">
                    <span>{item.model}</span>
                    <span>{item.promptVersion}</span>
                    <span>{item.input.sources.length} sources</span>
                  </div>
                )}
              </div>
            );
          })
        )}
      </CardBody>
    </Card>
  );
}
