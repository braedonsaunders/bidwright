export type TakeoffShortcutPreset = "bidwright" | "planswift";

export type TakeoffShortcutAction =
  | { kind: "tool"; toolId: string }
  | { kind: "undo" }
  | { kind: "redo" }
  | { kind: "next-page" }
  | { kind: "previous-page" }
  | { kind: "zoom-in" }
  | { kind: "zoom-out" };

export interface TakeoffShortcutChord {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
}

interface ShortcutBinding {
  key: string;
  ctrlOrMeta?: boolean;
  shift?: boolean;
  alt?: boolean;
  action: TakeoffShortcutAction;
  label: string;
}

export const TAKEOFF_SHORTCUT_PRESET_OPTIONS: Array<{ value: TakeoffShortcutPreset; label: string }> = [
  { value: "bidwright", label: "BidWright" },
  { value: "planswift", label: "PlanSwift" },
];

const COMMON_BINDINGS: ShortcutBinding[] = [
  { key: "z", ctrlOrMeta: true, action: { kind: "undo" }, label: "Ctrl/Cmd+Z" },
  { key: "z", ctrlOrMeta: true, shift: true, action: { kind: "redo" }, label: "Ctrl/Cmd+Shift+Z" },
  { key: "y", ctrlOrMeta: true, action: { kind: "redo" }, label: "Ctrl/Cmd+Y" },
  { key: "arrowright", alt: true, action: { kind: "next-page" }, label: "Alt+Right" },
  { key: "arrowleft", alt: true, action: { kind: "previous-page" }, label: "Alt+Left" },
  { key: "=", ctrlOrMeta: true, action: { kind: "zoom-in" }, label: "Ctrl/Cmd+=" },
  { key: "+", ctrlOrMeta: true, action: { kind: "zoom-in" }, label: "Ctrl/Cmd++" },
  { key: "-", ctrlOrMeta: true, action: { kind: "zoom-out" }, label: "Ctrl/Cmd+-" },
];

const PRESET_BINDINGS: Record<TakeoffShortcutPreset, ShortcutBinding[]> = {
  bidwright: [
    { key: "v", action: { kind: "tool", toolId: "select" }, label: "V" },
    { key: "s", action: { kind: "tool", toolId: "calibrate" }, label: "S" },
    { key: "l", action: { kind: "tool", toolId: "linear" }, label: "L" },
    { key: "p", action: { kind: "tool", toolId: "linear-polyline" }, label: "P" },
    { key: "r", action: { kind: "tool", toolId: "area-rectangle" }, label: "R" },
    { key: "a", action: { kind: "tool", toolId: "area-polygon" }, label: "A" },
    { key: "c", action: { kind: "tool", toolId: "count" }, label: "C" },
    { key: "d", action: { kind: "tool", toolId: "count-by-distance" }, label: "D" },
    { key: "n", action: { kind: "tool", toolId: "markup-note" }, label: "N" },
    { key: "h", action: { kind: "tool", toolId: "markup-highlight" }, label: "H" },
  ],
  planswift: [
    { key: "s", action: { kind: "tool", toolId: "select" }, label: "S" },
    { key: "x", action: { kind: "tool", toolId: "calibrate" }, label: "X" },
    { key: "l", action: { kind: "tool", toolId: "linear" }, label: "L" },
    { key: "d", action: { kind: "tool", toolId: "linear-polyline" }, label: "D" },
    { key: "r", action: { kind: "tool", toolId: "area-rectangle" }, label: "R" },
    { key: "a", action: { kind: "tool", toolId: "area-polygon" }, label: "A" },
    { key: "c", action: { kind: "tool", toolId: "count" }, label: "C" },
    { key: "m", action: { kind: "tool", toolId: "count-by-distance" }, label: "M" },
    { key: "n", action: { kind: "tool", toolId: "markup-note" }, label: "N" },
    { key: "h", action: { kind: "tool", toolId: "markup-highlight" }, label: "H" },
  ],
};

function normalizeKey(key: string): string {
  const lower = key.trim().toLowerCase();
  if (lower === " ") return "space";
  if (lower === "esc") return "escape";
  return lower;
}

function sameAction(left: TakeoffShortcutAction, right: TakeoffShortcutAction): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "tool" && right.kind === "tool") return left.toolId === right.toolId;
  return true;
}

function matchesBinding(chord: TakeoffShortcutChord, binding: ShortcutBinding): boolean {
  const ctrlOrMeta = Boolean(chord.ctrlKey || chord.metaKey);
  const needsCtrlOrMeta = binding.ctrlOrMeta === true;
  const needsAlt = binding.alt === true;
  const needsShift = binding.shift === true;
  return (
    normalizeKey(chord.key) === binding.key &&
    ctrlOrMeta === needsCtrlOrMeta &&
    Boolean(chord.altKey) === needsAlt &&
    Boolean(chord.shiftKey) === needsShift
  );
}

export function takeoffShortcutBindings(preset: TakeoffShortcutPreset): ShortcutBinding[] {
  return [...COMMON_BINDINGS, ...PRESET_BINDINGS[preset]];
}

export function resolveTakeoffShortcut(
  chord: TakeoffShortcutChord,
  preset: TakeoffShortcutPreset,
): TakeoffShortcutAction | null {
  return takeoffShortcutBindings(preset).find((binding) => matchesBinding(chord, binding))?.action ?? null;
}

export function takeoffShortcutLabel(
  action: TakeoffShortcutAction,
  preset: TakeoffShortcutPreset,
): string | null {
  return takeoffShortcutBindings(preset).find((binding) => sameAction(binding.action, action))?.label ?? null;
}
