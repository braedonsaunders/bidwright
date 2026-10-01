"use client";

import { useEffect, useRef, useState } from "react";

/** Expand the existing viewer without remounting its document or canvas. */
export function useViewerFullscreen() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [nativeFullscreen, setNativeFullscreen] = useState(false);

  useEffect(() => {
    const changed = () => {
      const active = document.fullscreenElement === containerRef.current;
      setNativeFullscreen(active);
      setExpanded(active);
    };
    document.addEventListener("fullscreenchange", changed);
    return () => document.removeEventListener("fullscreenchange", changed);
  }, []);

  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (document.fullscreenElement === containerRef.current) {
        void document.exitFullscreen().catch(() => {});
      } else setExpanded(false);
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, []);

  async function toggleFullscreen() {
    if (expanded) {
      if (document.fullscreenElement === containerRef.current) await document.exitFullscreen();
      else setExpanded(false);
    } else if (containerRef.current?.requestFullscreen && document.fullscreenEnabled) {
      try { await containerRef.current.requestFullscreen(); }
      catch { setExpanded(true); }
    } else setExpanded(true);
  }

  return { containerRef, expanded, nativeFullscreen, toggleFullscreen };
}
