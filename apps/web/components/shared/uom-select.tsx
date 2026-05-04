"use client";

import { useEffect, useMemo, useState } from "react";
import { normalizeUomCode, normalizeUomLibrary, type UnitOfMeasure } from "@bidwright/domain";
import { CompactSelect, Select, type CompactSelectOption, type SelectOption } from "@/components/ui";
import { getSettings } from "@/lib/api";
import { useAuth } from "@/components/auth-provider";

const DEFAULT_CACHE_SCOPE = "__default__";
const cachedUoms = new Map<string, UnitOfMeasure[]>();
const pendingUoms = new Map<string, Promise<UnitOfMeasure[]>>();

function cacheScope(scope?: string | null) {
  return scope || DEFAULT_CACHE_SCOPE;
}

export function formatUomLabel(unit: UnitOfMeasure, compact = false) {
  if (compact || !unit.label || unit.label === unit.code) return unit.code;
  return `${unit.code} - ${unit.label}`;
}

export function makeUomOptions(
  uoms: UnitOfMeasure[],
  {
    value,
    compact = false,
    includeInactive = false,
    blankValue,
    blankLabel = "None",
  }: {
    value?: string | null;
    compact?: boolean;
    includeInactive?: boolean;
    blankValue?: string;
    blankLabel?: string;
  } = {},
): SelectOption[] {
  const options: SelectOption[] = [];
  if (blankValue !== undefined) options.push({ value: blankValue, label: blankLabel });

  const normalizedValue = normalizeUomCode(value);
  const seen = new Set(options.map((option) => option.value));
  for (const unit of uoms) {
    if (!includeInactive && !unit.active && unit.code !== normalizedValue) continue;
    if (seen.has(unit.code)) continue;
    options.push({
      value: unit.code,
      label: formatUomLabel(unit, compact),
      disabled: !unit.active,
    });
    seen.add(unit.code);
  }

  if (normalizedValue && !seen.has(normalizedValue)) {
    options.push({ value: normalizedValue, label: compact ? normalizedValue : `${normalizedValue} - custom` });
  }

  return options;
}

async function loadUoms(scope?: string | null) {
  const key = cacheScope(scope);
  const cached = cachedUoms.get(key);
  if (cached) return cached;

  let pending = pendingUoms.get(key);
  if (!pending) {
    pending = getSettings()
      .then((settings) => {
        const next = normalizeUomLibrary(settings.defaults.uoms);
        cachedUoms.set(key, next);
        return next;
      })
      .catch(() => normalizeUomLibrary())
      .finally(() => {
        pendingUoms.delete(key);
      });
    pendingUoms.set(key, pending);
  }
  return pending;
}

export function setCachedUoms(uoms: UnitOfMeasure[], scope?: string | null) {
  const key = cacheScope(scope);
  const normalized = normalizeUomLibrary(uoms);
  cachedUoms.set(key, normalized);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("bidwright:uoms-updated", { detail: { scope: key, uoms: normalized } }));
  }
}

export function useUomLibrary(seed?: UnitOfMeasure[]) {
  const { organization } = useAuth();
  const scope = cacheScope(organization?.id);
  const [uoms, setUoms] = useState<UnitOfMeasure[]>(() => normalizeUomLibrary(seed ?? cachedUoms.get(scope) ?? undefined));

  useEffect(() => {
    if (seed) {
      const normalized = normalizeUomLibrary(seed);
      setCachedUoms(normalized, scope);
      setUoms(normalized);
      return;
    }

    let cancelled = false;
    loadUoms(scope).then((loaded) => {
      if (!cancelled) setUoms(loaded);
    });

    const onUomsUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ scope?: string; uoms?: UnitOfMeasure[] } | UnitOfMeasure[]>).detail;
      if (Array.isArray(detail)) {
        setUoms(normalizeUomLibrary(detail));
        return;
      }
      if (!detail?.uoms || detail.scope !== scope) return;
      setUoms(normalizeUomLibrary(detail.uoms));
    };
    window.addEventListener("bidwright:uoms-updated", onUomsUpdated);
    return () => {
      cancelled = true;
      window.removeEventListener("bidwright:uoms-updated", onUomsUpdated);
    };
  }, [scope, seed]);

  return uoms;
}

export function useUomOptions({
  value,
  compact = false,
  includeInactive = false,
  blankValue,
  blankLabel,
  seed,
}: {
  value?: string | null;
  compact?: boolean;
  includeInactive?: boolean;
  blankValue?: string;
  blankLabel?: string;
  seed?: UnitOfMeasure[];
} = {}) {
  const uoms = useUomLibrary(seed);
  return useMemo(
    () => makeUomOptions(uoms, { value, compact, includeInactive, blankValue, blankLabel }),
    [blankLabel, blankValue, compact, includeInactive, uoms, value],
  );
}

export function UomSelect({
  value,
  onValueChange,
  placeholder = "Unit",
  compact = false,
  includeBlank = false,
  blankLabel = "None",
  blankValue = "",
  className,
  triggerClassName,
  size = "sm",
  disabled = false,
  seed,
}: {
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  compact?: boolean;
  includeBlank?: boolean;
  blankLabel?: string;
  blankValue?: string;
  className?: string;
  triggerClassName?: string;
  size?: "xs" | "sm" | "md";
  disabled?: boolean;
  seed?: UnitOfMeasure[];
}) {
  const normalizedValue = includeBlank && value === blankValue ? blankValue : normalizeUomCode(value);
  const options = useUomOptions({
    value: normalizedValue,
    compact,
    blankValue: includeBlank ? blankValue : undefined,
    blankLabel,
    seed,
  });

  if (compact) {
    return (
      <CompactSelect
        value={normalizedValue}
        onValueChange={onValueChange}
        options={options as CompactSelectOption[]}
        placeholder={placeholder}
        className={className}
        triggerClassName={triggerClassName}
        disabled={disabled}
      />
    );
  }

  return (
    <Select
      value={normalizedValue}
      onValueChange={onValueChange}
      options={options}
      placeholder={placeholder}
      className={className}
      triggerClassName={triggerClassName}
      size={size}
      disabled={disabled}
    />
  );
}
