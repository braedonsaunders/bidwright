import { BrandSplash } from "@/components/brand-logo";
import { SplashHold } from "@/components/brand-splash";

// Root route-loading fallback. The visible splash is the <SplashScreen />
// overlay in the root layout (mounted once per document load, so the
// draw-in always completes); SplashHold keeps it up while content streams.
// BrandSplash here just covers the frame before the hold takes effect.
export default function Loading() {
  return (
    <>
      <SplashHold />
      <BrandSplash />
    </>
  );
}
