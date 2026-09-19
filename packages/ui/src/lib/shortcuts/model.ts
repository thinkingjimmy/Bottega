/**
 * [INPUT]: Keyboard events and host-owned modifier, reserved-key and capture policies.
 * [OUTPUT]: Shared binding shape, exact matching, capture, conflict grouping and key glyphs.
 * [POS]: Pure native/Web shortcut mechanics; no storage, routing or native APIs.
 */
export type ShortcutBinding = { key: string; shift: boolean };
export type ShortcutModifier = "meta" | "control" | "either";
export type CaptureResult =
  | { kind: "capture"; binding: ShortcutBinding }
  | { kind: "pending" }
  | {
      kind: "reject";
      reason:
        "needsModifier" | "altReserved" | "reservedCombo" | "unsupportedKey";
    };
export function hasShortcutModifier(
  event: KeyboardEvent,
  modifier: ShortcutModifier,
) {
  return modifier === "either"
    ? event.metaKey || event.ctrlKey
    : modifier === "meta"
      ? event.metaKey && !event.ctrlKey
      : event.ctrlKey && !event.metaKey;
}
export function matchesShortcut(
  event: KeyboardEvent,
  binding: ShortcutBinding | null,
  modifier: ShortcutModifier = "either",
  key = event.key.toLowerCase(),
) {
  return Boolean(
    !event.defaultPrevented && !event.isComposing && event.keyCode !== 229 && !event.getModifierState?.("AltGraph") &&
    binding &&
    hasShortcutModifier(event, modifier) &&
    !event.altKey &&
    event.shiftKey === binding.shift &&
    key === binding.key,
  );
}
export function createShortcutDispatcher<Id extends string>(options: {
  ids: readonly Id[];
  binding(id: Id): ShortcutBinding | null;
  handler(id: Id): (() => void) | undefined;
  modifier?: () => ShortcutModifier;
  key?: (event: KeyboardEvent) => string;
  modalScope?: (id: Id) => boolean;
  accepts?: (event: KeyboardEvent, id: Id) => boolean;
}) {
  return (event: KeyboardEvent) => {
    if (event.repeat) return;
    for (const id of options.ids) {
      const run = options.handler(id);
      if (!run || !matchesShortcut(event, options.binding(id), options.modifier?.() ?? "either", options.key?.(event)) ||
        options.modalScope?.(id) || options.accepts?.(event, id) === false) continue;
      event.preventDefault(); run(); return;
    }
  };
}
export function captureShortcut(
  event: KeyboardEvent,
  {
    modifier = "either",
    reserved,
    allowEnter = false,
    key = event.key.toLowerCase(),
  }: {
    modifier?: ShortcutModifier;
    reserved(binding: ShortcutBinding): boolean;
    allowEnter?: boolean;
    key?: string;
  },
): CaptureResult {
  if (
    event.isComposing ||
    event.keyCode === 229 ||
    event.repeat ||
    ["Meta", "Control", "Shift", "Alt"].includes(event.key)
  )
    return { kind: "pending" };
  if (!hasShortcutModifier(event, modifier))
    return { kind: "reject", reason: "needsModifier" };
  if (event.altKey) return { kind: "reject", reason: "altReserved" };
  if (!(
    (key.length === 1 && key !== " ") ||
    /^f([1-9]|1[0-2])$/.test(key) ||
    (allowEnter && key === "enter")
  ))
    return { kind: "reject", reason: "unsupportedKey" };
  const binding = { key, shift: event.shiftKey };
  return reserved(binding)
    ? { kind: "reject", reason: "reservedCombo" }
    : { kind: "capture", binding };
}
export function shortcutGlyphs(
  binding: ShortcutBinding,
  apple: boolean,
): string[] {
  const key =
    binding.key === "enter"
      ? "Enter"
      : /^[a-z]$|^f([1-9]|1[0-2])$/.test(binding.key)
        ? binding.key.toUpperCase()
        : binding.key;
  return [
    apple ? "⌘" : "Ctrl",
    ...(binding.shift ? [apple ? "⇧" : "Shift"] : []),
    key,
  ];
}
export function shortcutConflicts<Id extends string>(
  ids: readonly Id[],
  bindings: Readonly<Record<Id, ShortcutBinding | null>>,
): ReadonlyMap<Id, Id[]> {
  const groups = new Map<string, Id[]>();
  for (const id of ids) {
    const binding = bindings[id];
    if (!binding) continue;
    const key = `${binding.key} ${binding.shift}`;
    groups.set(key, [...(groups.get(key) ?? []), id]);
  }
  const conflicts = new Map<Id, Id[]>();
  for (const group of groups.values())
    if (group.length > 1)
      for (const id of group)
        conflicts.set(
          id,
          group.filter((other) => other !== id),
        );
  return conflicts;
}
