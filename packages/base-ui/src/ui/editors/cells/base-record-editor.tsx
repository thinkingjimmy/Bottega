/**
 * [INPUT]: Typed cell editors, scoped draft/media ports, accessible dialogs and generic record contribution slots.
 * [OUTPUT]: BaseRecordEditor with retained field drafts, explicit save/discard, staged uploads and host action/result sections.
 * [POS]: Shared record form for all views; contribution refresh never replaces its draft identity.
 */
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Button } from "@ai-chat/ui/components/ui/button";
import { Input } from "@ai-chat/ui/components/ui/input";
import { ConfirmationDialog } from "@ai-chat/ui/components/ui/app-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@ai-chat/ui/components/ui/dialog";
import { useCoarsePointer } from "@ai-chat/ui/hooks/use-mobile";
import { baseCellText, cellValue, createBaseCellContext, isBaseAttachmentValue, type BaseCellValue, type BaseColumn, type BaseRow } from "@ai-chat/base-core/model/bases-ipc";
import { BASE_ATTACHMENT_BYTE_LIMIT } from "@ai-chat/base-core/attachments/gallery-attachments";
import { useAppTranslation } from "../../platform/i18n";
import { BaseUIProvider, useBasePlatform } from "../../platform/context";
import { BaseCellEditor } from "./base-cell-editor";
import { isWorkflowOnly } from "@ai-chat/base-core/compute/workflow-columns";
import { WorkflowColumnMark, WorkflowFieldValue } from "../../chrome/workflow-column";
import { RecordActions, RecordResults } from "../../state/record-slots";
import { codedFailure, describeBaseFailure } from "../../state/base-mutation-error";
import type { SurfaceLease } from "../../state/lease-retry";

export type BaseRecordDraft = { rowId: string; isNew: boolean; changedColumnIds: string[]; files: Record<string, File>;
  baselineValues: BaseRow["values"] | null; columns: BaseColumn[]; scope?: { ownerKey: string; ownerInstanceId: string } };
type Props = { open: boolean; columns: BaseColumn[]; firstColumnId?: string; record?: BaseRow; initialValues?: BaseRow["values"]; rows?: BaseRow[];
  ownerKey?: string; ownerInstanceId?: string; lease?: SurfaceLease; disabled?: boolean; onOpenChange(open: boolean): void;
  onSave(values: BaseRow["values"], attachment?: File, draft?: BaseRecordDraft): Promise<void> };
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
export function BaseRecordEditor(props: Props) { return props.open ? <RecordDialog {...props} /> : null; }
function RecordDialog({ columns: currentColumns, firstColumnId, record, initialValues, rows = [], ownerKey, ownerInstanceId, lease, disabled, onOpenChange, onSave }: Props) {
  const { t } = useAppTranslation(), platform = useBasePlatform();
  const coarse = useCoarsePointer();
  const [columns] = useState(() => structuredClone(currentColumns));
  const [commitRecord] = useState(() => onSave);
  const [rowId] = useState(() => record?.id ?? crypto.randomUUID());
  const [baselineValues] = useState(() => record ? structuredClone(record.values) : null);
  const [scope] = useState(() => ownerKey && ownerInstanceId ? { ownerKey, ownerInstanceId } : undefined);
  const [values, setValues] = useState<BaseRow["values"]>(() => structuredClone(record?.values ?? initialValues ?? {}));
  const valuesRef = useRef(values), changed = useRef(new Set<string>());
  const [files, setFiles] = useState<Record<string, File>>({}), uploadIds = useRef(new Map<File, string>());
  const [busy, setBusy] = useState(false), [dirty, setDirty] = useState(false), [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({}), [confirmLeave, setConfirmLeave] = useState(false);
  const [progress, setProgress] = useState<{ bytes: number; total: number } | null>(null);
  const controller = useRef<AbortController | null>(null), saving = useRef(false), alive = useRef(true);
  const draftPort = platform.drafts;
  const [draftSession] = useState(() => platform.drafts);
  const retained = draftPort?.retained;
  const draftScopeId = useId(), formRef = useRef<HTMLFormElement>(null);
  const [fields] = useState(() => new Map<string, () => Promise<unknown>>());
  // Form fields flush into the retained record draft before its single host commit.
  const fieldPlatform = useMemo(() => ({ ...platform, drafts: { ...platform.drafts!, register: (id: string, flush: () => Promise<unknown>) => {
    fields.set(id, flush);
    return () => { if (fields.get(id) === flush) fields.delete(id); };
  } } }), [platform, fields]);
  const [discardImages] = useState(() => platform.attachments.discardImages);
  useEffect(() => {
    const ids = uploadIds.current;
    return () => { void discardImages?.([...ids.values()]).catch(() => undefined); };
  }, [discardImages]);
  useEffect(() => {
    let live = true;
    alive.current = true;
    try { draftSession?.begin(draftScopeId); } catch { queueMicrotask(() => { if (live) setError(t("bases.record.checkSave")); }); }
    return () => { live = false; alive.current = false; controller.current?.abort(); };
  }, [draftSession, draftScopeId, t]);
  const ordered = useMemo(() => [...columns.filter(c => c.id === firstColumnId), ...columns.filter(c => c.id !== firstColumnId)], [columns, firstColumnId]);
  const draftRow = useMemo(() => ({ id: rowId, values }), [rowId, values]);
  const context = useMemo(() => createBaseCellContext({ columns, rows: [...rows.filter(row => row.id !== rowId), draftRow] }), [columns, rows, rowId, draftRow]);
  const markDirty = () => { setDirty(true); draftSession?.changed(draftScopeId); };
  const update = (columnId: string, value: BaseCellValue | null) => {
    const next = { ...valuesRef.current };
    if (value === null) delete next[columnId]; else next[columnId] = value;
    valuesRef.current = next; setValues(next); changed.current.add(columnId); markDirty();
  };
  const close = () => {
    try { draftSession?.cancel(draftScopeId); }
    catch { setError(t("bases.record.checkSave")); return; }
    void discardImages?.([...uploadIds.current.values()]).catch(() => undefined);
    if (alive.current) onOpenChange(false);
  };
  const changeOpen = (open: boolean) => {
    if (open || busy) return;
    if (dirty) setConfirmLeave(true); else close();
  };
  const chooseFile = (columnId: string, file: File | undefined) => {
    if (!file) return;
    const admitted = platform.attachments.imageSources?.admits(file) ?? IMAGE_TYPES.includes(file.type);
    const reason = !admitted ? t("bases.record.unsupportedImage") : file.size > BASE_ATTACHMENT_BYTE_LIMIT || !file.size ? t("bases.record.fileLimit") : "";
    setFieldErrors(previous => ({ ...previous, [columnId]: reason }));
    if (reason) return;
    const previous = files[columnId], previousId = previous && uploadIds.current.get(previous);
    if (previousId) { void discardImages?.([previousId]).catch(() => undefined); uploadIds.current.delete(previous); }
    setFiles(current => ({ ...current, [columnId]: file })); changed.current.add(columnId); markDirty();
  };
  const save = async (form: HTMLFormElement, explicit = false) => {
    if (saving.current || (disabled || draftPort?.locked) && !explicit) return;
    saving.current = true;
    for (const flush of [...fields.values()]) {
      if (await flush() === false) { saving.current = false; return; }
    }
    (document.activeElement as HTMLElement | null)?.blur();
    await Promise.resolve();
    if (!form.reportValidity() || Object.values(fieldErrors).some(Boolean)) { saving.current = false; return; }
    setBusy(true); setError("");
    const cancellation = new AbortController(); controller.current = cancellation;
    try {
      const next = { ...valuesRef.current };
      if (scope && (scope.ownerKey !== ownerKey || scope.ownerInstanceId !== ownerInstanceId)) throw codedFailure("base_scope_changed");
      if (platform.attachments.stageImage && scope) {
        for (const [columnId, file] of Object.entries(files)) {
          const uploadId = uploadIds.current.get(file) ?? crypto.randomUUID(); uploadIds.current.set(file, uploadId);
          const stage = () => platform.attachments.stageImage!({ ...scope, surfaceLeaseId: lease?.current(), file, uploadId }, cancellation.signal, setProgress);
          next[columnId] = await (lease ? lease.retry(stage) : stage());
        }
      } else if (Object.keys(files).length > 1) throw codedFailure("multiple_images");
      cancellation.signal.throwIfAborted(); setProgress(null);
      const write = () => commitRecord(next, firstColumnId ? files[firstColumnId] : Object.values(files)[0], {
        rowId, isNew: baselineValues === null, changedColumnIds: [...changed.current], files, baselineValues, columns, scope,
      });
      await (draftSession?.commit ? draftSession.commit(draftScopeId, write) : write());
      void discardImages?.([...uploadIds.current.values()]).catch(() => undefined);
      if (alive.current) { setDirty(false); onOpenChange(false); }
    } catch (cause) {
      if (cancellation.signal.aborted) void discardImages?.([...uploadIds.current.values()]).catch(() => undefined);
      const copy = cancellation.signal.aborted ? { copyKey: "bases.record.uploadCancelled", values: {} } : await describeBaseFailure(cause, "change", async () => null);
      if (alive.current) setError(t(copy.copyKey, copy.values));
    } finally {
      saving.current = false; controller.current = null;
      if (alive.current) { setBusy(false); setProgress(null); }
    }
  };
  useEffect(() => draftSession?.register?.(draftScopeId, async () => { if (formRef.current) await save(formRef.current, true); }));
  const requiredImage = !record && Boolean(firstColumnId) && ordered[0]?.type === "attachment" && !files[ordered[0].id] && !isBaseAttachmentValue(values[ordered[0].id]);
  return <>
    <Dialog open onOpenChange={changeOpen}><DialogContent sheetOnNarrow className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-xl"
      onOpenAutoFocus={event => { if (coarse) event.preventDefault(); }}>
      <DialogHeader><DialogTitle>{t(record ? "bases.record.editTitle" : "bases.record.title")}</DialogTitle>
        <DialogDescription>{t("bases.record.description")}</DialogDescription></DialogHeader>
      {retained && <p role="status" className="text-sm text-muted-foreground">{retained.notice}</p>}
      <form ref={formRef} onSubmit={event => { event.preventDefault(); if (retained) void retained.save(); else void save(event.currentTarget); }} onChangeCapture={markDirty} className="space-y-5">
        <BaseUIProvider value={fieldPlatform}><div className="space-y-4 py-2">{ordered.map(column => {
          const fieldId = "record-" + rowId + "-" + column.id, fieldError = fieldErrors[column.id];
          return <div key={column.id} className="grid gap-2 text-sm">
            <label htmlFor={fieldId} className="flex items-center gap-1.5 font-medium">{column.name}{isWorkflowOnly(column) && <WorkflowColumnMark />}</label>
            {isWorkflowOnly(column) ? <WorkflowFieldValue id={fieldId}>{baseCellText(column, cellValue(draftRow, column, context)) || "—"}</WorkflowFieldValue>
            : column.type === "attachment" ? <>
              {isBaseAttachmentValue(values[column.id]) && <BaseCellEditor column={column} value={values[column.id]} disabled={busy || disabled || draftPort?.locked} onCommit={value => update(column.id, value)} />}
              <Input id={fieldId} type="file" accept={platform.attachments.imageSources?.accept ?? IMAGE_TYPES.join(",")} aria-label={column.name} aria-invalid={Boolean(fieldError)} className="pointer-coarse:h-10"
                aria-describedby={fieldError ? fieldId + "-error" : undefined} disabled={busy || disabled || draftPort?.locked}
                onChange={event => chooseFile(column.id, event.target.files?.[0])} />
              {files[column.id] && <span className="break-all text-xs text-muted-foreground">{files[column.id]!.name}</span>}
            </> : <BaseCellEditor inputId={fieldId} commitMode="form" column={column} disabled={busy || disabled || draftPort?.locked} relationContext={context} relationOptions={rows}
              storedValue={values[column.id]} value={cellValue(draftRow, column, context)} onCommit={value => update(column.id, value)} />}
            {fieldError && <span id={fieldId + "-error"} role="alert">{fieldError}</span>}
          </div>;
        })}</div></BaseUIProvider>
        {record && <><RecordActions rowId={record.id} /><RecordResults rowId={record.id} placement="record" /></>}
        {progress && <div className="space-y-2" role="status"><span>{t("bases.record.uploading")}</span>
          <progress aria-label={t("bases.record.uploading")} value={progress.bytes} max={Math.max(1, progress.total)} className="w-full" />
          <Button type="button" variant="outline" onClick={() => controller.current?.abort()}>{t("bases.record.cancelUpload")}</Button></div>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter className="sticky bottom-0 bg-background pt-3">
          {retained?.keep && <Button type="button" variant="ghost" disabled={busy} onClick={retained.keep.run}>{retained.keep.label}</Button>}
          <Button type="button" variant="outline" disabled={busy} onClick={() => changeOpen(false)}>{t("common.cancel")}</Button>
          <Button type="submit" disabled={busy || requiredImage || (retained ? retained.saveDisabled : disabled || draftPort?.locked)}>{busy ? t("bases.record.saving") : retained?.saveLabel ?? t("common.save")}</Button>
        </DialogFooter>
      </form>
    </DialogContent></Dialog>
    <ConfirmationDialog open={confirmLeave} title={t("bases.record.leaveTitle")} description={t("bases.record.leaveDescription")}
      confirmLabel={t("bases.record.discard")} cancelLabel={t("common.cancel")} onOpenChange={setConfirmLeave} onConfirm={close} />
  </>;
}
