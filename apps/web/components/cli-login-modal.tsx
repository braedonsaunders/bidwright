"use client";

/**
 * CLI OAuth login modal.
 *
 * The user clicks "Sign in with Claude" (or Codex / OpenCode / Gemini) and
 * this modal opens an xterm.js terminal connected to a server-side PTY
 * running the runtime's interactive `login` flow inside the user's
 * per-user agent-home namespace. As soon as the OAuth credential file
 * lands on disk, the server pushes `auth-ok` and the modal closes itself.
 *
 * Wire format with the backend at /api/cli/login/:sessionId/stream:
 *   client → server: { type: "input", data: string }
 *                    { type: "resize", cols: number, rows: number }
 *                    { type: "kill" }
 *   server → client: { type: "data", data: string }
 *                    { type: "exit", code: number | null }
 *                    { type: "auth-ok" }
 *                    { type: "error", message: string }
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, X } from "lucide-react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

import { Button, ModalBackdrop } from "@/components/ui";
import { apiRequest, resolveApiUrl } from "@/lib/api/client";

export interface CliLoginModalProps {
  open: boolean;
  runtime: string;
  /** Display name of the runtime — used in headings. */
  runtimeLabel: string;
  /**
   * Called when the modal closes. `result.completed=true` means we observed
   * the OAuth credential land on disk; the parent should refresh the
   * /api/cli/detect status pill.
   */
  onClose: (result: { completed: boolean }) => void;
}

type Phase = "starting" | "running" | "completed" | "exited" | "error";

interface InboundFrame {
  type: "data" | "exit" | "auth-ok" | "error";
  data?: string;
  code?: number | null;
  message?: string;
}

function buildLoginWebsocketUrl(sessionId: string): string {
  // Mirror the resolveApiUrl logic for the proxy path on same-origin
  // production deployments, then upgrade to ws:// or wss://.
  const path = `/api/cli/login/${encodeURIComponent(sessionId)}/stream`;
  const httpUrl = resolveApiUrl(path);
  return httpUrl.replace(/^http(s?):/, "ws$1:");
}

export function CliLoginModal({ open, runtime, runtimeLabel, onClose }: CliLoginModalProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const sessionIdRef = useRef<string | null>(null);

  const [phase, setPhase] = useState<Phase>("starting");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [authObserved, setAuthObserved] = useState(false);

  // ── Cleanup helper used by both close paths ──────────────────────────
  const cleanup = useCallback(async (opts: { kill: boolean }) => {
    const id = sessionIdRef.current;
    sessionIdRef.current = null;
    try {
      socketRef.current?.close(1000, "modal-closed");
    } catch {
      /* ignore */
    }
    socketRef.current = null;
    if (terminalRef.current) {
      try {
        terminalRef.current.dispose();
      } catch {
        /* ignore */
      }
      terminalRef.current = null;
    }
    fitAddonRef.current = null;
    if (id && opts.kill) {
      // Best-effort kill; the server's expire timer is the safety net.
      await fetch(resolveApiUrl(`/api/cli/login/${encodeURIComponent(id)}`), {
        method: "DELETE",
        credentials: "include",
      }).catch(() => {});
    }
  }, []);

  const handleClose = useCallback(
    async (result: { completed: boolean }) => {
      await cleanup({ kill: !result.completed });
      onClose(result);
    },
    [cleanup, onClose],
  );

  // ── Open: create session + xterm + WS ───────────────────────────────
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setPhase("starting");
    setErrorMessage(null);
    setAuthObserved(false);

    const start = async () => {
      let session: { sessionId: string } | null = null;
      try {
        session = await apiRequest<{ sessionId: string; runtime: string }>("/api/cli/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ runtime }),
        });
      } catch (err) {
        if (cancelled) return;
        setPhase("error");
        setErrorMessage(err instanceof Error ? err.message : "Failed to start login");
        return;
      }
      if (cancelled || !session) return;
      sessionIdRef.current = session.sessionId;

      // Defer the xterm mount until the container ref is available. React
      // 19's rendering can land the ref one tick after the modal opens.
      const term = new Terminal({
        fontFamily:
          "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
        fontSize: 13,
        cursorBlink: true,
        convertEol: true,
        theme: {
          background: "#0b0d10",
          foreground: "#dde2ea",
          cursor: "#dde2ea",
        },
        allowProposedApi: true,
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      terminalRef.current = term;
      fitAddonRef.current = fit;

      // Mount once the container is ready.
      const mountWhenReady = () => {
        if (cancelled) return;
        if (!containerRef.current) {
          requestAnimationFrame(mountWhenReady);
          return;
        }
        term.open(containerRef.current);
        try {
          fit.fit();
        } catch {
          /* container may have zero size — re-fit on next resize */
        }
        attachSocket(session!.sessionId);
      };
      mountWhenReady();
    };

    const attachSocket = (sessionId: string) => {
      const url = buildLoginWebsocketUrl(sessionId);
      const ws = new WebSocket(url);
      socketRef.current = ws;

      ws.onopen = () => {
        if (cancelled) return;
        setPhase("running");
        // Send initial dimensions so the PTY matches what xterm rendered.
        const term = terminalRef.current;
        if (term) {
          ws.send(
            JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }),
          );
        }
      };

      ws.onmessage = (event) => {
        if (cancelled) return;
        let frame: InboundFrame;
        try {
          frame = JSON.parse(typeof event.data === "string" ? event.data : "");
        } catch {
          return;
        }
        const term = terminalRef.current;
        if (frame.type === "data" && typeof frame.data === "string") {
          term?.write(frame.data);
        } else if (frame.type === "auth-ok") {
          setAuthObserved(true);
          setPhase("completed");
          // Give the terminal one beat to render any "saved credentials"
          // message before we close, so the user sees the success line.
          setTimeout(() => {
            void handleClose({ completed: true });
          }, 1200);
        } else if (frame.type === "exit") {
          setPhase((current) => (current === "completed" ? current : "exited"));
        } else if (frame.type === "error") {
          setPhase("error");
          setErrorMessage(frame.message || "Login session error");
        }
      };

      ws.onerror = () => {
        if (cancelled) return;
        // The CloseEvent that follows has the actual reason code; we just
        // surface a generic message here.
      };

      ws.onclose = (event) => {
        if (cancelled) return;
        if (phase === "completed") return; // already handled
        if (event.code === 1008) {
          setPhase("error");
          setErrorMessage(event.reason || "Login session unauthorized");
        }
      };

      // Wire xterm input → PTY stdin.
      const term = terminalRef.current;
      if (term) {
        term.onData((data) => {
          if (ws.readyState === ws.OPEN) {
            ws.send(JSON.stringify({ type: "input", data }));
          }
        });
      }
    };

    void start();

    const onResize = () => {
      try {
        fitAddonRef.current?.fit();
        const ws = socketRef.current;
        const term = terminalRef.current;
        if (ws && ws.readyState === ws.OPEN && term) {
          ws.send(
            JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }),
          );
        }
      } catch {
        /* ignore */
      }
    };
    window.addEventListener("resize", onResize);

    return () => {
      cancelled = true;
      window.removeEventListener("resize", onResize);
      void cleanup({ kill: !authObserved });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, runtime]);

  return (
    <ModalBackdrop open={open} onClose={() => void handleClose({ completed: authObserved })} size="2xl">
      <div className="flex h-[70vh] w-full flex-col overflow-hidden rounded-2xl border border-fg/10 bg-bg shadow-2xl">
        <header className="flex items-center justify-between gap-3 border-b border-fg/10 px-5 py-3">
          <div className="flex flex-col gap-0.5">
            <h2 className="text-sm font-semibold tracking-tight text-fg">
              Sign in with {runtimeLabel}
            </h2>
            <p className="text-[11px] text-fg/60">
              {phase === "starting" && "Starting login session…"}
              {phase === "running" && (
                <>
                  Follow the prompts in the terminal below. The CLI will print a URL —
                  open it in your browser to complete sign-in.
                </>
              )}
              {phase === "completed" && "Sign-in successful — closing…"}
              {phase === "exited" &&
                "Login process exited. Close to dismiss, or retry sign-in."}
              {phase === "error" && (errorMessage || "Login failed")}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {phase === "starting" || phase === "running" ? (
              <Loader2 className="h-4 w-4 animate-spin text-fg/50" aria-hidden />
            ) : null}
            <Button
              variant="ghost"
              onClick={() => void handleClose({ completed: authObserved })}
              aria-label="Close login modal"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </header>
        <div
          ref={containerRef}
          className="flex-1 bg-[#0b0d10]"
          // The terminal renders directly into this element; xterm.js manages
          // its own children, so React shouldn't pretend to own the subtree.
        />
        <footer className="flex items-center justify-between gap-3 border-t border-fg/10 bg-bg/50 px-5 py-2 text-[11px] text-fg/60">
          <span>
            Credentials are written to your private namespace on this server, scoped to your account only.
          </span>
          {phase === "exited" || phase === "error" ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void handleClose({ completed: false })}
            >
              Close
            </Button>
          ) : null}
        </footer>
      </div>
    </ModalBackdrop>
  );
}
