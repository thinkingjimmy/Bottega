/**
 * [INPUT]: Depends on the shared dialog/button/input/select primitives, the Agent-configuration payload schema and timing,
 *          AvailableInSelect, catalog-backed model/reasoning controls, Memory access selection and plugin status/link, provider identity, the Provider catalog snapshot (each field's timing is the chosen Provider's own, O3), the permission-mode catalog and workbench-copy.
 * [OUTPUT]: Provides AgentConfigDialog — New config (with Start from presets) and Edit config in one form, including catalog-selected model/reasoning values, a Memory access selection and plugin status/link, the requested workspace and network guarantees and explicit library Skill and scoped MCP selections, with Base and linked-Chat scope and local availability; draftOf, presetDraft and payloadOf are its pure builders.
 * [POS]: The editor of settings/agent-configs; it builds a payload and hands it to the page, which owns the source.
 */
import { useId, useState, type ReactNode } from "react";
import {
  appliesAtFor, parseAgentConfigPayload, type AgentConfigField, type AgentConfigPayload, type AgentConfigToolsScope,
} from "@ai-chat/cloud-protocol/agent-config/payload";
import { AppDialogBody, AppDialogContent } from "@ai-chat/ui/components/ui/app-dialog";
import { Button } from "@ai-chat/ui/components/ui/button";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@ai-chat/ui/components/ui/dialog";
import { Input } from "@ai-chat/ui/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@ai-chat/ui/components/ui/select";
import { Textarea } from "@ai-chat/ui/components/ui/textarea";
import { formatWorkbench, type WorkbenchCopy } from "@ai-chat/ui/lib/workbench-copy";
import { cn } from "@ai-chat/ui/lib/utils";
import { useAppTranslation } from "@/components/providers/preferences/i18n-provider";
import { AgentBackendIcon, backendLabel } from "@/lib/agent/agent-backends";
import { useProviderCatalog } from "@/lib/provider-catalog/hooks";
import { ConfigModelFields } from "./models/fields";
import { ConfigResourceSelectors } from "./resources/selectors";
import { ConfigMemoryStatus } from "./resources/memory-status";
import { AvailableInSelect, type ProjectOption } from "./available-in";

type Permission = "inherit" | "ask-for-approval" | "approve-for-me" | "full-access";
type Preset = "blank" | "planner" | "developer" | "reviewer";
type Draft = { name: string; purpose: string; provider: string; model: AgentConfigPayload["model"]; reasoningEffort: AgentConfigPayload["reasoningEffort"]; instructions: string;
  /** Set once the person edits the instructions (or picks a preset), so an emptied field means cleared, not untouched. */
  instructionsTouched?: boolean; permission: Permission; memory: "none" | "readonly";
  /** Explicit resource ids remain intact when another computer lacks their local inventory. */
  skillIds: string[]; mcpIds: string[];
  base: AgentConfigToolsScope["base"];
  availableIn: AgentConfigPayload["availableIn"]; guarantees: AgentConfigPayload["guarantees"] };
const OPEN_GUARANTEES: AgentConfigPayload["guarantees"] = { workspace: "write", network: "on" };

const PRESET_PERMISSION: Record<Exclude<Preset, "blank">, Permission> = { planner: "ask-for-approval", developer: "approve-for-me", reviewer: "ask-for-approval" };

/* A blank config takes the Developer scope; editing preserves explicit local resource identities. */
export function draftOf(payload: AgentConfigPayload | undefined): Draft {
  if (!payload) return { name: "", purpose: "", provider: "", model: { mode: "inherit" }, reasoningEffort: { mode: "inherit" }, instructions: "", permission: "inherit", memory: "none", base: "read-write", skillIds: [], mcpIds: [], availableIn: "all", guarantees: OPEN_GUARANTEES };
  const tools = payload.tools.mode === "explicit" && !Array.isArray(payload.tools.value) ? payload.tools.value : null;
  return {
    name: payload.name, purpose: payload.purpose, provider: payload.provider,
    model: payload.model, reasoningEffort: payload.reasoningEffort,
    instructions: payload.instructions.mode === "explicit" ? payload.instructions.value : "",
    permission: payload.permissionMode.mode === "explicit" ? payload.permissionMode.value : "inherit",
    memory: payload.memory.mode === "explicit" && payload.memory.value.read ? "readonly" : "none",
    base: tools?.base ?? (payload.guarantees.workspace === "read-only" ? "read" : "read-write"),
    skillIds: payload.skills.mode === "explicit" && Array.isArray(payload.skills.value) ? payload.skills.value.map(item => item.skillId) : [],
    mcpIds: tools?.mcpServers?.map(item => item.serverId) ?? [],
    availableIn: payload.availableIn, guarantees: payload.guarantees,
  };
}

/** What a preset fills: its name, instructions, permission, guarantees and template scope. */
export function presetDraft(preset: Exclude<Preset, "blank">, instructions: string): Partial<Draft> {
  // Planning and review ask for a read-only workspace; whether this computer can enforce it shows on the list.
  const developer = preset === "developer";
  return { instructions, instructionsTouched: true, permission: PRESET_PERMISSION[preset], base: developer ? "read-write" : "read",
    guarantees: { ...OPEN_GUARANTEES, workspace: developer ? "write" : "read-only" } };
}

/* Hidden resource slots keep their stored values; Memory explicitly selects no access or read only, never write access. Model fields retain all three contract states,
   including unavailable explicit values. Only deliberate choices change them. Cleared instructions inherit;
   untouched instructions keep their stored value. */
export function payloadOf(draft: Draft, base: AgentConfigPayload | undefined): AgentConfigPayload {
  const inherit = { mode: "inherit" } as const;
  return parseAgentConfigPayload({
    schemaVersion: 1, name: draft.name.trim(), purpose: draft.purpose.trim(), provider: draft.provider,
    instructions: draft.instructions.trim() ? { mode: "explicit", value: draft.instructions }
      : draft.instructionsTouched ? inherit : base?.instructions ?? inherit,
    model: draft.model, reasoningEffort: draft.reasoningEffort,
    permissionMode: draft.permission === "inherit" ? inherit : { mode: "explicit", value: draft.permission },
    skills: { mode: "explicit", value: draft.skillIds.map(skillId => ({ skillId })) },
    tools: { mode: "explicit", value: { base: draft.base, chats: "linked", mcpServers: draft.mcpIds.map(serverId => ({ serverId })) } },
    ...(base?.workflowTemplate ? { workflowTemplate: base.workflowTemplate } : {}),
    memory: { mode: "explicit", value: { read: draft.memory === "readonly", write: false } },
    resourceSlots: base?.resourceSlots ?? [], availableIn: draft.availableIn,
    guarantees: draft.guarantees,
  });
}

function Field({ id, label, hint, timing, children }: { id: string; label: string; hint?: string; timing?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <label className="font-medium text-sm" htmlFor={id}>{label}</label>
        {timing ? <span className="text-muted-foreground text-xs">{timing}</span> : null}
      </div>
      {children}
      {hint ? <span className="text-muted-foreground text-xs">{hint}</span> : null}
    </div>
  );
}

export function AgentConfigDialog({ open, editing, providers, projects, workbench, onOpenChange, onSave }: {
  open: boolean;
  /** Absent for New config. */
  editing?: { configId: string; payload: AgentConfigPayload };
  providers: readonly string[];
  projects: readonly ProjectOption[];
  workbench: WorkbenchCopy;
  onOpenChange(open: boolean): void;
  onSave(payload: AgentConfigPayload, configId?: string): Promise<void>;
}) {
  const { t } = useAppTranslation();
  const copy = workbench.agentConfigs;
  const ids = useId();
  const [draft, setDraft] = useState(() => draftOf(editing?.payload));
  const [preset, setPreset] = useState<Preset>("blank");
  const [busy, setBusy] = useState(false), [failed, setFailed] = useState(false);
  const set = (patch: Partial<Draft>) => { setDraft(current => ({ ...current, ...patch })); setFailed(false); };
  const catalog = useProviderCatalog();
  const timing = (field: AgentConfigField) => {
    /* The chosen Provider's descriptor decides when a field takes effect (O3); no Provider chosen yet reads the fixed timings. */
    const at = appliesAtFor(field, catalog.entries.find(entry => entry.id === draft.provider) ?? null);
    return at === "next-turn" ? copy.appliesNextTurn : at === "process-start" ? copy.restartsAgent : copy.appliesOnNew;
  };
  const choosePreset = (next: Preset) => {
    setPreset(next);
    if (next === "blank") return set({ name: "", instructions: "", instructionsTouched: true, permission: "inherit", memory: "none", base: "read-write", guarantees: OPEN_GUARANTEES });
    set({ name: copy[next], ...presetDraft(next, { planner: copy.presetPlanner, developer: copy.presetDeveloper, reviewer: copy.presetReviewer }[next]) });
  };
  const readOnly = draft.guarantees.workspace === "read-only" || editing?.payload.workflowTemplate === "plan" || editing?.payload.workflowTemplate === "review";
  let payload: AgentConfigPayload | null = null;
  try { payload = draft.name.trim() && draft.provider && !(readOnly && draft.mcpIds.length) ? payloadOf(draft, editing?.payload) : null; } catch { payload = null; }
  const save = async () => {
    if (!payload || busy) return;
    setBusy(true);
    try { await onSave(payload, editing?.configId); onOpenChange(false); }
    catch { setFailed(true); }
    finally { setBusy(false); }
  };
  const presets: Preset[] = ["blank", "planner", "developer", "reviewer"];
  const permissionLabels = {
    "ask-for-approval": t("permission.mode.ask-for-approval.label"),
    "approve-for-me": t("permission.mode.approve-for-me.label"),
    "full-access": t("permission.mode.full-access.label"),
  };
  return (
    <Dialog open={open} onOpenChange={next => { if (!busy) onOpenChange(next); }}>
      <AppDialogContent className="sm:max-w-xl" aria-busy={busy || undefined} onEscapeKeyDown={event => { if (busy) event.preventDefault(); }}>
        <DialogHeader className="shrink-0 gap-1 text-left">
          <DialogTitle>{editing ? copy.editTitle : copy.newTitle}</DialogTitle>
          <DialogDescription>{preset !== "blank" ? formatWorkbench(copy.prefilled, { role: copy[preset] }) : copy.appliesToNewRuns}</DialogDescription>
        </DialogHeader>
        <AppDialogBody className="mt-4">
          <form className="flex flex-col gap-4" onSubmit={event => { event.preventDefault(); void save(); }}>
            {!editing && (
              <fieldset className="flex flex-col gap-1.5">
                <legend className="mb-1.5 font-medium text-sm">{copy.startFrom}</legend>
                <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={copy.startFrom}>
                  {presets.map(item => (
                    <Button key={item} type="button" size="sm" role="radio" aria-checked={preset === item}
                      variant={preset === item ? "secondary" : "outline"} className="pointer-coarse:h-11"
                      onClick={() => choosePreset(item)}>{item === "blank" ? copy.blank : copy[item]}</Button>
                  ))}
                </div>
              </fieldset>
            )}
            <Field id={`${ids}-name`} label={copy.name}>
              <Input id={`${ids}-name`} value={draft.name} maxLength={120} autoComplete="off" onChange={event => set({ name: event.target.value })} />
            </Field>
            <Field id={`${ids}-available`} label={copy.availableIn}>
              <AvailableInSelect id={`${ids}-available`} value={draft.availableIn} projects={projects} workbench={workbench}
                onChange={availableIn => set({ availableIn })} />
            </Field>
            <Field id={`${ids}-provider`} label={copy.provider} timing={copy.restartsAgent}>
              <Select value={draft.provider || undefined} onValueChange={provider => { if (provider !== draft.provider) set({ provider, model: { mode: "inherit" }, reasoningEffort: { mode: "inherit" } }); }}>
                <SelectTrigger id={`${ids}-provider`} className="w-full pointer-coarse:h-11"><SelectValue placeholder={copy.chooseProvider} /></SelectTrigger>
                <SelectContent>
                  {providers.map(provider => (
                    <SelectItem key={provider} value={provider}>
                      <AgentBackendIcon backend={provider} className="size-4" />{backendLabel(provider)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <ConfigModelFields id={ids} provider={draft.provider} value={draft} copy={copy} disabled={busy}
              modelTiming={timing("model")} effortTiming={timing("reasoningEffort")} onChange={set} />
            <Field id={`${ids}-instructions`} label={copy.instructions} hint={copy.instructionsHint} timing={timing("instructions")}>
              <Textarea id={`${ids}-instructions`} value={draft.instructions} rows={4} maxLength={8_000}
                onChange={event => set({ instructions: event.target.value, instructionsTouched: true })} />
            </Field>
            <Field id={`${ids}-purpose`} label={copy.purpose} hint={copy.purposeHint}>
              <Input id={`${ids}-purpose`} value={draft.purpose} maxLength={600} autoComplete="off" onChange={event => set({ purpose: event.target.value })} />
            </Field>
            <Field id={`${ids}-permission`} label={copy.permissions} timing={timing("permissionMode")}>
              <Select value={draft.permission} onValueChange={permission => set({ permission: permission as Permission })}>
                <SelectTrigger id={`${ids}-permission`} className="w-full pointer-coarse:h-11"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="inherit">{copy.providerDefault}</SelectItem>
                  {Object.entries(permissionLabels).map(([mode, label]) => <SelectItem key={mode} value={mode}>{label}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <ConfigMemoryStatus workbench={workbench} value={draft.memory} timing={timing("memory")} onChange={memory => set({ memory })} onOpenSettings={() => onOpenChange(false)} />
            <ConfigResourceSelectors value={draft} readOnly={readOnly} projects={projects} provider={draft.provider} copy={copy} onChange={set} />
            <div className="grid grid-cols-2 gap-3">
              <Field id={`${ids}-workspace`} label={copy.workspace}>
                <Select value={draft.guarantees.workspace} onValueChange={workspace => set({ guarantees: { ...draft.guarantees, workspace: workspace as "write" | "read-only" } })}>
                  <SelectTrigger id={`${ids}-workspace`} className="w-full pointer-coarse:h-11"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="write">{copy.workspaceWrite}</SelectItem>
                    <SelectItem value="read-only">{copy.workspaceReadOnly}</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field id={`${ids}-network`} label={copy.network}>
                <Select value={draft.guarantees.network} onValueChange={network => set({ guarantees: { ...draft.guarantees, network: network as "on" | "off" } })}>
                  <SelectTrigger id={`${ids}-network`} className="w-full pointer-coarse:h-11"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="on">{copy.networkOn}</SelectItem>
                    <SelectItem value="off">{copy.networkOff}</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <button type="submit" hidden aria-hidden tabIndex={-1} />
          </form>
        </AppDialogBody>
        <DialogFooter className="mt-5 shrink-0 flex-row items-center justify-end gap-2">
          <span role={failed ? "alert" : undefined} className={cn("mr-auto text-xs", failed ? "text-destructive" : "text-muted-foreground")}>
            {failed ? copy.saveFailed : payload ? "" : copy.missingRequired}
          </span>
          <Button type="button" variant="ghost" disabled={busy} onClick={() => onOpenChange(false)}>{t("common.cancel")}</Button>
          <Button type="button" disabled={!payload || busy} onClick={() => void save()}>{editing ? t("common.save") : copy.create}</Button>
        </DialogFooter>
      </AppDialogContent>
    </Dialog>
  );
}
