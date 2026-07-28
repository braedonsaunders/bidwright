import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";

type BrandAssetVariant = "auto" | "color" | "light";

const MARK_SRC = "/bidwright-mark.png";
const MARK_INVERTED_SRC = "/bidwright-mark-inverted.png";
const LOGO_SRC = "/bidwright-logo.png";
const LOGO_LIGHT_SRC = "/bidwright-logo-light.png";

function assetFor(kind: "mark" | "logo", variant: Exclude<BrandAssetVariant, "auto">) {
  if (kind === "mark") return variant === "light" ? MARK_INVERTED_SRC : MARK_SRC;
  return variant === "light" ? LOGO_LIGHT_SRC : LOGO_SRC;
}

export function BidwrightMark({
  className,
  imageClassName,
  variant = "auto",
}: {
  className?: string;
  imageClassName?: string;
  variant?: BrandAssetVariant;
}) {
  if (variant === "auto") {
    return (
      <span className={cn("relative inline-flex shrink-0 items-center justify-center", className)} aria-hidden="true">
        <img src={MARK_SRC} alt="" className={cn("bidwright-mark-image-color h-full w-full object-contain", imageClassName)} />
        <img src={MARK_INVERTED_SRC} alt="" className={cn("bidwright-mark-image-light h-full w-full object-contain", imageClassName)} />
      </span>
    );
  }

  return (
    <img
      src={assetFor("mark", variant)}
      alt=""
      aria-hidden="true"
      className={cn("shrink-0 object-contain", className)}
    />
  );
}

export function BidwrightLogo({
  alt = "Bidwright",
  className,
  variant = "color",
}: {
  alt?: string;
  className?: string;
  variant?: Exclude<BrandAssetVariant, "auto">;
}) {
  return <img src={assetFor("logo", variant)} alt={alt} className={cn("object-contain", className)} />;
}

/* --------------------------- Animated brand mark --------------------------
 * Hand-drawn SVG recreation of the Bidwright mark (traced from
 * public/bidwright-mark.png): estimate clipboard in front of a building
 * group on a shared ground line. Every ink shape is a stroke with a
 * normalized pathLength of 1 so one dasharray rule can draw any of them in;
 * green panels fade and checkboxes pop. Keyframes live in globals.css under
 * "Brand splash animation". Colors come from the --bw-* CSS variables so the
 * mark tracks light/dark themes.
 *
 *   <BidwrightDrawnMark />       static mark (fully drawn)
 *   <BidwrightDrawnMark draw />  one-shot build-in (splash / loaders)
 *   <BrandSplash />              full-screen mark + wordmark draw-in
 */

const delay = (s: number) => ({ "--bd": `${s}s` }) as CSSProperties;

// [path d, build delay s, stroke width] — build order: ground → clipboard →
// buildings (back to front) → window stripes.
const MARK_STROKES: Array<[string, number, number]> = [
  ["M14 410 H524", 0, 10], // ground
  ["M57 410 V152 Q57 142 67 142 H265 Q275 142 275 152 V231", 0.12, 10], // clipboard
  ["M114 157 V128 Q114 122 120 122 H219 Q225 122 225 128 V157 Q225 163 219 163 H120 Q114 163 114 157 Z", 0.3, 10], // clip
  ["M142 122 A 27 27 0 0 1 196 122", 0.42, 10], // clip arch
  ["M267 125 V22 L405 99 V160", 0.26, 10], // back sail tower
  ["M355 133 L477 200 V410", 0.4, 10], // right building
  ["M334 222 V150 L355 133 L374 148 V410", 0.52, 10], // green tower
  ["M262 410 V272 L370 204", 0.6, 10], // front building
  ["M409 222 V388", 0.72, 8], // window stripes
  ["M440 224 V378", 0.78, 8],
];

// Clipboard contents write themselves in after the structure stands.
const MARK_DETAILS: Array<[string, number]> = [
  ["M85 222 H203", 0.88],
  ["M85 247 H203", 0.94],
  ["M119 272 V388", 0.98], // list margin rule
  ["M132 318 H237", 1.06],
  ["M132 348 H237", 1.12],
  ["M132 378 H237", 1.18],
  ["M251 199 C 247 193 229 192 227 201 C 225 210 249 209 248 220 C 247 230 229 231 224 225", 1.22], // $ spine
  ["M238 188 V236", 1.3], // $ bar
];

const CHECKBOX_YS: Array<[number, number]> = [
  [311, 1.02],
  [341, 1.08],
  [371, 1.14],
];

export function BidwrightDrawnMark({ draw = false, className }: { draw?: boolean; className?: string }) {
  return (
    <svg
      viewBox="0 0 538 445"
      aria-hidden="true"
      className={cn(draw && "bw-anim", className)}
      fill="none"
      stroke="var(--bw-ink)"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {MARK_STROKES.map(([d, bd, sw]) => (
        <path key={d} d={d} pathLength={1} strokeWidth={sw} className="bw-s" style={delay(bd)} />
      ))}
      <path
        d="M338 152 L355 138 L370 151 V200 L338 220 Z"
        fill="var(--bw-sage)"
        stroke="none"
        className="bw-f"
        style={delay(0.8)}
      />
      <rect
        x={85}
        y={270}
        width={152}
        height={26}
        rx={3}
        fill="var(--bw-sage)"
        stroke="none"
        className="bw-f"
        style={delay(0.86)}
      />
      {MARK_DETAILS.map(([d, bd]) => (
        <path key={d} d={d} pathLength={1} strokeWidth={8} className="bw-s" style={delay(bd)} />
      ))}
      {CHECKBOX_YS.map(([y, bd]) => (
        <rect
          key={y}
          x={87}
          y={y}
          width={15}
          height={15}
          rx={2}
          fill="var(--bw-ink)"
          stroke="none"
          className="bw-p"
          style={delay(bd)}
        />
      ))}
    </svg>
  );
}

/** Full-screen brand splash: the mark draws itself in, then the wordmark and
 *  tagline rise. Used by <SplashScreen /> and route loading fallbacks. */
export function BrandSplash() {
  return (
    <div
      className="bw-anim flex h-dvh w-full flex-col items-center justify-center gap-5"
      style={{ background: "rgb(var(--ch-bg))" }}
    >
      <BidwrightDrawnMark draw className="h-44 w-auto sm:h-52" />
      <div
        className="bw-w text-5xl font-semibold leading-none sm:text-6xl"
        style={{ ...delay(1.35), fontFamily: "Georgia, 'Times New Roman', serif", letterSpacing: "-0.01em" }}
      >
        <span style={{ color: "var(--bw-bid)" }}>bid</span>
        <span style={{ color: "var(--bw-ink)" }}>wright</span>
      </div>
      <div
        className="bw-w flex items-center gap-3.5 text-xs font-medium"
        style={{ ...delay(1.5), color: "var(--bw-ink)", letterSpacing: "0.42em" }}
      >
        <span aria-hidden className="h-0.5 w-8" style={{ background: "var(--bw-sage)" }} />
        <span>ESTIMATE. PLAN. WIN.</span>
        <span aria-hidden className="h-0.5 w-8" style={{ background: "var(--bw-sage)" }} />
      </div>
    </div>
  );
}
