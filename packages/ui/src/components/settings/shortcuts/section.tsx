/**
 * [INPUT]: Host-owned shortcut rows, localized copy, capture policy and persistence callbacks.
 * [OUTPUT]: Shared ShortcutSettings with recording, disable/reset, conflicts and accessible keycaps.
 * [POS]: Native/Web keyboard settings presentation; platform storage and command authority stay in adapters.
 */
import { useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Pencil, RotateCcw, Trash2, TriangleAlert } from "lucide-react";
import { Button } from "../../ui/button";
import { Kbd, KbdGroup } from "../../ui/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../ui/tooltip";
import { SettingsSection } from "../page-frame";
import { SettingsList, SettingsRow } from "../content";
import { SettingsButton } from "../controls";
import { cn } from "../../../lib/utils";
import {
  shortcutGlyphs,
  type CaptureResult,
  type ShortcutBinding,
} from "../../../lib/shortcuts/model";
import {
  shortcutText,
  type getShortcutCopy,
} from "../../../lib/shortcuts/copy";
type ShortcutSettingRow = {
  id: string;
  label: string;
  hint?: string;
  binding: ShortcutBinding | null;
  overridden: boolean;
  conflicts?: string[];
};
type Copy = ReturnType<typeof getShortcutCopy>;
type Props = {
  rows: readonly ShortcutSettingRow[];
  copy: Copy;
  apple: boolean;
  hasOverrides: boolean;
  error?: string | null;
  capture(event: KeyboardEvent): CaptureResult;
  onChange(
    id: string,
    value: ShortcutBinding | null | undefined,
  ): Promise<void>;
  onRestore(): Promise<void>;
};
export function ShortcutSettings({
  rows,
  copy,
  hasOverrides,
  error,
  onRestore,
  ...props
}: Props) {
  const [restoring, setRestoring] = useState(false),
    [failure, setFailure] = useState<string | null>(null);
  return (
    <SettingsSection
      title={copy.title}
      description={copy.description}
      alert={error || failure}
      action={
        <SettingsButton
          variant="outline"
          className="shrink-0 max-md:min-h-11 pointer-coarse:min-h-11"
          disabled={!hasOverrides || restoring}
          onClick={async () => {
            setRestoring(true);
            setFailure(null);
            try {
              await onRestore();
            } catch {
              setFailure(copy.restoreFailed);
            } finally {
              setRestoring(false);
            }
          }}
        >
          {copy.restoreDefaults}
        </SettingsButton>
      }
    >
      <SettingsList>
        {rows.map((row) => (
          <ShortcutRow key={row.id} row={row} copy={copy} {...props} />
        ))}
      </SettingsList>
    </SettingsSection>
  );
}
function ShortcutRow({
  row,
  copy,
  apple,
  capture,
  onChange,
}: Pick<Props, "copy" | "apple" | "capture" | "onChange"> & {
  row: ShortcutSettingRow;
}) {
  const [busy, setBusy] = useState(false),
    [recording, setRecording] = useState(false),
    [error, setError] = useState<string | null>(null);
  const bindingKey = row.binding
    ? `${row.binding.key} ${row.binding.shift}`
    : "disabled";
  const [previousBinding, setPreviousBinding] = useState(bindingKey);
  if (previousBinding !== bindingKey) {
    setPreviousBinding(bindingKey);
    setError(null);
    setRecording(false);
  }
  const text = (template: string) =>
    shortcutText(template, { name: row.label, mod: apple ? "⌘" : "Ctrl" });
  const persist = async (value: ShortcutBinding | null | undefined) => {
    setBusy(true);
    setError(null);
    try {
      await onChange(row.id, value);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : copy.saveFailed);
    } finally {
      setBusy(false);
    }
  };
  const record = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (!recording) return;
    if (event.key === "Tab") {
      setRecording(false);
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Escape") {
      setRecording(false);
      return;
    }
    const result = capture(event.nativeEvent);
    if (result.kind === "pending") return;
    if (result.kind === "reject") {
      setError(text(copy.errors[result.reason]));
      return;
    }
    setRecording(false);
    void persist(result.binding);
  };
  const conflict = row.conflicts?.length
    ? shortcutText(copy.conflictWith, { name: row.conflicts.join(", ") })
    : null;
  const touch = "max-md:size-11 pointer-coarse:size-11";
  return (
    <SettingsRow
      label={row.label}
      htmlFor={`shortcut-${row.id}`}
      badge={
        row.binding ? undefined : (
          <span className="inline-flex h-[22px] shrink-0 items-center rounded-full bg-foreground/10 px-2 font-medium text-[11px] text-foreground leading-none">
            {copy.disabled}
          </span>
        )
      }
      description={
        row.hint || error ? (
          <>
            {row.hint}
            {error && (
              <span role="alert" className="block text-destructive">
                {error}
              </span>
            )}
          </>
        ) : undefined
      }
      control={
        <div className="flex flex-wrap items-center justify-end gap-1.5 max-md:max-w-[calc(100vw-5rem)]">
          {conflict && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  role="img"
                  tabIndex={0}
                  aria-label={conflict}
                  data-testid="shortcut-conflict"
                  className="inline-flex shrink-0 cursor-help text-amber-600 dark:text-amber-500"
                >
                  <TriangleAlert className="size-3.5" aria-hidden />
                </span>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-xs leading-relaxed">
                {conflict}
              </TooltipContent>
            </Tooltip>
          )}
          <span
            data-testid={`shortcut-keys-${row.id}`}
            className={cn(
              "flex h-8 min-w-24 items-center justify-center rounded-md px-2.5 text-xs",
              recording &&
                "h-auto min-h-8 max-w-48 bg-muted/60 ring-1 ring-ring/40",
            )}
          >
            {recording ? (
              <span className="text-muted-foreground">
                {copy.recordingPlaceholder}
                <span className="ml-1.5 text-muted-foreground/60">
                  {copy.recordingHint}
                </span>
              </span>
            ) : row.binding ? (
              <KbdGroup>
                {shortcutGlyphs(row.binding, apple).map((glyph) => (
                  <Kbd key={glyph}>{glyph}</Kbd>
                ))}
              </KbdGroup>
            ) : null}
          </span>
          {row.overridden && (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className={touch}
              aria-label={text(copy.resetAria)}
              disabled={busy}
              onClick={() => void persist(undefined)}
            >
              <RotateCcw />
            </Button>
          )}
          <Button
            id={`shortcut-${row.id}`}
            type="button"
            variant="ghost"
            size="icon-sm"
            className={cn(touch, recording && "bg-muted text-foreground")}
            aria-label={text(copy.editAria)}
            aria-pressed={recording}
            aria-describedby={
              row.hint || error ? `shortcut-${row.id}-description` : undefined
            }
            disabled={busy}
            onClick={() => {
              setError(null);
              setRecording(!recording);
            }}
            onKeyDown={record}
            onBlur={() => setRecording(false)}
          >
            <Pencil />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className={touch}
            aria-label={text(copy.disableAria)}
            disabled={busy || !row.binding}
            onClick={() => void persist(null)}
          >
            <Trash2 />
          </Button>
        </div>
      }
    />
  );
}
