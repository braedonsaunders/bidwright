"use client";

// Guarantees the brand splash stays up long enough for the draw-in animation
// to complete, even when the route resolves instantly. <SplashScreen /> is a
// fixed overlay mounted once in the root layout: it server-renders visible on
// every document load, then fades out once BOTH the minimum duration has
// elapsed AND no route fallback is holding it open. Route loading fallbacks
// mount <SplashHold /> to keep it up (and re-show it, replaying the draw-in)
// while content streams.

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { BrandSplash } from "./brand-logo";

const MIN_VISIBLE_MS = 2200; // full draw-in completes at ~1.9s
const REDUCED_MOTION_MIN_MS = 500; // static logo — no reason to linger
const FADE_MS = 400;

let holds = 0;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

/** Keeps the splash on screen while mounted. Render inside route loading
 *  fallbacks that should show the full-screen splash. */
export function SplashHold() {
  useEffect(() => {
    holds++;
    notify();
    return () => {
      holds--;
      notify();
    };
  }, []);
  return null;
}

type Phase = "visible" | "fading" | "gone";

export function SplashScreen() {
  const [phase, setPhase] = useState<Phase>("visible");
  const phaseRef = useRef<Phase>("visible");
  const shownAt = useRef(0); // 0 = document start, so streaming time counts

  useEffect(() => {
    let fadeT: ReturnType<typeof setTimeout> | undefined;
    let goneT: ReturnType<typeof setTimeout> | undefined;
    const apply = (p: Phase) => {
      phaseRef.current = p;
      setPhase(p);
    };

    const sync = () => {
      clearTimeout(fadeT);
      clearTimeout(goneT);
      if (holds > 0) {
        // Re-showing from gone remounts the splash, replaying the draw-in;
        // a hold arriving mid-fade just keeps the already-drawn logo up.
        if (phaseRef.current === "gone") shownAt.current = performance.now();
        if (phaseRef.current !== "visible") apply("visible");
        return;
      }
      const min = window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? REDUCED_MOTION_MIN_MS
        : MIN_VISIBLE_MS;
      const remaining = Math.max(0, shownAt.current + min - performance.now());
      fadeT = setTimeout(() => {
        apply("fading");
        goneT = setTimeout(() => apply("gone"), FADE_MS);
      }, remaining);
    };

    listeners.add(sync);
    sync();
    return () => {
      listeners.delete(sync);
      clearTimeout(fadeT);
      clearTimeout(goneT);
    };
  }, []);

  if (phase === "gone") return null;
  return (
    <div
      aria-hidden
      className={cn(
        "fixed inset-0 z-[100] transition-opacity ease-out",
        phase === "visible" ? "opacity-100" : "pointer-events-none opacity-0",
      )}
      style={{ transitionDuration: `${FADE_MS}ms` }}
    >
      <BrandSplash />
    </div>
  );
}
