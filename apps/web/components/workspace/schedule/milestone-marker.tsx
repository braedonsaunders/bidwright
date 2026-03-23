"use client";

import { cn } from "@/lib/utils";

export function MilestoneMarker({
  color = "bg-amber-500",
  size = 12,
  className,
}: {
  color?: string;
  size?: number;
  className?: string;
}) {
  return (
    <div
      className={cn("rotate-45 rounded-sm", color, className)}
      style={{ width: size, height: size }}
    />
  );
}
