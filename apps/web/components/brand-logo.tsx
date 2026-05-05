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
