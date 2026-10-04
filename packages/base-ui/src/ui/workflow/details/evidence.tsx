/**
 * [INPUT]: Run evidence summaries, the host's bounded evidence page reader and shared controls.
 * [OUTPUT]: WorkflowEvidence with counts, a shared diff/body viewer and explicit truncation.
 * [POS]: Same evidence presentation on the computer and remote run details; plaintext lives only while the view is open.
 */
import { useEffect, useRef, useState } from "react";
import { Button } from "@ai-chat/ui/components/ui/button";
import { useAppTranslation } from "../../platform/i18n";
import { stepReport, type EvidenceSummary, type WorkflowRunPort, type WorkflowRunView, type RunHostFacts } from "../run-port";
import { detailCopy } from "./copy";

function summary(run: WorkflowRunView, stepId: string): EvidenceSummary | null {
  const report = stepReport(run, stepId);
  if (report?.evidence) return report.evidence;
  const output = run.steps.find(step => step.stepId === stepId)?.output as { evidence?: { code?: { commit?: string; changedCount?: number; diff?: { state?: string } }; commands?: unknown[] } } | null;
  const evidence = output?.evidence;
  return evidence ? { commit: evidence.code?.commit ?? null, changedCount: evidence.code?.changedCount ?? 0,
    diffState: evidence.code?.diff?.state ?? null, commandsRecorded: evidence.commands?.length ?? null } : null;
}
type Props = { run: WorkflowRunView; stepId: string; port: WorkflowRunPort; facts: RunHostFacts };
export function WorkflowEvidence(props: Props) {
  const { run, stepId, facts } = props;
  return <EvidenceView key={`${run.runId}:${run.revision}:${stepId}:${facts.offline}:${facts.remoteCompatible}`} {...props} />;
}
function EvidenceView({ run, stepId, port, facts }: Props) {
  const { i18n } = useAppTranslation(), copy = detailCopy(i18n.language), value = summary(run, stepId);
  const [kind, setKind] = useState<"diff" | "report" | null>(null), [text, setText] = useState("");
  const [busy, setBusy] = useState(false), [failed, setFailed] = useState(false), [truncated, setTruncated] = useState(false);
  const report = stepReport(run, stepId);
  const reader = useRef(port.evidence);
  useEffect(() => { reader.current = port.evidence; }, [port.evidence]);
  const unavailable = Boolean(facts.remote && (facts.offline || facts.remoteCompatible === false));
  useEffect(() => {
    let live = true;
    if (unavailable) return;
    const read = reader.current;
    if (kind && read) void (async () => {
      let offset = 0, digest: string | null = null, total: number | null = null, joined = new Uint8Array(0), partial = false;
      try {
      for (let pageNumber = 0; pageNumber < 16; pageNumber++) {
        const page = await read(run.runId, stepId, kind, offset);
        if (!live) return;
        if (page.offset !== offset || page.kind !== kind || digest && digest !== page.digest || total !== null && total !== page.totalBytes) throw new Error("evidence-changed");
        digest = page.digest; total = page.totalBytes; partial ||= page.truncated;
        const chunk = Uint8Array.from(atob(page.chunk.replace(/-/g, "+").replace(/_/g, "/")), char => char.charCodeAt(0));
        if (chunk.length > 4096 || joined.length + chunk.length > 65_536) throw new Error("evidence-limit");
        const next = new Uint8Array(joined.length + chunk.length); next.set(joined); next.set(chunk, joined.length); joined.fill(0); chunk.fill(0); joined = next;
        if (page.nextOffset === null) {
          const actual = [...new Uint8Array(await crypto.subtle.digest("SHA-256", joined))].map(byte => byte.toString(16).padStart(2, "0")).join("");
          if (actual !== digest) throw new Error("evidence-integrity");
          if (live) { setText(new TextDecoder("utf-8", { fatal: true }).decode(joined)); setTruncated(partial); setBusy(false); }
          return;
        }
        if (page.nextOffset !== offset + chunk.length || !chunk.length) throw new Error("evidence-page");
        offset = page.nextOffset;
      }
      throw new Error("evidence-limit");
      } finally { joined.fill(0); }
    })().catch(() => { if (live) { setFailed(true); setBusy(false); } });
    return () => { live = false; };
  }, [run.runId, run.revision, stepId, kind, unavailable]);
  const show = (next: typeof kind) => { setText(""); setFailed(false); setTruncated(false); setBusy(!!next); setKind(next); };
  return <div className="min-w-0 space-y-2 text-xs" data-workflow-evidence>
    {value && <p className="flex flex-wrap gap-x-3 text-muted-foreground"><span>{copy.files.replace("{count}", String(value.changedCount))}</span>
      {value.commandsRecorded !== null && <span>{copy.commands.replace("{count}", String(value.commandsRecorded))}</span>}</p>}
    {port.evidence && <div className="flex flex-wrap gap-2">
      {value && ["included", "partial"].includes(value.diffState ?? "") && <Button variant="outline" size="sm" className="min-h-11" disabled={unavailable} onClick={() => show("diff")}>{copy.diff}</Button>}
      {report && <Button variant="ghost" size="sm" className="min-h-11" disabled={unavailable} onClick={() => show("report")}>{copy.report}</Button>}
      {kind && <Button variant="ghost" size="sm" className="min-h-11" onClick={() => show(null)}>{copy.close}</Button>}
    </div>}
    {value && ["too-large", "partial"].includes(value.diffState ?? "") && <p>{copy.truncated}</p>}
    {unavailable && <p role="status">{(facts.offline ? copy.offline : copy.upgrade).replace("{computer}", facts.computer)}</p>}
    {busy && <p role="status">{copy.loading}</p>}{failed && <p role="alert">{copy.failed}</p>}
    {kind && text && <pre tabIndex={0} aria-label={kind === "diff" ? copy.diff : copy.report} className="max-h-[60dvh] max-w-full overflow-auto rounded-md border bg-muted/30 p-3 text-[11px] leading-5"><code>{text}</code></pre>}
    {truncated && <p role="status">{copy.truncated}</p>}
  </div>;
}
