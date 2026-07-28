import { RouteLoadingFallback } from "@/components/brand-splash";

// Root route-loading fallback. While the once-per-session intro is live it
// holds the <SplashScreen /> overlay open; afterwards it's a plain spinner —
// in-app navigations never replay the splash.
export default function Loading() {
  return <RouteLoadingFallback />;
}
