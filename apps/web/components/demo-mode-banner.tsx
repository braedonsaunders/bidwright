"use client";

import { AlertTriangle } from "lucide-react";
import { DEMO_DISABLED_FEATURES, isDemoMode } from "@/lib/demo-mode";

export function DemoModeBanner() {
  if (!isDemoMode) return null;

  return (
    <div className="border-b border-warning/25 bg-warning/10 px-4 py-2 text-[12px] text-fg">
      <div className="mx-auto flex max-w-[1600px] flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2 font-medium text-warning">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          Public demo mode
        </div>
        <div className="text-fg/65">
          Database-backed quote editing is enabled. Disabled here: {DEMO_DISABLED_FEATURES.join("; ")}.
        </div>
      </div>
    </div>
  );
}
