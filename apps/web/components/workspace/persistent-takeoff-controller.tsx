"use client";

import React, { type ReactNode } from "react";

import { cn } from "../../lib/utils";

/**
 * Keeps the takeoff controller mounted while its visible viewer is detached.
 * Destroying this subtree also destroys the indexed model state, active asset,
 * action refs, and cross-window channel that drive selection in the popup.
 */
export function PersistentTakeoffController({
  detached,
  children,
}: {
  detached: boolean;
  children: ReactNode;
}) {
  return (
    <div
      aria-hidden={detached || undefined}
      className={cn(
        "min-h-0",
        detached
          ? "fixed -left-[10000px] top-0 h-[720px] w-[1024px] overflow-hidden opacity-0 pointer-events-none"
          : "flex flex-1 flex-col",
      )}
    >
      {children}
    </div>
  );
}
