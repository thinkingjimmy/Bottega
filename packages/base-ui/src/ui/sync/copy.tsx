/**
 * [INPUT]: Depends on the host's fixed candidate-copy port, original candidate identity and labeled shared controls.
 * [OUTPUT]: Offers explicit copy-as-new with a stable submitted name, local-save feedback and destination navigation.
 * [POS]: Deleted-candidate recovery form; it never presents local completion as a cloud receipt or changes the source object.
 */
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@ai-chat/ui/components/ui/button";
import { Input } from "@ai-chat/ui/components/ui/input";
import { useAppTranslation } from "../platform/i18n";
import type { BaseCandidateSummary, BaseSyncIdentity, BaseSyncPresentation } from "../../sync/model";
export function CandidateCopy({ port, identity, candidate, busy, setBusy, refresh }: {
  port: BaseSyncPresentation; identity: BaseSyncIdentity; candidate: BaseCandidateSummary; busy: boolean; setBusy(value: boolean): void; refresh(): void;
}) {
  const { t } = useAppTranslation(), inputId = useId(), helpId = useId();
  const [name, setName] = useState(() => (candidate.copyRequested ? candidate.copyName ?? "" : t("bases.sync.copyName", { name: candidate.copyName ?? "" })).slice(0, 100));
  const [submitted, setSubmitted] = useState(candidate.copyRequested ?? false), [failed, setFailed] = useState(false);
  const [destination, setDestination] = useState<BaseSyncIdentity | undefined>(candidate.copiedTo);
  const locked = useRef(false), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const copy = async () => {
    if (locked.current || busy || !port.copy || !name.trim()) return;
    locked.current = true; setBusy(true); setSubmitted(true); setFailed(false);
    try {
      const result = await port.copy({ ...identity, operationId: candidate.operationId, payloadHash: candidate.payloadHash, name: name.trim() });
      if (mounted.current) setDestination(result);
    } catch { if (mounted.current) setFailed(true); }
    finally { locked.current = false; if (mounted.current) { setBusy(false); refresh(); } }
  };
  const target = destination ?? candidate.copiedTo;
  if (target) return <div className="mb-4 space-y-2"><p role="status" className="text-sm">{t("bases.sync.copied")}</p>
    {port.openCopy && <Button variant="outline" className="min-h-11" disabled={busy} onClick={() => port.openCopy!(target)}>{t("bases.sync.openCopy")}</Button>}</div>;
  if (!port.copy || !candidate.canCopy) return null;
  return <form className="mb-4 space-y-2 rounded-lg border p-3" onSubmit={event => { event.preventDefault(); void copy(); }}>
    <p id={helpId} className="text-sm text-muted-foreground">{t("bases.sync.copyDescription")}</p>
    <label htmlFor={inputId} className="block text-sm font-medium">{t("bases.sync.copyLabel")}</label>
    <Input id={inputId} value={name} onChange={event => setName(event.target.value)} maxLength={100} required disabled={busy || submitted}
      autoComplete="off" className="text-base md:text-base" aria-describedby={helpId} />
    {failed && <p role="alert" className="text-sm text-destructive">{t("bases.sync.copyFailed")}</p>}
    <Button type="submit" className="min-h-11" disabled={busy || !name.trim()}>{busy ? t("bases.sync.copying") : t("bases.sync.copy")}</Button>
  </form>;
}
