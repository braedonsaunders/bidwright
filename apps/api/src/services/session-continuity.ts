export interface SessionIdentity {
  runtime?: string;
  model?: string;
  agentMode?: string;
  reviewOnly?: boolean;
}

/** An old session cannot carry editing authority or provider state into another mode. */
export function compatibleSession(saved: SessionIdentity, requested: SessionIdentity): boolean {
  return Boolean(saved.runtime && saved.agentMode)
    && saved.runtime === requested.runtime
    && saved.agentMode === (requested.agentMode || "build_estimate")
    && (saved.model || "") === (requested.model || "")
    && Boolean(saved.reviewOnly) === Boolean(requested.reviewOnly);
}
