/**
 * Drawing extraction providers.
 *
 * Use `getDrawingProvider(id)` to obtain an implementation. Use
 * `resolveActiveProvider(settings)` to select the configured provider for the
 * current workspace settings.
 */

import type { DrawingProvider, DrawingProviderId, IntegrationSettingsSnapshot } from "./types.js";
import { createLandingAiProvider, landingAiAsyncBound } from "./landing-ai.js";
import { createGeminiProProvider, createGeminiFlashProvider } from "./gemini.js";

export * from "./types.js";
export { landingAiAsyncBound } from "./landing-ai.js";
export type { LandingAiBoundHandle } from "./landing-ai.js";

const PROVIDERS: Record<Exclude<DrawingProviderId, "none">, () => DrawingProvider> = {
  landingAi: createLandingAiProvider,
  geminiPro: createGeminiProProvider,
  geminiFlash: createGeminiFlashProvider,
};

export function getDrawingProvider(id: DrawingProviderId): DrawingProvider | null {
  if (id === "none") return null;
  const factory = PROVIDERS[id];
  return factory ? factory() : null;
}

export function listDrawingProviderIds(): DrawingProviderId[] {
  return ["landingAi", "geminiPro", "geminiFlash", "none"];
}

/**
 * Determine the active provider for a workspace based on:
 *  1. settings.drawingExtractionProvider (explicit)
 *  2. legacy `landingAiDrawingExtractionEnabled` flag (mapped to `landingAi` if true)
 *  3. fallback `none`
 *
 * Also returns whether the provider is fully configured (has API key, etc).
 */
export function resolveActiveProvider(settings: IntegrationSettingsSnapshot): {
  id: DrawingProviderId;
  enabled: boolean;
  provider: DrawingProvider | null;
} {
  const explicit = String(settings.drawingExtractionProvider ?? "").trim() as DrawingProviderId;
  const legacy = (settings as any).landingAiDrawingExtractionEnabled === true;

  let id: DrawingProviderId = "none";
  if (explicit && (PROVIDERS as any)[explicit]) {
    id = explicit;
  } else if (explicit === "none") {
    id = "none";
  } else if (legacy) {
    id = "landingAi";
  }

  const provider = getDrawingProvider(id);
  const enabled = (settings.drawingExtractionEnabled !== false) && id !== "none" && !!provider && provider.isConfigured(settings);
  return { id, enabled, provider };
}

/**
 * Convenience for the LandingAI-specific async lifecycle (background polling).
 * Always returns a handle if settings include LandingAI credentials, regardless
 * of which provider is currently active — this lets background tasks for
 * already-queued LandingAI jobs continue to completion across provider switches.
 */
export function landingAiBound(settings: IntegrationSettingsSnapshot) {
  return landingAiAsyncBound(settings);
}
