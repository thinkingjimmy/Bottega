/**
 * [INPUT]: Depends on typed Base values, scoped draft lifecycle ports and accessible inputs.
 * [OUTPUT]: Provides scalar and location editors with independent host draft/commit scopes and stable focused input.
 * [POS]: Shared cell controls; form mode changes only the enclosing record draft.
 */
import { useEffect, useId, useRef, useState } from "react";
import { ExternalLinkIcon } from "lucide-react";
import { Input } from "@ai-chat/ui/components/ui/input";
import { Button } from "@ai-chat/ui/components/ui/button";
import { cn } from "@ai-chat/ui/lib/utils";
import { isBaseAttachmentValue, type BaseCellValue, type BaseColumn, type BaseLocation } from "../../../model/bases-ipc";
import type { BaseMutationOutcome } from "../../state/base-mutation-error";
import { useBasePlatform } from "../../platform/context";
import { useAppTranslation } from "../../platform/i18n";

export const CELL_CONTROL_CLASS = "h-9 w-full rounded-none border-0 bg-transparent px-2 shadow-none outline-none focus-visible:border-transparent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/30";
type Props = { column: BaseColumn; value: BaseCellValue | undefined; disabled?: boolean; inputId?: string;
  surface: "field" | "cell"; commitMode?: "immediate" | "form";
  onCommit(value: BaseCellValue | null): Promise<BaseMutationOutcome> | void };

function useCellDraft<T>(value: T, onCommit: Props["onCommit"], commitMode: Props["commitMode"]) {
  const { drafts } = useBasePlatform(), { t } = useAppTranslation();
  const scopeId = useId();
  const [draft, setDraft] = useState<{ value: T; dirty: boolean } | null>(null);
  const [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const started = useRef(false), saving = useRef(false), writer = useRef(onCommit);
  const begin = () => {
    if (started.current) return true;
    try { if (commitMode !== "form") drafts?.begin(scopeId); }
    catch { setError(t("bases.record.checkSave")); return false; }
    writer.current = onCommit; started.current = true; setDraft({ value, dirty: false }); return true;
  };
  const change = (next: T) => {
    if (!begin()) return;
    if (commitMode !== "form") drafts?.changed(scopeId);
    setDraft({ value: next, dirty: true }); setError("");
  };
  const commit = async (next: BaseCellValue | null, valid = true, explicit = false) => {
    if (drafts?.locked && !explicit || saving.current) return false;
    if (!valid) { setError(t("bases.cell.invalidValue")); return false; }
    if (!draft?.dirty) {
      if (started.current && commitMode !== "form") drafts?.cancel(scopeId);
      started.current = false; setDraft(null); return true;
    }
    saving.current = true; setBusy(true);
    try {
      const write = async () => writer.current(next);
      const failure = await (commitMode !== "form" && drafts?.commit ? drafts.commit(scopeId, write) : write());
      if (failure) { setError(failure); return false; }
      started.current = false; setDraft(null); setError("");
      return true;
    } catch { setError(t("bases.record.checkSave")); return false; }
    finally { saving.current = false; setBusy(false); }
  };
  return { value: draft?.value ?? value, begin, change, commit, busy, error, scopeId, drafts };
}

export function ScalarCellEditor({ column, value, disabled, surface, inputId, commitMode, onCommit }: Props) {
  const { t } = useAppTranslation(), { openExternal } = useBasePlatform();
  const field = useCellDraft(display(value), onCommit, commitMode);
  useEffect(() => {
    return field.drafts?.register?.(field.scopeId, () => {
      const trimmed = field.value.trim(), next = trimmed ? column.type === "number" ? Number(trimmed) : trimmed : null;
      const valid = typeof next === "number" ? Number.isFinite(next) : !trimmed || column.type !== "url" || URL.canParse(trimmed);
      return field.commit(next, valid, true);
    });
  });
  const commit = (input: HTMLInputElement) => {
    const trimmed = field.value.trim();
    const next = trimmed ? column.type === "number" ? Number(trimmed) : trimmed : null;
    void field.commit(next, input.validity.valid && (typeof next !== "number" || Number.isFinite(next)));
  };
  return <div className="min-w-0">
    <div className={cn("flex min-w-0 items-center", surface === "cell" ? "h-9 w-full" : "gap-1")}>
      <Input id={inputId} aria-label={column.name} aria-invalid={Boolean(field.error)} disabled={disabled || field.busy || field.drafts?.locked}
        className={cn("min-w-0 text-base md:text-xs", surface === "cell" ? CELL_CONTROL_CLASS : "h-9 px-1.5 md:h-7")}
        onFocus={() => field.begin()} onChange={event => field.change(event.target.value)} onBlur={event => commit(event.currentTarget)}
        onKeyDown={event => { if (event.key === "Enter") { if (commitMode !== "form") event.preventDefault(); event.currentTarget.blur(); } }}
        type={column.type === "number" ? "number" : column.type === "url" ? "url" : "text"}
        step={column.type === "number" ? "any" : undefined} value={field.value} />
      {column.type === "url" && typeof value === "string" && <Button aria-label={t("bases.cell.openLink")} className="size-9 shrink-0"
        onClick={() => void openExternal(value)} size="icon-sm" type="button" variant="ghost"><ExternalLinkIcon /></Button>}
    </div>
    {field.error && <span role="alert" className="text-xs text-destructive">{field.error}</span>}
  </div>;
}

export function LocationCellEditor({ column, value, disabled, surface, inputId, commitMode, onCommit }: Props) {
  const location = value && typeof value === "object" && !("kind" in value) ? value : { lat: 0, lng: 0 };
  const field = useCellDraft({ lat: String(location.lat), lng: String(location.lng) }, onCommit, commitMode);
  useEffect(() => {
    return field.drafts?.register?.(field.scopeId, () => {
      const next = { lat: Number(field.value.lat), lng: Number(field.value.lng) };
      return field.commit(next, Boolean(field.value.lat.trim() && field.value.lng.trim()) && Number.isFinite(next.lat) && Number.isFinite(next.lng) && Math.abs(next.lat) <= 90 && Math.abs(next.lng) <= 180, true);
    });
  });
  const commit = () => {
    const next: BaseLocation = { lat: Number(field.value.lat), lng: Number(field.value.lng) };
    void field.commit(next, Boolean(field.value.lat.trim() && field.value.lng.trim()) && Number.isFinite(next.lat) &&
      Number.isFinite(next.lng) && Math.abs(next.lat) <= 90 && Math.abs(next.lng) <= 180);
  };
  return <div onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) commit(); }}>
    <div className={cn("grid w-full grid-cols-2", surface === "field" && "gap-1")}>
      {(["lat", "lng"] as const).map(key => <Input key={key} id={inputId ? key === "lat" ? inputId : inputId + "-lng" : undefined}
        aria-label={`${column.name} ${key}`} aria-invalid={Boolean(field.error)} disabled={disabled || field.busy || field.drafts?.locked}
        className={cn("text-base md:text-xs", surface === "cell" ? CELL_CONTROL_CLASS : "h-9 px-1.5 md:h-7")}
        min={key === "lat" ? -90 : -180} max={key === "lat" ? 90 : 180} step="any" type="number"
        onFocus={() => field.begin()} onChange={event => field.change({ ...field.value, [key]: event.target.value })}
        onKeyDown={event => { if (event.key === "Enter") { if (commitMode !== "form") event.preventDefault(); event.currentTarget.blur(); } }} value={field.value[key]} />)}
    </div>
    {field.error && <span role="alert" className="text-xs text-destructive">{field.error}</span>}
  </div>;
}
function display(value: BaseCellValue | undefined) {
  if (value === undefined) return "";
  if (typeof value === "object") return isBaseAttachmentValue(value) ? value.filename : `${value.lat}, ${value.lng}`;
  return String(value);
}
