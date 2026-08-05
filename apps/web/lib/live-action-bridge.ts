/**
 * Create a stable action object whose methods always dispatch to the latest
 * mounted owner. This is useful when a React surface is remounted elsewhere
 * in the tree (for example when the takeoff viewer is detached), while a
 * sibling toolbar or panel remains mounted with the original action prop.
 */
export function createLiveActionBridge<T extends object>(getCurrent: () => T | null): T {
  const methodBridges = new Map<PropertyKey, (...args: unknown[]) => unknown>();

  return new Proxy({} as T, {
    get(_target, property) {
      let bridge = methodBridges.get(property);
      if (!bridge) {
        bridge = (...args: unknown[]) => {
          const liveTarget = getCurrent();
          if (!liveTarget) return undefined;

          const liveMethod = Reflect.get(liveTarget, property);
          if (typeof liveMethod !== "function") return undefined;

          return Reflect.apply(liveMethod, liveTarget, args);
        };
        methodBridges.set(property, bridge);
      }

      return bridge;
    },
  });
}
