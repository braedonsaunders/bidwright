/**
 * Drawing extraction providers.
 *
 * Use `getDrawingProvider(id)` to obtain an implementation. Use
 * `resolveActiveProvider(settings)` to select the configured provider for the
 * current workspace settings.
 */

import type { DrawingProvider, DrawingProviderId, IntegrationSettingsSnapshot } from "./types.js";
import { createGeminiProvider } from "./gemini.js";

export * from "./types.js";

const PROVIDERS: Record<Exclude<DrawingProviderId, "none">, () => DrawingProvider> = {
  gemini: createGeminiProvider,
};

export function getDrawingProvider(id: DrawingProviderId): DrawingProvider | null {
  if (id === "none") return null;
  const factory = PROVIDERS[id];
  return factory ? factory() : null;
}

export function listDrawingProviderIds(): DrawingProviderId[] {
  return ["gemini", "none"];
}

/**
 * Determine the active provider for a workspace based on:
 *  1. settings.drawingExtractionProvider (explicit)
 *  2. fallback `none`
 *
 * Also returns whether the provider is fully configured (has API key, etc).
 */
export function resolveActiveProvider(settings: IntegrationSettingsSnapshot): {
  id: DrawingProviderId;
  enabled: boolean;
  provider: DrawingProvider | null;
} {
  const explicit = String(settings.drawingExtractionProvider ?? "").trim();

  let id: DrawingProviderId = "none";
  if (explicit === "gemini") {
    id = "gemini";
  } else if (explicit === "none") {
    id = "none";
  }

  const provider = getDrawingProvider(id);
  const enabled = (settings.drawingExtractionEnabled !== false) && id !== "none" && !!provider && provider.isConfigured(settings);
  return { id, enabled, provider };
}
