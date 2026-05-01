import type { CliAdapter, RegisteredCliAdapter } from "./types.js";

const adapters = new Map<string, RegisteredCliAdapter>();
let nextOrder = 0;

export function registerAdapter(adapter: CliAdapter): void {
  if (adapters.has(adapter.id)) {
    throw new Error(`CLI adapter '${adapter.id}' is already registered`);
  }
  adapters.set(adapter.id, { ...adapter, order: nextOrder++ });
}

export function getAdapter(id: string): RegisteredCliAdapter {
  const adapter = adapters.get(id);
  if (!adapter) {
    throw new Error(
      `Unknown CLI runtime '${id}'. Registered: ${[...adapters.keys()].join(", ") || "(none)"}`,
    );
  }
  return adapter;
}

export function tryGetAdapter(id: string | null | undefined): RegisteredCliAdapter | null {
  if (!id) return null;
  return adapters.get(id) ?? null;
}

export function listAdapters(): RegisteredCliAdapter[] {
  return [...adapters.values()].sort((a, b) => a.order - b.order);
}

export function isRegisteredRuntime(id: unknown): id is string {
  return typeof id === "string" && adapters.has(id);
}

export function listAdapterIds(): string[] {
  return listAdapters().map((adapter) => adapter.id);
}
