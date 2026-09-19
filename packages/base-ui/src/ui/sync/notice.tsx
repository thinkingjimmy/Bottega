/**
 * [INPUT]: Depends on shared Base review ports, host translations and accessible Dialog/Button primitives.
 * [OUTPUT]: Shows persistent synchronization status, source-aware candidate comparisons and account-fenced explicit decisions/copies.
 * [POS]: Shared Base presentation; a local decision remains pending until its host confirms synchronization.
 */
import { useEffect, useRef, useState } from "react";
import { Button } from "@ai-chat/ui/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@ai-chat/ui/components/ui/dialog";
import { viewConfigHitAreaClass } from "../views/view-config-bar";
import type { BaseSyncIdentity, BaseSyncPresentation, BaseSyncReview, BaseCandidateDetail } from "../../sync/model";
import { useAppTranslation } from "../platform/i18n";
import { CandidateCopy } from "./copy";
type Props = { port: BaseSyncPresentation; identity: BaseSyncIdentity; value: BaseSyncReview | null; failed: boolean };
export function BaseSyncNotice({ port, identity, value, failed }: Props) {
  const { t } = useAppTranslation();
  const [open, setOpen] = useState(false);
  const statusRef = useRef<HTMLParagraphElement>(null);
  if (!value && !failed) return null;
  return <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b px-3 py-2 text-xs">
    <p ref={statusRef} tabIndex={-1} role={failed ? "alert" : "status"}>{failed ? t("bases.sync.failed") : value?.state === "deleted" ? t("bases.sync.deleted") :
      value?.state === "moving" ? t("bases.sync.moving") :
      value?.state === "conflicted" ? t("bases.sync.needsReview") : value?.state === "pending" ? t("bases.sync.pending", { count: value.pending }) : value?.complete === false ? t("bases.sync.discovering") : t("bases.sync.synced")}
      {value?.state !== "deleted" && (value?.paused ? ` · ${t("bases.sync.paused")}` : value && !value.connected ? ` · ${t("bases.sync.offline")}` : "")}</p>
    {value && (value.conflicts > 0 || open) && <Dialog open={open} onOpenChange={setOpen}>
      {value.conflicts > 0 && <DialogTrigger asChild><Button size="sm" variant="outline" className={viewConfigHitAreaClass}>{t("bases.sync.reviewCount", { count: value.conflicts })}</Button></DialogTrigger>}
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden sm:max-w-2xl" onCloseAutoFocus={event => {
        if (!value.conflicts) { event.preventDefault(); statusRef.current?.focus(); }
      }}>
        <DialogHeader><DialogTitle>{t("bases.sync.title")}</DialogTitle><DialogDescription>{t("bases.sync.description")}</DialogDescription></DialogHeader>
        {open && <CandidateReview key={`${port.scopeKey}:${identity.ownerKey}:${identity.baseId}`} port={port} identity={identity} />}
      </DialogContent>
    </Dialog>}
  </div>;
}
function CandidateReview({ port, identity }: Pick<Props, "port" | "identity">) {
  const { t, i18n } = useAppTranslation();
  const [afterId, setAfterId] = useState<string | null>(null), [page, setPage] = useState<BaseSyncReview | null>(null);
  const [selected, setSelected] = useState<string | null>(null), [position, setPosition] = useState<{ operationId: string | null; offset: number }>({ operationId: null, offset: 0 });
  const [detail, setDetail] = useState<BaseCandidateDetail | null>(null);
  const [error, setError] = useState(false), [busy, setBusy] = useState(false), [refresh, setRefresh] = useState(0);
  const [actionFailed, setActionFailed] = useState(false);
  const locked = useRef(false), lifetime = useRef(0);
  const { ownerKey, baseId } = identity;
  useEffect(() => { const generation = ++lifetime.current; return () => { lifetime.current = generation + 1; }; }, []);
  useEffect(() => port.subscribe(() => setRefresh(value => value + 1)), [port]);
  useEffect(() => {
    const controller = new AbortController();
    void port.review({ ownerKey, baseId, afterId }, controller.signal).then(value => {
      if (!controller.signal.aborted) { setPage(value); setError(false); }
    }, () => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [port, ownerKey, baseId, afterId, refresh]);
  const operationId = page?.items.some(item => item.operationId === selected) ? selected : page?.items[0]?.operationId ?? null;
  const offset = position.operationId === operationId ? position.offset : 0;
  const setOffset = (value: number) => setPosition({ operationId, offset: value });
  const candidate = page?.items.find(item => item.operationId === operationId);
  useEffect(() => {
    if (!operationId) return;
    const controller = new AbortController();
    void port.detail({ ownerKey, baseId, operationId, offset }, controller.signal).then(value => {
      if (!controller.signal.aborted) { setDetail(value); setError(false); }
    }, () => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [port, ownerKey, baseId, operationId, offset, refresh]);
  const current = detail?.candidate.operationId === operationId && detail.offset === offset ? detail : null;
  const decide = async (action: "restore" | "discard") => {
    if (!candidate || !current || locked.current || candidate.waiting || page?.state === "moving") return;
    locked.current = true; setBusy(true); setActionFailed(false); const generation = lifetime.current;
    try {
      await port.decide({ ownerKey, baseId, operationId: candidate.operationId, payloadHash: candidate.payloadHash, action });
      if (generation === lifetime.current) { setOffset(0); setRefresh(value => value + 1); }
    } catch { if (generation === lifetime.current) { setActionFailed(true); setRefresh(value => value + 1); } }
    finally { locked.current = false; if (generation === lifetime.current) setBusy(false); }
  };
  return <div className="min-h-0 overflow-y-auto overscroll-contain pb-[env(safe-area-inset-bottom)]">
    {(error || actionFailed) && <p role="alert" className="mb-3 text-destructive">{t("bases.sync.failed")}</p>}
    {!page ? <p role="status">{t("bases.sync.loading")}</p> : !page.items.length ? <p role="status">{t(page.complete === false ? "bases.sync.discovering" : "bases.sync.empty")}</p> : <>
      <div className="mb-4 flex flex-wrap gap-2" aria-label={t("bases.sync.title")}>{page.items.map((item, index) =>
        <Button key={item.operationId} variant={item.operationId === operationId ? "secondary" : "outline"} disabled={busy}
          aria-pressed={item.operationId === operationId} onClick={() => { setSelected(item.operationId); setOffset(0); }}>
          {t("bases.sync.change", { index: index + 1, count: item.fieldCount })}</Button>)}</div>
      {current ? <>
        <p className="mb-3 break-words text-xs text-muted-foreground">{current.candidate.sourceDeviceId ?
          t("bases.sync.sourceDevice", { name: current.candidate.sourceDeviceName ?? t("bases.sync.sourceUnknown") }) : t("bases.sync.thisDevice")}
          {current.candidate.createdAt !== null && <> · <time dateTime={new Date(current.candidate.createdAt).toISOString()}>{new Date(current.candidate.createdAt).toLocaleString(i18n.resolvedLanguage)}</time></>}
          {" · "}{t(`bases.history.actor.${current.candidate.actor === "user" ? "renderer" : current.candidate.actor}`)}</p>
        {current.fields.map(field => <section className="mb-4 rounded-lg border p-3" key={field.index}>
          <h3 className="mb-2 text-sm font-medium">{field.label || t("bases.sync.field")}</h3>
          {field.rowId && <p className="mb-2 break-all text-xs text-muted-foreground">{t("bases.sync.row", { id: field.rowId })}</p>}
          <dl className="grid grid-cols-[minmax(0,1fr)] gap-x-4 gap-y-1 text-sm sm:grid-cols-[8rem_minmax(0,1fr)]">
            <Display label={t("bases.sync.original")} value={field.original} truncatedLabel={t("bases.sync.truncated")} />
            <Display label={t("bases.sync.current")} value={field.current} truncatedLabel={t("bases.sync.truncated")} />
            <Display label={t("bases.sync.proposed")} value={field.proposed} truncatedLabel={t("bases.sync.truncated")} />
          </dl>
        </section>)}
        <div className="mb-4 flex flex-wrap gap-2">
          {offset > 0 && <Button variant="outline" disabled={busy} onClick={() => setOffset(Math.max(0, offset - 20))}>{t("bases.sync.previousFields")}</Button>}
          {current.nextOffset !== null && <Button variant="outline" disabled={busy} onClick={() => setOffset(current.nextOffset!)}>{t("bases.sync.moreFields")}</Button>}
        </div>
        {current.candidate.blocked === "tombstone" && <p className="mb-3 text-sm">{t("bases.sync.removed")}</p>}
        {current.candidate.blocked === "app-structure" && <p className="mb-3 text-sm">{t("bases.sync.appStructure")}</p>}
        <CandidateCopy key={`${port.scopeKey}:${baseId}:${current.candidate.operationId}`} port={port} identity={identity} candidate={current.candidate}
          busy={busy} setBusy={setBusy} refresh={() => setRefresh(value => value + 1)} />
        <div className="mb-4 flex flex-wrap gap-2">
          <Button disabled={busy || !candidate?.canRestore} onClick={() => void decide("restore")}>{candidate?.waiting ? t("bases.sync.awaiting") : t("bases.sync.restore")}</Button>
          <Button variant="outline" disabled={busy || candidate?.waiting || page.state === "moving"} onClick={() => void decide("discard")}>{t("bases.sync.discard")}</Button>
        </div>
      </> : <p role="status">{t("bases.sync.loading")}</p>}
    </>}
    <div className="flex flex-wrap gap-2">
      {afterId && <Button variant="outline" disabled={busy} onClick={() => { setAfterId(null); setSelected(null); setOffset(0); }}>{t("bases.sync.firstPage")}</Button>}
      {page?.cursor && <Button variant="outline" disabled={busy} onClick={() => { setAfterId(page.cursor); setSelected(null); setOffset(0); }}>{t("bases.sync.more")}</Button>}
    </div>
  </div>;
}
function Display({ label, value, truncatedLabel }: { label: string; value: BaseCandidateDetail["fields"][number]["original"]; truncatedLabel: string }) {
  return <><dt className="text-muted-foreground">{label}</dt><dd className="mb-2 min-w-0 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{value.text}{value.truncated && <span className="text-muted-foreground">… ({truncatedLabel})</span>}</dd></>;
}
