/**
 * [INPUT]: Archived system data, the original host, persisted choices and bounded paged source differences.
 * [OUTPUT]: Explicit three-way review with no implicit source deletion or override replacement.
 * [POS]: System update surface; the main process rechecks source digest and revision CAS at save.
 */
import { useState } from "react";
import type { WorkspaceRead } from "@ai-chat/cloud-protocol/artifacts/design/model";
import type { DesignSystem } from "@ai-chat/cloud-protocol/artifacts/design/system/model";
import { useArtifactHost } from "../../context";
import { systemCopy } from "./copy";
import type { DifferencePage, SystemCommand, SystemDraft } from "./model";
export function DesignSystemUpdates({ artifactId, state, system, draft, onDraft, run, busy }: { artifactId: string; state: WorkspaceRead; system: DesignSystem;
  draft: SystemDraft; onDraft(value: SystemDraft): Promise<unknown>; run(input: SystemCommand): Promise<void>; busy: boolean }) {
  const host = useArtifactHost()!, copy = systemCopy(host.locale), [page, setPage] = useState<DifferencePage | null>(null), [loading, setLoading] = useState(false), [error, setError] = useState(false);
  const sourcesText = draft.sourcesText;
  const sources = sourcesText.split("\n").map(value => value.trim()).filter(Boolean);
  const editable = state.enabled && state.editable !== false && state.revision === state.latestRevision && !state.dirty && !draft.request;
  const load = async (cursor = 0, unsyncedCursor = 0) => {
    setLoading(true); setError(false);
    try {
      const value = await host.workspace!({ action: "system-diff", artifactId, generation: state.generation, sources, value: JSON.stringify({ cursor, unsyncedCursor }) }) as DifferencePage;
      const changed = draft.sourceDigest && draft.sourceDigest !== value.sourceDigest;
      await onDraft({ ...draft, sourcesText, sourceDigest: changed ? draft.sourceDigest : value.sourceDigest }); setPage(value);
    } catch { setError(true); } finally { setLoading(false); }
  };
  const mutate = (value: SystemDraft) => { void onDraft(value).catch(() => setError(true)); };
  return <fieldset disabled={busy || loading} className="flex min-w-0 flex-col gap-3 rounded border p-3">
    <legend>{copy.difference}</legend>
    <label>{copy.sources}<textarea aria-label={copy.sources} value={sourcesText} maxLength={4096} className="mt-1 min-h-24 w-full rounded border bg-background p-2" onChange={event => {
      mutate({ ...draft, sourcesText: event.target.value, sourceDigest: undefined, decisions: {} }); setPage(null);
    }} /></label><p className="text-sm text-muted-foreground">{copy.sourcesHelp}</p>
    {!sourcesText && <button type="button" className="relative min-h-[44px] touch-target-44 self-start rounded border px-3" onClick={() => mutate({ ...draft,
      sourcesText: [...new Set(system.sources.files.filter(source => !source.retained).map(source => source.path))].join("\n") })}>{copy.useCapturedSources}</button>}
    <button type="button" disabled={!editable || sources.length === 0 || sources.length > 32} className="relative min-h-[44px] touch-target-44 self-start rounded border px-3" onClick={() => void load()}>{copy.difference}</button>
    {loading && <p role="status">{copy.loading}</p>}
    {page && <>
      {draft.sourceDigest !== page.sourceDigest && <div role="alert"><p>{copy.sourceChanged}</p><button type="button" className="relative min-h-[44px] touch-target-44 rounded border px-3" onClick={() => mutate({ ...draft, sourceDigest: page.sourceDigest, decisions: {} })}>{copy.reviewNewSource}</button></div>}
      {!page.total && <p role="status">{copy.noChanges}</p>}
      {page.total > 0 && <p role="status">{page.cursor + 1}–{Math.min(page.cursor + page.changes.length, page.total)} / {page.total}</p>}
      {page.changes.map(change => <fieldset key={change.key} className="rounded border p-3">
        <legend><code>{change.key}</code> · {copy[change.kind === "removed" ? "removed" : change.kind === "conflict" ? "conflict" : change.kind === "added" ? "added" : "changed"]}</legend>
        <dl className="grid min-w-0 gap-1 text-sm"><dt>{copy.sourceBefore}</dt><dd className="break-words font-mono">{change.base ?? "—"}</dd><dt>{copy.userValue}</dt><dd className="break-words font-mono">{change.current ?? "—"}</dd><dt>{copy.sourceAfter}</dt><dd className="break-words font-mono">{change.incoming ?? "—"}</dd></dl>
        <label>{copy.choose}<select aria-label={`${copy.choose} ${change.key}`} className="ml-2 min-h-[44px] rounded border bg-background" value={draft.decisions[change.key] ?? ""} onChange={event => {
          const decisions = { ...draft.decisions }; if (event.target.value) decisions[change.key] = event.target.value as "keep" | "source" | "delete"; else delete decisions[change.key]; mutate({ ...draft, decisions });
        }}><option value="">{change.requiresDecision ? copy.choose : copy.apply}</option><option value="keep">{copy.keep}</option>{change.incoming !== null ? <option value="source">{copy.apply}</option> : <option value="delete">{copy.delete}</option>}</select></label>
      </fieldset>)}
      <div className="flex flex-wrap gap-2"><button type="button" disabled={page.cursor === 0} className="relative min-h-[44px] touch-target-44 rounded border px-3" onClick={() => void load(Math.max(0, page.cursor - 8), page.unsyncedCursor)}>{copy.previous}</button>
        <button type="button" disabled={page.nextCursor === null} className="relative min-h-[44px] touch-target-44 rounded border px-3" onClick={() => void load(page.nextCursor!, page.unsyncedCursor)}>{copy.page}</button></div>
      {page.unsynced.length > 0 && <div><h4>{copy.notSynced} · {page.unsyncedTotal}</h4><ul className="list-disc pl-5">{page.unsynced.map((item, index) => <li key={index}><code>{item.path}{item.name ? " · " + item.name : ""}</code>: {item.reason}</li>)}</ul>
        <button type="button" disabled={page.nextUnsyncedCursor === null} className="relative min-h-[44px] touch-target-44 rounded border px-3" onClick={() => void load(page.cursor, page.nextUnsyncedCursor!)}>{copy.unsyncedPage}</button></div>}
      <p className="text-sm text-muted-foreground">{copy.allChoices}</p><p className="text-sm text-muted-foreground">{copy.confirmedDelete}</p>
      <button type="button" disabled={!editable || !page.total || !draft.sourceDigest || draft.sourceDigest !== page.sourceDigest} className="relative min-h-[44px] touch-target-44 self-start rounded border px-3" onClick={() => void run({ action: "system-update", artifactId, generation: state.generation,
        requestId: crypto.randomUUID(), expectedRevision: state.revision, readSetDigest: state.readSetDigest, sources, sourceDigest: draft.sourceDigest, decisions: draft.decisions })}>{copy.save}</button>
    </>}
    {error && <p role="alert">{copy.failed}</p>}
  </fieldset>;
}
