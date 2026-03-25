"use client";

import { cn } from "@/lib/utils";
import * as React from "react";
import ReactDOM from "react-dom";
import { motion, AnimatePresence } from "motion/react";

/* ─────────────────────── Button ─────────────────────── */

export function Button({
  className,
  variant = "default",
  size = "md",
  asChild = false,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "secondary" | "ghost" | "accent" | "danger";
  size?: "xs" | "sm" | "md" | "lg";
  asChild?: boolean;
}) {
  const variants = {
    default: "bg-fg text-bg hover:opacity-90",
    secondary: "bg-panel2 text-fg hover:bg-panel2/80 border border-line",
    ghost: "bg-transparent text-fg/70 hover:bg-panel2/60 hover:text-fg",
    accent: "bg-accent text-accent-fg hover:opacity-90",
    danger: "bg-danger/10 text-danger border border-danger/30 hover:bg-danger/20",
  }[variant];

  const sizes = {
    xs: "h-7 px-2.5 text-xs",
    sm: "h-8 px-3 text-xs",
    md: "h-9 px-4 text-sm",
    lg: "h-10 px-5 text-sm",
  }[size];

  const styles = cn(
    "inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-all active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:pointer-events-none disabled:opacity-40",
    variants,
    sizes,
    className
  );

  if (asChild && React.isValidElement(children)) {
    const child = children as React.ReactElement<{ className?: string }>;
    return React.cloneElement(child, {
      className: cn(child.props.className, styles),
    });
  }

  return (
    <button className={styles} {...props}>
      {children}
    </button>
  );
}

/* ─────────────────────── Card ─────────────────────── */

export const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("rounded-xl border border-line bg-panel transition-shadow hover:shadow-sm", className)}
      {...props}
    />
  )
);
Card.displayName = "Card";

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("border-b border-line px-5 py-4", className)} {...props} />;
}

export function CardBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-5 py-4", className)} {...props} />;
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn("text-sm font-semibold text-fg", className)} {...props} />;
}

export function CardDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("mt-0.5 text-xs text-fg/50", className)} {...props} />;
}

/* ─────────────────────── AnimatedCard ─────────────────────── */

export function AnimatedCard({ className, delay = 0, children, ...rest }: { className?: string; delay?: number; children?: React.ReactNode; [key: string]: unknown }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay, ease: "easeOut" }}
      className={cn("rounded-xl border border-line bg-panel transition-shadow hover:shadow-sm", className)}
    >
      {children}
    </motion.div>
  );
}

/* ─────────────────────── Badge ─────────────────────── */

export function Badge({
  className,
  tone = "default",
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: "default" | "success" | "warning" | "danger" | "info" }) {
  const tones = {
    default: "border-line bg-panel2 text-fg/70",
    success: "border-success/20 bg-success/8 text-success",
    warning: "border-warning/20 bg-warning/8 text-warning",
    danger: "border-danger/20 bg-danger/8 text-danger",
    info: "border-accent/20 bg-accent/8 text-accent",
  }[tone];

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-1.5 py-0.5 text-[11px] font-medium",
        tones,
        className
      )}
      {...props}
    />
  );
}

/* ─────────────────────── Input ─────────────────────── */

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "h-9 w-full rounded-lg border border-line bg-bg/50 px-3 text-sm text-fg outline-none transition-colors placeholder:text-fg/30 focus:border-accent/50 focus:ring-1 focus:ring-accent/20",
        className
      )}
      {...props}
    />
  );
}

/* ─────────────────────── Select ─────────────────────── */

export function Select({ className, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        "h-9 w-full rounded-lg border border-line bg-bg/50 px-3 text-sm text-fg outline-none transition-colors focus:border-accent/50 focus:ring-1 focus:ring-accent/20",
        className
      )}
      {...props}
    />
  );
}

/* ─────────────────────── Textarea ─────────────────────── */

export function Textarea({ className, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        "min-h-20 w-full rounded-lg border border-line bg-bg/50 px-3 py-2 text-sm text-fg outline-none transition-colors placeholder:text-fg/30 focus:border-accent/50 focus:ring-1 focus:ring-accent/20",
        className
      )}
      {...props}
    />
  );
}

/* ─────────────────────── Progress ─────────────────────── */

export function Progress({ value, className }: { value: number; className?: string }) {
  const clampedValue = Math.max(0, Math.min(100, value ?? 0));
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-fg/8", className)}>
      <motion.div
        className="h-full rounded-full bg-accent"
        initial={{ width: 0 }}
        animate={{ width: `${clampedValue}%` }}
        transition={{ duration: 0.5, ease: "easeOut" }}
      />
    </div>
  );
}

/* ─────────────────────── Separator ─────────────────────── */

export function Separator({ className }: { className?: string }) {
  return <div className={cn("h-px w-full bg-line", className)} />;
}

/* ─────────────────────── Label ─────────────────────── */

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn("block text-xs font-medium text-fg/50 mb-1.5", className)}
      {...props}
    />
  );
}

/* ─────────────────────── Toggle ─────────────────────── */

export function Toggle({
  checked,
  onChange,
  className,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border border-line transition-colors duration-200",
        checked ? "bg-accent" : "bg-panel2",
        className
      )}
    >
      <motion.span
        className="pointer-events-none block h-4 w-4 rounded-full bg-fg shadow-sm"
        animate={{ x: checked ? 16 : 0 }}
        transition={{ type: "spring", stiffness: 500, damping: 30 }}
      />
    </button>
  );
}

/* ─────────────────────── EmptyState ─────────────────────── */

export function EmptyState({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
      className={cn("rounded-lg border border-dashed border-line py-8 text-center text-sm text-fg/40", className)}
    >
      {children}
    </motion.div>
  );
}

/* ─────────────────────── Modal Backdrop ─────────────────────── */

export function ModalBackdrop({
  open,
  onClose,
  children,
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
}) {
  const widths = { sm: "max-w-sm", md: "max-w-md", lg: "max-w-lg", xl: "max-w-3xl" };

  if (!open) return null;

  return ReactDOM.createPortal(
    <div className="fixed inset-0 z-[200]">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      {/* Scroll container */}
      <div className="absolute inset-0 overflow-y-auto">
        <div className="flex min-h-full items-center justify-center p-4">
          <div className={cn("relative z-10 w-full", widths[size])}>
            {children}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

/* ─────────────────────── FadeIn ─────────────────────── */

export function FadeIn({
  children,
  delay = 0,
  className,
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
}) {
  return (
    <div
      className={className}
      style={{
        animation: `fadeInUp 0.3s ease-out ${delay}s both`,
      }}
    >
      <style>{`@keyframes fadeInUp { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }`}</style>
      {children}
    </div>
  );
}

/* ─────────────────────── SlideIn ─────────────────────── */

export function SlideIn({
  children,
  direction = "right",
  className,
}: {
  children: React.ReactNode;
  direction?: "left" | "right" | "up" | "down";
  className?: string;
}) {
  const initialPos = {
    left: { x: -20, y: 0 },
    right: { x: 20, y: 0 },
    up: { x: 0, y: -20 },
    down: { x: 0, y: 20 },
  }[direction];

  return (
    <motion.div
      initial={{ opacity: 0, ...initialPos }}
      animate={{ opacity: 1, x: 0, y: 0 }}
      exit={{ opacity: 0, ...initialPos }}
      transition={{ duration: 0.25, ease: "easeOut" }}
      className={className}
    >
      {children}
    </motion.div>
  );
}
