/**
 * [INPUT]: Host-supplied package catalog, exact Base identity, isolated frame and bounded result reader.
 * [OUTPUT]: RecordPluginSlots publishes shared contributions, owns the open frame and resumes bounded UTF-8 result reads within the current record/reader.
 * [POS]: Desktop/Web presentation adapter; hosts retain transport, admission and account ownership.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import type { RecordEntry, RecordOpen, RecordTarget } from "@bottega/contracts/plugins/records/contract";
import { PuzzleIcon, SettingsIcon } from "lucide-react";
import { Button } from "@ai-chat/ui/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@ai-chat/ui/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@ai-chat/ui/components/ui/dialog";
import { useAppTranslation } from "../platform/i18n";
import type { RecordContribution } from "./record-slots";

export type RecordFrameProps = { input: RecordOpen; entry: RecordEntry; onClose(): void; onChanged(): void };
export type RecordResultReader = (target: RecordTarget, read?: { resultRef: string; offset: number }, signal?: AbortSignal) => Promise<unknown>;
export function RecordPluginSlots({ base, entries, disabled, Surface, readResults, onSettings, onContributions }: {
  base: RecordTarget["base"]; entries: readonly RecordEntry[]; disabled?: boolean; Surface: ComponentType<RecordFrameProps>;
  readResults: RecordResultReader; onSettings?(pluginId: string): void; onContributions(value: readonly RecordContribution[]): void;
}) {
  const { t } = useAppTranslation();
  const [opened, setOpened] = useState<{ input: RecordOpen; entry: RecordEntry } | null>(null);
  const [revision, setRevision] = useState(0);
  const close = useCallback(() => setOpened(null), []), changed = useCallback(() => setRevision(value => value + 1), []);
  const available = entries.filter(entry => entry.enabled);
  const value = useMemo<readonly RecordContribution[]>(() => [{
    id: "record-plugins", label: t("bases.plugins.title"),
    actions: available.length ? rowId => <DropdownMenu><DropdownMenuTrigger asChild>
      <Button type="button" size="icon" variant="ghost" className="size-6 pointer-coarse:size-11" disabled={disabled}
        aria-label={t("bases.plugins.actions")}><PuzzleIcon className="size-3.5" /></Button>
    </DropdownMenuTrigger><DropdownMenuContent>{available.flatMap(entry => entry.records.actions.map(action =>
      <DropdownMenuItem key={`${entry.id}:${action.id}`} onSelect={() => setOpened({ entry, input: { base, rowId,
        pluginId: entry.id, generationId: entry.generationId, actionId: action.id } })}>{action.title}<span className="ml-3 text-xs text-muted-foreground">{entry.name}</span></DropdownMenuItem>
    ))}</DropdownMenuContent></DropdownMenu> : undefined,
    settings: onSettings && available.length ? <DropdownMenu><DropdownMenuTrigger asChild>
      <Button type="button" variant="ghost" size="icon" aria-label={t("bases.plugins.settings")}><SettingsIcon /></Button>
    </DropdownMenuTrigger><DropdownMenuContent>{available.map(entry => <DropdownMenuItem key={entry.id}
      onSelect={() => onSettings(entry.id)}>{entry.name}</DropdownMenuItem>)}</DropdownMenuContent></DropdownMenu> : undefined,
  }, {
    id: "record-results", label: t("bases.plugins.results"), summary: false,
    results: (rowId, placement) => placement === "record" ? <RecordResultSection key={`${base.ownerKey}:${base.ownerInstanceId}:${rowId}`}
      target={{ base, rowId }} read={readResults} revision={revision} /> : null,
  }], [base.ownerKey, base.ownerInstanceId, entries, disabled, readResults, onSettings, revision, t]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { onContributions(value); return () => onContributions([]); }, [onContributions, value]);
  const current = opened && entries.find(entry => entry.id === opened.entry.id);
  const valid = opened && current?.enabled && current.generationId === opened.input.generationId && opened.input.base.ownerKey === base.ownerKey
    && opened.input.base.ownerInstanceId === base.ownerInstanceId && !disabled;
  return <Dialog open={Boolean(opened)} onOpenChange={open => { if (!open) setOpened(null); }}>
    <DialogContent className="h-[min(80dvh,680px)] sm:max-w-3xl flex flex-col overflow-hidden">
      <DialogHeader><DialogTitle>{opened?.entry.records.actions.find(action => action.id === opened.input.actionId)?.title}</DialogTitle></DialogHeader>
      {valid ? <Surface key={`${opened.input.pluginId}:${opened.input.rowId}`} input={opened.input} entry={current}
        onClose={close} onChanged={changed} /> : <p role="status">{t("bases.plugins.unavailable")}</p>}
    </DialogContent>
  </Dialog>;
}

type Result = { resultRef: string; label: string; bytes: number };
function RecordResultSection({ target, read, revision }: { target: RecordTarget; read: RecordResultReader; revision: number }) {
  const { t } = useAppTranslation();
  const [items, setItems] = useState<Result[]>([]), [failed, setFailed] = useState<false | "list" | "read">(false), [attempt, setAttempt] = useState(0);
  const [report, setReport] = useState<{ ref: string; text: string } | null>(null), [busy, setBusy] = useState(false);
  const [readAttempt, setReadAttempt] = useState(0);
  const cursor = useRef<{ ref: string; read: RecordResultReader; offset: number; total?: number; text: string; decoder: TextDecoder; done: boolean; pages: number } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void read(target, undefined, controller.signal).then(value => { if (!controller.signal.aborted) { setItems((value as { results: Result[] }).results); setFailed(false); } },
      () => { if (!controller.signal.aborted) setFailed("list"); });
    return () => controller.abort();
  }, [target.base.ownerKey, target.base.ownerInstanceId, target.rowId, read, revision, attempt]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!report) return;
    const controller = new AbortController();
    if (!cursor.current || cursor.current.ref !== report.ref || cursor.current.read !== read) {
      cursor.current = { ref: report.ref, read, offset: 0, text: "", decoder: new TextDecoder("utf-8", { fatal: true }), done: false, pages: 0 };
    }
    const progress = cursor.current;
    setReport({ ref: progress.ref, text: progress.text });
    void (async () => {
      while (!progress.done && progress.pages < 1024) {
        const value = await read(target, { resultRef: progress.ref, offset: progress.offset }, controller.signal) as { chunk: string; offset: number; total: number; done: boolean };
        controller.signal.throwIfAborted();
        const bytes = Uint8Array.from(atob(value.chunk), character => character.charCodeAt(0));
        if (value.offset !== progress.offset || !Number.isSafeInteger(value.total) || value.total < 0 || value.total > 4 * 1024 * 1024
          || progress.total !== undefined && value.total !== progress.total || bytes.length > 4096 || progress.offset + bytes.length > value.total
          || !bytes.length && !value.done || value.done && progress.offset + bytes.length !== value.total) throw new Error("result-page-invalid");
        progress.text += progress.decoder.decode(bytes, { stream: !value.done });
        progress.offset += bytes.length; progress.total = value.total; progress.done = value.done; progress.pages++;
        setReport({ ref: progress.ref, text: progress.text });
      }
      if (!progress.done) throw new Error("result-page-budget");
    })().catch(() => { if (!controller.signal.aborted) setFailed("read"); }).finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [report?.ref, read, readAttempt]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!items.length && !failed) return null;
  return <section className="space-y-2" data-record-result-section={target.rowId}>
    <h3 className="font-medium text-sm">{t("bases.plugins.results")}</h3>
    {items.map(item => <Button key={item.resultRef} type="button" size="sm" variant="outline" onClick={() => { setBusy(true); setFailed(false); setReport({ ref: item.resultRef, text: "" }); setReadAttempt(value => value + 1); }}>{item.label}</Button>)}
    {failed && <p role="alert" className="text-sm">{t("bases.plugins.failed")} <Button type="button" variant="ghost" onClick={() => {
      setFailed(false);
      if (failed === "list") setAttempt(value => value + 1);
      else { setBusy(true); setReadAttempt(value => value + 1); }
    }}>{t("bases.gui.retry")}</Button></p>}
    {busy && <p role="status">{t("bases.loading")}</p>}
    {report && <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded border p-3 text-xs">{report.text}</pre>}
  </section>;
}
