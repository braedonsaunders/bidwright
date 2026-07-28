"use client";

// Brand splash orchestration. The draw-in intro plays ONCE per browser
// session: <SplashScreen /> is a fixed overlay mounted once in the root
// layout that server-renders visible on every document load, stays up until
// BOTH the minimum duration has elapsed AND no route fallback is holding it
// open, then fades out for good — in-app navigations and programmatic full
// reloads (org switch, sign-out bounce, error-recovery reloads) never replay
// it. Repeat loads are detected via sessionStorage; an inline script applies
// the `bw-skip-splash` class to <html> before first paint so skipped loads
// never flash the overlay (globals.css hides [data-bw-splash] under it).
// Route loading fallbacks render <RouteLoadingFallback />: the splash while
// the intro is live, a plain spinner ever after.

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { BrandSplash } from "./brand-logo";

const MIN_VISIBLE_MS = 2200; // full draw-in completes at ~1.9s
const REDUCED_MOTION_MIN_MS = 500; // static logo — no reason to linger
const FADE_MS = 400;
const SEEN_KEY = "bw:splash-shown";

// Runs while the document parses, before the overlay can paint.
const SKIP_SNIPPET = `try{if(sessionStorage.getItem(${JSON.stringify(
  SEEN_KEY,
)}))document.documentElement.classList.add("bw-skip-splash")}catch(e){}`;

// True once the intro has finished (or was skipped) on this document.
let introDone = false;

let holds = 0;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

/** Keeps a live splash on screen while mounted. No-op after the intro. */
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
      if (p === "gone") introDone = true;
    };

    // Repeat load in this session: the overlay is already display:none via
    // bw-skip-splash — retire it without ever showing. The class stays on
    // <html> so streamed route fallbacks keep resolving to the spinner.
    if (document.documentElement.classList.contains("bw-skip-splash")) {
      apply("gone");
      return;
    }
    try {
      sessionStorage.setItem(SEEN_KEY, "1");
    } catch {
      // Storage unavailable — the splash will replay on reload, nothing worse.
    }

    const sync = () => {
      clearTimeout(fadeT);
      clearTimeout(goneT);
      // The intro plays once: a hold arriving after it's gone stays a no-op.
      if (phaseRef.current === "gone") return;
      if (holds > 0) {
        // A hold arriving mid-fade keeps the already-drawn logo up.
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

  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: SKIP_SNIPPET }} />
      {phase !== "gone" && (
        <div
          aria-hidden
          data-bw-splash
          className={cn(
            "fixed inset-0 z-[100] transition-opacity ease-out",
            phase === "visible" ? "opacity-100" : "pointer-events-none opacity-0",
          )}
          style={{ transitionDuration: `${FADE_MS}ms` }}
        >
          <BrandSplash />
        </div>
      )}
    </>
  );
}

function FallbackSpinner({ hiddenUntilSkip = false }: { hiddenUntilSkip?: boolean }) {
  return (
    <div
      {...(hiddenUntilSkip ? { "data-bw-splash-alt": true } : {})}
      className="flex h-dvh w-full items-center justify-center"
      style={{ background: "rgb(var(--ch-bg))" }}
    >
      <Loader2 className="size-5 animate-spin text-fg/40" aria-hidden />
    </div>
  );
}

/** Route loading fallback. During the once-per-session intro it holds the
 *  splash overlay open (and covers the frame beneath it); afterwards — and on
 *  skipped repeat loads, via the bw-skip-splash CSS switch — it's a plain
 *  spinner. */
export function RouteLoadingFallback() {
  // Deterministic per document: matches the server render for the fallback
  // streamed on initial load, and flips to spinner-only for fallbacks mounted
  // by later client-side navigations.
  const [splashActive] = useState(() => !introDone);
  if (!splashActive) return <FallbackSpinner />;
  return (
    <>
      <SplashHold />
      <div data-bw-splash>
        <BrandSplash />
      </div>
      <FallbackSpinner hiddenUntilSkip />
    </>
  );
}
