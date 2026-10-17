/**
 * [INPUT]: Main-issued fixed version, archived system payload and the existing durable host checkpoint; catalog-owned labels use the shared formatCopy formatter.
 * [OUTPUT]: Exact tokens/themes/provenance, persisted overrides, fixed bindings and explicit source-conflict resolution.
 * [POS]: Lazy Artifact design-system view; ordinary files never import it.
 */
import { useState } from "react";
import { formatCopy } from "@ai-chat/ui/lib/workbench-copy/format";
import type { WorkspaceRead } from "@ai-chat/cloud-protocol/artifacts/design/model";
import { inspectDesignSystem } from "@ai-chat/cloud-protocol/artifacts/design/system/validation";
import { validTokenValue, resolvedSystemValue } from "@ai-chat/cloud-protocol/artifacts/design/system/tokens";
import { useArtifactHost } from "../../context";
import { systemCopy } from "./copy";
import { emptySystemDraft, type SystemCommand, type SystemDraft } from "./model";
import { DesignSystemUpdates } from "./updates";
import { workspaceCopy } from "../copy";
import { SystemBindingPicker } from "./binding";
export type { SystemDraft } from "./model";
type Props = { artifactId: string; state: WorkspaceRead; draft?: SystemDraft; onDraft(value: SystemDraft): Promise<unknown>; onCommitted(id: string): void; onConflict?(): Promise<unknown> };
type Receipt = { status: "committed" | "pending" | "conflict"; artifactRef?: { artifactId: string }; artifactId?: string; sourceConflict?: SystemDraft["sourceConflict"]; recovery?: { status: string } };
export function DesignSystemView(props: Props) {
  return props.state.manifest.format === "bottega-design-system" ? <SystemViewer {...props} /> : <SystemBinding {...props} />;
}
function useSystemCommands(props: Props) {
  const host = useArtifactHost()!, copy = systemCopy(host.locale), conflictCopy = workspaceCopy(host.locale), draft = props.draft ?? emptySystemDraft();
  const [busy, setBusy] = useState(false), [error, setError] = useState(false);
  const settle = async (receipt: Receipt, working: SystemDraft) => {
    if (receipt.status === "pending") return;
    if (receipt.status === "conflict") { await props.onDraft({ ...working, request: receipt.sourceConflict?.needsResolution ? working.request : undefined, sourceConflict: receipt.sourceConflict }); await props.onConflict?.(); return; }
    const id = receipt.artifactRef?.artifactId ?? receipt.artifactId; if (!id) throw new Error("Saved system version is unavailable");
    await props.onDraft({ ...working, request: undefined, sourceConflict: undefined }); props.onCommitted(id);
  };
  const run = async (request: SystemCommand) => {
    setBusy(true); setError(false); const working = { ...draft, request, sourceConflict: undefined };
    let submitted = false;
    try { await props.onDraft(working); submitted = true; const result = await host.workspace!(request) as Receipt; await settle(result, working); }
    catch (cause) {
      if (!submitted || cause instanceof Error && ((cause as { noAdmission?: boolean }).noAdmission || /REVISION_CONFLICT|SOURCE_CHANGED|PATH_DENIED|INVALID_DOCUMENT|BUDGET_EXCEEDED|ARTIFACT_DISABLED|GENERATION_EXPIRED|artifact-conflict|artifact-disabled|artifact-generation-expired|artifact-invalid|artifact-budget|artifact-path|Invalid input|Choose how to resolve|Update decisions do not match/.test(cause.message))) await props.onDraft({ ...working, request: undefined }).catch(() => {});
      setError(true);
    } finally { setBusy(false); }
  };
  const resume = async () => {
    if (!draft.request) return; setBusy(true); setError(false);
    try {
      const result = await host.workspace!({ action: "operation-status", artifactId: draft.request.artifactId, requestId: draft.request.requestId }) as Receipt;
      if (result.status === "pending" && result.recovery?.status === "paused") await settle(await host.workspace!({ action: "resume-edit", artifactId: draft.request.artifactId, requestId: draft.request.requestId, generation: props.state.generation }) as Receipt, draft);
      else await settle(result, draft);
    } catch { setError(true); } finally { setBusy(false); }
  };
  const mutate = (value: SystemDraft) => { void props.onDraft(value).catch(() => setError(true)); };
  const editable = props.state.enabled && props.state.editable !== false && props.state.revision === props.state.latestRevision && !props.state.dirty && !draft.request;
  const feedback = <>{!editable && !draft.sourceConflict && <p role="status">{draft.request ? copy.pending : props.state.enabled ? copy.readonly : copy.off}</p>}
    {draft.sourceConflict && <div role="alert"><p>{draft.sourceConflict.needsResolution ? conflictCopy.partialSourceChanged : conflictCopy.sourceChanged}</p>
      {draft.sourceConflict.needsResolution && <button type="button" disabled={busy || !props.state.enabled || !draft.request} className="relative min-h-[44px] touch-target-44 self-start rounded border px-3" onClick={() => {
        if (!draft.request) return; setBusy(true); setError(false);
        void host.workspace!({ action: "resolve-edit", artifactId: draft.request.artifactId, requestId: draft.request.requestId, generation: props.state.generation }).then(value => settle(value as Receipt, draft)).catch(() => setError(true)).finally(() => setBusy(false));
      }}>{conflictCopy.keepCurrentSource}</button>}</div>}
    {draft.request && !draft.sourceConflict && <button type="button" disabled={busy} className="relative min-h-[44px] touch-target-44 self-start rounded border px-3" onClick={() => void resume()}>{copy.original}</button>}{error && <p role="alert">{copy.failed}</p>}</>;
  return { host, copy, draft, busy, editable, run, mutate, feedback, fail: () => setError(true) };
}
function SystemViewer(props: Props) {
  const { host, copy, draft, busy, editable, run, mutate, feedback, fail } = useSystemCommands(props), result = inspectDesignSystem(props.state.system);
  const [theme, setTheme] = useState(result.system?.tokens.themes[0]?.id ?? "light"), [cursor, setCursor] = useState(0);
  const system = result.system;
  if (!system || result.issues.length) return <p role="alert">{copy.invalid}</p>;
  const firstTheme = system.tokens.themes[0]!.id;
  const tokenNames = [...new Set([...system.tokens.tokens.map(token => token.name), ...system.aliases.aliases.map(alias => alias.name)])];
  const currentTheme = system.tokens.themes.some(value => value.id === draft.theme) ? draft.theme : firstTheme;
  return <section data-design-system={props.state.documentId} className="flex min-w-0 flex-col gap-3 rounded border p-3">
    <h3 className="font-semibold">{props.state.title} · {formatCopy(workspaceCopy(host.locale).revisionTag, { revision: props.state.revision })}</h3>
    <label>{copy.themes}<select aria-label={copy.themes} className="ml-2 min-h-[44px] rounded border bg-background" value={theme} onChange={event => setTheme(event.target.value)}>{system.tokens.themes.map(value => <option key={value.id} value={value.id}>{value.name}</option>)}</select></label>
    <div className="overflow-x-auto"><table className="w-full text-left text-sm"><caption className="py-2 text-left font-semibold">{copy.tokens} · {system.tokens.tokens.length}</caption><thead><tr><th className="p-2">{copy.token}</th><th className="p-2">{copy.exact}</th><th className="p-2">{copy.usage}</th><th className="p-2">{copy.sourceVersion}</th></tr></thead><tbody>
      {system.tokens.tokens.slice(cursor, cursor + 40).map(token => {
        const alias = system.aliases.aliases.find(alias => alias.name === token.name && alias.theme === theme) ??
          (token.values[theme] === undefined ? system.aliases.aliases.find(alias => alias.name === token.name && alias.theme === firstTheme) : undefined);
        const value = alias ? `{${alias.target}}` : token.values[theme] ?? token.values[firstTheme] ?? "—", origin = alias ?? token.origins[theme] ?? token.origins[firstTheme], source = system.sources.files.find(source => source.id === origin?.sourceId);
        const color = token.kind === "color" ? resolvedSystemValue(system, token.name, theme) : null;
        return <tr key={token.name} className="border-t"><td className="p-2"><code>{token.name}</code>{token.override && <p>{copy.overrides}</p>}</td><td className="p-2">{color && validTokenValue("color", color) && <span aria-hidden="true" className="mr-2 inline-block h-6 w-8 border align-middle" style={{ backgroundColor: color }} />}<code className="break-words">{value}</code>{!alias && !validTokenValue(token.kind, value) && <p>{copy.unsupported}</p>}</td><td className="max-w-sm p-2">{alias?.usage ?? token.usage}</td><td className="max-w-xs break-words p-2"><code>{source?.path} · {origin?.sourceKey}</code><p>{source?.version.kind === "git" ? source.version.commit : source?.digest}</p>{source?.version.kind === "git" && source.version.workingTree && <p>{copy.workingTree}</p>}</td></tr>;
      })}</tbody></table></div>
    <div className="flex gap-2"><button type="button" disabled={!cursor} className="relative min-h-[44px] touch-target-44 rounded border px-3" onClick={() => setCursor(Math.max(0, cursor - 40))}>{copy.previous}</button><button type="button" disabled={cursor + 40 >= system.tokens.tokens.length} className="relative min-h-[44px] touch-target-44 rounded border px-3" onClick={() => setCursor(cursor + 40)}>{copy.next}</button></div>
    {system.aliases.aliases.length > 0 && <details><summary className="cursor-pointer py-3">{copy.aliases} · {system.aliases.aliases.length}</summary><ul className="list-disc pl-5">{system.aliases.aliases.map(alias => <li key={alias.name + alias.theme}><code>{alias.theme}: {alias.name} → {alias.target}</code> · {alias.usage}</li>)}</ul></details>}
    <fieldset disabled={busy || Boolean(draft.request)} className="flex flex-wrap items-end gap-2 rounded border p-3"><legend>{copy.overrides}</legend>
      <label>{copy.token}<select aria-label={copy.token} className="ml-2 min-h-[44px] rounded border bg-background" value={draft.token} onChange={event => { mutate({ ...draft, token: event.target.value, theme: currentTheme, value: resolvedSystemValue(system, event.target.value, currentTheme) ?? "" }); }}><option value="">—</option>{tokenNames.map(name => <option key={name} value={name}>{name}</option>)}</select></label>
      <label>{copy.themes}<select aria-label={`${copy.themes} ${copy.overrides}`} className="ml-2 min-h-[44px] rounded border bg-background" value={currentTheme} onChange={event => mutate({ ...draft, theme: event.target.value, value: resolvedSystemValue(system, draft.token, event.target.value) ?? "" })}>{system.tokens.themes.map(value => <option key={value.id} value={value.id}>{value.name}</option>)}</select></label>
      <label className="flex-1">{copy.value}<input aria-label={copy.value} value={draft.value} maxLength={1000} className="ml-2 min-h-[44px] w-full rounded border bg-background p-2" onChange={event => mutate({ ...draft, value: event.target.value })} /></label>
      <button type="button" disabled={!editable || !tokenNames.includes(draft.token) || !draft.value} className="relative min-h-[44px] touch-target-44 rounded border px-3" onClick={() => void run({ action: "system-update", artifactId: props.artifactId, generation: props.state.generation, requestId: crypto.randomUUID(), expectedRevision: props.state.revision, readSetDigest: props.state.readSetDigest,
        value: JSON.stringify({ token: draft.token, theme: currentTheme, value: draft.value }) })}>{copy.saveValue}</button>
    </fieldset>
    {system.tokens.fonts.length > 0 && <details><summary className="cursor-pointer py-3">{copy.fonts} · {system.tokens.fonts.length}</summary><ul className="list-disc pl-5">{system.tokens.fonts.map((font, index) => <li key={index}><strong>{font.family}</strong> · {font.weight} · {font.style}<p className="break-words"><code>{font.file} · {font.sourceKey}</code></p></li>)}</ul></details>}
    <details><summary className="cursor-pointer py-3">{copy.components} · {system.components.components.length}</summary>
      <label>{copy.props}<textarea aria-label={copy.props} maxLength={4096} value={draft.propsText ?? "{}"} disabled={busy || Boolean(draft.request)} className="min-h-20 w-full rounded border bg-background p-2 font-mono" onChange={event => mutate({ ...draft, propsText: event.target.value })} /></label>
      <ul className="flex flex-col gap-3">{system.components.components.map(component => <li key={component.name} className="rounded border p-3"><p><strong>{component.name}</strong> · {component.mode === "mounted" ? copy.mounted : copy.static}</p><p className="break-words text-sm">{component.entry} · {component.sourceDigest}</p><p className="text-sm">{component.reason}</p>
        {component.mode === "mounted" && <p className="text-sm">{copy.receipts} · {component.evidence?.runtime} · {component.evidence?.compiler}</p>}
        <button type="button" disabled={!editable || busy} className="relative min-h-[44px] touch-target-44 rounded border px-3" onClick={() => { try { const properties = JSON.parse(draft.propsText ?? "{}"); void run({ action: "system-compile", artifactId: props.artifactId, generation: props.state.generation, requestId: crypto.randomUUID(), expectedRevision: props.state.revision,
          readSetDigest: props.state.readSetDigest, entry: component.entry, value: JSON.stringify({ component: component.name, props: properties }) }); } catch { fail(); } }}>{copy.compile}</button></li>)}</ul>
    </details>
    <DesignSystemUpdates artifactId={props.artifactId} state={props.state} system={system} draft={draft} onDraft={props.onDraft} run={run} busy={busy} />
    <details><summary className="cursor-pointer py-3">{copy.sources} · {system.sources.files.length}</summary><ul className="list-disc pl-5">{system.sources.files.map(source => <li key={source.id} className="break-words"><code>{source.path} · {source.digest}</code><p>{source.version.kind === "git" ? source.version.commit : copy.digestVersion}{source.version.kind === "git" && source.version.workingTree ? " · " + copy.workingTree : ""}</p></li>)}</ul></details>
    <details><summary className="cursor-pointer py-3">{copy.notSynced} · {system.sources.unsynced.length}</summary><ul className="list-disc pl-5">{system.sources.unsynced.map((value, index) => <li key={index}><code>{value.path}{value.name ? " · " + value.name : ""}</code>: {value.reason}</li>)}</ul></details>
    {feedback}
  </section>;
}
function SystemBinding(props: Props) {
  const { draft, busy, editable, run, mutate, feedback } = useSystemCommands(props);
  return <SystemBindingPicker artifactId={props.artifactId} state={props.state} draft={draft} busy={busy} editable={editable} run={run} mutate={mutate} feedback={feedback} />;
}
