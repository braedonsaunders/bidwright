"use client";

import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { ChevronDown, ChevronUp, GripVertical, LockKeyhole } from "lucide-react";
import {
  Button,
  NavIcon,
  SettingsSection,
  Switch,
  reconcileNavigationConfig,
  stampKnownNavigationItems,
  type NavigationItemConfig,
  type NavigationRegistryItem,
  type TenantNavigationConfig,
} from "@braedonsaunders/appkit-ui";

export type NavigationConfigEditorLabels = {
  title?: string;
  description?: string;
  visible?: string;
  hidden?: string;
  required?: string;
  moveUp?: (label: string) => string;
  moveDown?: (label: string) => string;
  drag?: (label: string) => string;
};

export type NavigationConfigEditorProps = {
  registry: readonly NavigationRegistryItem[];
  value?: TenantNavigationConfig | null;
  onChange: (config: TenantNavigationConfig) => void;
  disabled?: boolean;
  labels?: NavigationConfigEditorLabels;
  className?: string;
};

const DEFAULT_LABELS: Required<NavigationConfigEditorLabels> = {
  title: "Main navigation",
  description: "Choose which destinations appear and drag them into the order your team uses.",
  visible: "Visible",
  hidden: "Hidden",
  required: "Required",
  moveUp: (label) => `Move ${label} up`,
  moveDown: (label) => `Move ${label} down`,
  drag: (label) => `Drag to reorder ${label}`,
};

/**
 * AppKit's editor uses Framer Motion Reorder, which ignores the gesture unless
 * the pointer has velocity and the item objects keep the same identity. That
 * editor rebuilds the objects on every change, so the rows snap back. Reorder
 * from pointer travel instead.
 */
export function NavigationConfigEditor({
  registry,
  value,
  onChange,
  disabled = false,
  labels,
  className,
}: NavigationConfigEditorProps) {
  const text = { ...DEFAULT_LABELS, ...labels };
  const items = reconcileNavigationConfig(value, registry).items;
  const registryByKey = new Map(registry.map((item) => [item.key, item]));
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const registryRef = useRef(registry);
  registryRef.current = registry;

  const commit = (next: readonly NavigationItemConfig[]) => {
    onChangeRef.current(stampKnownNavigationItems({ version: 1, items: [...next] }, registryRef.current));
  };

  const reorder = (from: number, to: number) => {
    const next = moveNavigationItems(itemsRef.current, from, to);
    if (next === itemsRef.current) return;
    commit(next);
  };

  const setVisible = (key: string, visible: boolean) => {
    commit(
      itemsRef.current.map((item) =>
        item.key === key ? { key: item.key, ...(visible ? {} : { hidden: true }) } : item,
      ),
    );
  };

  return (
    <SettingsSection title={text.title} description={text.description} className={className}>
      <div className="divide-y divide-border" data-count={items.length}>
        {items.map((item, index) => {
          const registryItem = registryByKey.get(item.key);
          if (!registryItem) return null;
          return (
            <NavigationConfigRow
              key={item.key}
              item={item}
              registryItem={registryItem}
              index={index}
              count={items.length}
              disabled={disabled}
              labels={text}
              onReorder={reorder}
              onVisibilityChange={(visible) => setVisible(item.key, visible)}
            />
          );
        })}
      </div>
    </SettingsSection>
  );
}

export function moveNavigationItems<T>(items: readonly T[], from: number, to: number): readonly T[] {
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) return items;
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item as T);
  return next;
}

function NavigationConfigRow({
  item,
  registryItem,
  index,
  count,
  disabled,
  labels,
  onReorder,
  onVisibilityChange,
}: {
  item: NavigationItemConfig;
  registryItem: NavigationRegistryItem;
  index: number;
  count: number;
  disabled: boolean;
  labels: Required<NavigationConfigEditorLabels>;
  onReorder: (from: number, to: number) => void;
  onVisibilityChange: (visible: boolean) => void;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const visible = registryItem.required || !item.hidden;

  useEffect(() => () => cleanupRef.current?.(), []);

  const onGripPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (disabled || event.button !== 0) return;
    event.preventDefault();
    const row = rowRef.current;
    if (!row) return;

    cleanupRef.current?.();
    const session = {
      pointerId: event.pointerId,
      originY: event.clientY,
      locked: false,
      expectIndex: index,
    };
    row.style.position = "relative";
    row.style.zIndex = "2";

    const finish = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      row.style.transform = "";
      row.style.zIndex = "";
      row.style.position = "";
      cleanupRef.current = null;
    };

    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== session.pointerId) return;
      ev.preventDefault();
      const currentIndex = Number(row.dataset.index);
      const height = Math.max(row.offsetHeight, row.getBoundingClientRect().height, 32);
      if (session.locked) {
        if (currentIndex !== session.expectIndex) {
          row.style.transform = `translate3d(0, ${ev.clientY - session.originY}px, 0)`;
          return;
        }
        session.locked = false;
      }

      const dy = ev.clientY - session.originY;
      // Swap once the pointer passes the midpoint of the neighboring row.
      const steps =
        dy === 0
          ? 0
          : dy > 0
            ? Math.floor((dy + height / 2) / height)
            : Math.ceil((dy - height / 2) / height);
      row.style.transform = `translate3d(0, ${dy}px, 0)`;
      if (steps === 0) return;

      const last = Number(row.dataset.count) - 1;
      const target = Math.min(last, Math.max(0, currentIndex + steps));
      if (target === currentIndex) return;

      session.originY += (target - currentIndex) * height;
      session.expectIndex = target;
      session.locked = true;
      row.style.transform = `translate3d(0, ${ev.clientY - session.originY}px, 0)`;
      onReorder(currentIndex, target);
    };

    const onUp = (ev: PointerEvent) => {
      if (ev.pointerId !== session.pointerId) return;
      finish();
    };

    cleanupRef.current = finish;
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  return (
    <div
      ref={rowRef}
      data-nav-row
      data-nav-key={item.key}
      data-index={index}
      data-count={count}
      className="flex items-center gap-3 bg-surface px-4 py-3"
    >
      <button
        type="button"
        disabled={disabled}
        aria-label={labels.drag(registryItem.label)}
        onPointerDown={onGripPointerDown}
        className="cursor-grab touch-none select-none rounded-md p-1 text-fg-subtle transition-colors hover:bg-surface-hover hover:text-fg disabled:cursor-not-allowed disabled:opacity-40 active:cursor-grabbing"
      >
        <GripVertical className="size-4" aria-hidden />
      </button>

      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-bg-subtle text-fg-muted">
        <NavIcon iconKey={registryItem.iconKey} />
      </span>

      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-fg">{registryItem.label}</div>
        {registryItem.description ? (
          <div className="truncate text-xs text-fg-muted">{registryItem.description}</div>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={disabled || index === 0}
          aria-label={labels.moveUp(registryItem.label)}
          onClick={() => onReorder(index, index - 1)}
        >
          <ChevronUp className="size-4" aria-hidden />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={disabled || index === count - 1}
          aria-label={labels.moveDown(registryItem.label)}
          onClick={() => onReorder(index, index + 1)}
        >
          <ChevronDown className="size-4" aria-hidden />
        </Button>
      </div>

      {registryItem.required ? (
        <span
          className="flex min-w-20 items-center justify-end gap-1 text-xs font-medium text-fg-muted"
          title={labels.required}
        >
          <LockKeyhole className="size-3.5" aria-hidden />
          {labels.required}
        </span>
      ) : (
        <div className="flex min-w-20 items-center justify-end gap-2 text-xs font-medium text-fg-muted">
          <span>{visible ? labels.visible : labels.hidden}</span>
          <Switch
            checked={visible}
            disabled={disabled}
            aria-label={`${registryItem.label}: ${visible ? labels.visible : labels.hidden}`}
            onChange={(event) => onVisibilityChange(event.target.checked)}
          />
        </div>
      )}
    </div>
  );
}
