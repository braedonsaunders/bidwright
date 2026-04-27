"use client";

import { cn } from "@/lib/utils";
import * as React from "react";
import ReactDOM from "react-dom";
import { motion, AnimatePresence } from "motion/react";
import * as Popover from "@radix-ui/react-popover";
import * as SelectPrimitive from "@radix-ui/react-select";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { Check, ChevronDown } from "lucide-react";

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

export interface CompactSelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export function CompactSelect({
  value,
  onValueChange,
  options,
  placeholder = "Select...",
  className,
  triggerClassName,
  disabled = false,
  "data-testid": dataTestId,
  title,
  ariaLabel,
}: {
  value: string;
  onValueChange: (value: string) => void;
  options: CompactSelectOption[];
  placeholder?: string;
  className?: string;
  triggerClassName?: string;
  disabled?: boolean;
  "data-testid"?: string;
  title?: string;
  ariaLabel?: string;
}) {
  return (
    <SelectPrimitive.Root value={value} onValueChange={onValueChange} disabled={disabled}>
      <SelectPrimitive.Trigger
        data-testid={dataTestId}
        title={title}
        aria-label={ariaLabel}
        className={cn(
          "inline-flex h-7 w-full items-center justify-between gap-2 rounded-md border border-line bg-bg/45 px-2 text-[11px] font-medium text-fg outline-none transition-colors hover:border-accent/30 focus-visible:border-accent/50 focus-visible:ring-1 focus-visible:ring-accent/20 disabled:pointer-events-none disabled:opacity-40",
          triggerClassName,
          className
        )}
      >
        <SelectPrimitive.Value placeholder={placeholder} />
        <SelectPrimitive.Icon className="text-fg/35">
          <ChevronDown className="h-3.5 w-3.5" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={6}
          className="z-[300] min-w-[180px] overflow-hidden rounded-lg border border-line bg-panel shadow-xl"
        >
          <SelectPrimitive.Viewport className="p-1">
            {options.map((option) => (
              <SelectPrimitive.Item
                key={option.value}
                value={option.value}
                disabled={option.disabled}
                className="relative flex cursor-default select-none items-center rounded-md py-1.5 pl-7 pr-2 text-xs text-fg/75 outline-none transition-colors data-[disabled]:pointer-events-none data-[disabled]:opacity-35 data-[highlighted]:bg-panel2 data-[highlighted]:text-fg"
              >
                <SelectPrimitive.ItemIndicator className="absolute left-2 inline-flex items-center text-accent">
                  <Check className="h-3.5 w-3.5" />
                </SelectPrimitive.ItemIndicator>
                <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
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
  size?: "sm" | "md" | "lg" | "xl" | "2xl";
}) {
  const widths = { sm: "max-w-sm", md: "max-w-md", lg: "max-w-lg", xl: "max-w-3xl", "2xl": "max-w-6xl" };

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

export const Tabs = TabsPrimitive.Root;

export function TabsList({ className, ...props }: React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      className={cn("inline-flex h-8 items-center gap-1 rounded-lg bg-panel2/45 p-1", className)}
      {...props}
    />
  );
}

export function TabsTrigger({ className, ...props }: React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        "inline-flex h-6 items-center justify-center rounded-md px-2.5 text-[11px] font-medium text-fg/45 transition-colors hover:text-fg/75 data-[state=active]:bg-panel data-[state=active]:text-fg data-[state=active]:shadow-sm",
        className
      )}
      {...props}
    />
  );
}

export function TabsContent({ className, ...props }: React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content className={cn("outline-none", className)} {...props} />;
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

/* ─────────────────────── Combobox (searchable single-select) ─── */

export interface ComboboxOption {
  value: string;
  label: string;
  description?: string;
}

export function Combobox({
  id,
  options,
  value,
  onChange,
  placeholder = "Select...",
  disabled = false,
  className,
  searchPlaceholder = "Search...",
  emptyStateText = "No matches",
}: {
  id?: string;
  options: ComboboxOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  searchPlaceholder?: string;
  emptyStateText?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState("");
  const searchRef = React.useRef<HTMLInputElement>(null);

  const filtered = React.useMemo(() => {
    if (!search) return options;
    const q = search.toLowerCase();
    return options.filter(
      (o) =>
        o.label.toLowerCase().includes(q) ||
        (o.description ?? "").toLowerCase().includes(q),
    );
  }, [options, search]);

  const selectedLabel = options.find((o) => o.value === value)?.label;

  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setSearch("");
      }}
    >
      <Popover.Trigger asChild>
        <button
          id={id}
          type="button"
          disabled={disabled}
          className={cn(
            "flex h-9 w-full items-center justify-between rounded-lg border border-line bg-bg/50 px-3 text-left text-sm outline-none transition-colors hover:border-accent/30 focus:border-accent/50 focus:ring-1 focus:ring-accent/20 disabled:pointer-events-none disabled:opacity-40",
            className,
          )}
        >
          {selectedLabel ? (
            <span className="truncate text-fg">{selectedLabel}</span>
          ) : (
            <span className="text-fg/30">{placeholder}</span>
          )}
          <svg className="ml-2 h-3 w-3 shrink-0 text-fg/40" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M3 4.5L6 7.5L9 4.5" />
          </svg>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="z-50 w-[var(--radix-popover-trigger-width)] rounded-lg border border-line bg-panel shadow-xl"
          sideOffset={4}
          align="start"
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            searchRef.current?.focus();
          }}
        >
          <div className="p-2">
            <input
              ref={searchRef}
              type="text"
              className="w-full rounded border border-line bg-bg px-2.5 py-1.5 text-xs text-fg outline-none placeholder:text-fg/30 focus:border-accent/50"
              placeholder={searchPlaceholder}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="max-h-[240px] overflow-y-auto px-1 pb-1">
            {filtered.length === 0 && (
              <div className="px-2.5 py-3 text-center text-xs text-fg/30">
                {emptyStateText}
              </div>
            )}
            {filtered.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
                  setSearch("");
                }}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-xs transition-colors hover:bg-panel2",
                  opt.value === value && "bg-accent/5",
                )}
              >
                <span
                  className={cn(
                    "flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full transition-colors",
                    opt.value === value
                      ? "text-accent"
                      : "text-transparent",
                  )}
                >
                  <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </span>
                <div className="min-w-0">
                  <div className="font-medium text-fg truncate">{opt.label}</div>
                  {opt.description && (
                    <div className="text-[10px] text-fg/40 truncate mt-0.5">{opt.description}</div>
                  )}
                </div>
              </button>
            ))}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/* ─────────────────────── MultiSelect ─────────────────────── */

export interface MultiSelectOption {
  value: string;
  label: string;
  description?: string;
}

export function MultiSelect({
  id,
  options,
  selected,
  onChange,
  placeholder = "Select...",
  className,
  disabled = false,
}: {
  id?: string;
  options: MultiSelectOption[];
  selected: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}) {
  const [search, setSearch] = React.useState("");
  const filtered = options.filter(
    (o) =>
      o.label.toLowerCase().includes(search.toLowerCase()) ||
      (o.description ?? "").toLowerCase().includes(search.toLowerCase()),
  );

  const toggle = (value: string) => {
    onChange(
      selected.includes(value)
        ? selected.filter((v) => v !== value)
        : [...selected, value],
    );
  };

  const selectedLabels = options
    .filter((o) => selected.includes(o.value))
    .map((o) => o.label);

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          id={id}
          type="button"
          disabled={disabled}
          className={cn(
            "flex min-h-[36px] w-full items-center gap-1.5 rounded-lg border border-line bg-bg/50 px-3 py-1.5 text-left text-sm outline-none transition-colors hover:border-accent/30 focus:border-accent/50 focus:ring-1 focus:ring-accent/20 disabled:pointer-events-none disabled:opacity-40",
            className,
          )}
        >
          {selectedLabels.length === 0 ? (
            <span className="text-fg/30">{placeholder}</span>
          ) : (
            <div className="flex flex-wrap gap-1">
              {selectedLabels.map((label) => (
                <span
                  key={label}
                  className="inline-flex items-center rounded bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium text-accent"
                >
                  {label}
                </span>
              ))}
            </div>
          )}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="z-50 w-[var(--radix-popover-trigger-width)] rounded-lg border border-line bg-panel shadow-xl"
          sideOffset={4}
          align="start"
        >
          <div className="p-2">
            <input
              type="text"
              className="w-full rounded border border-line bg-bg px-2.5 py-1.5 text-xs text-fg outline-none placeholder:text-fg/30 focus:border-accent/50"
              placeholder="Search..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="max-h-[240px] overflow-y-auto px-1 pb-1">
            {filtered.length === 0 && (
              <div className="px-2.5 py-3 text-center text-xs text-fg/30">
                No matches
              </div>
            )}
            {filtered.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => toggle(opt.value)}
                className={cn(
                  "flex w-full items-start gap-2.5 rounded-md px-2.5 py-2 text-left text-xs transition-colors hover:bg-panel2",
                  selected.includes(opt.value) && "bg-accent/5",
                )}
              >
                <span
                  className={cn(
                    "mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border transition-colors",
                    selected.includes(opt.value)
                      ? "border-accent bg-accent text-white"
                      : "border-line bg-bg",
                  )}
                >
                  {selected.includes(opt.value) && (
                    <svg
                      className="h-2.5 w-2.5"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={3}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                  )}
                </span>
                <div className="min-w-0">
                  <div className="font-medium text-fg truncate">
                    {opt.label}
                  </div>
                  {opt.description && (
                    <div className="text-[10px] text-fg/40 truncate mt-0.5">
                      {opt.description}
                    </div>
                  )}
                </div>
              </button>
            ))}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
