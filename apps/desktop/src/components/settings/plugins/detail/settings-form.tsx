/**
 * [INPUT]: Depends on React, lucide icons, the shared Input / Select / ConfirmationDialog, Settings layout primitives, workbench-copy and
 *           the plugins bridge's settings view and submit.
 * [OUTPUT]: Provides PluginSettingsForm — every declared field (toggle, select, number stepper, text saved on Enter or blur, secret shown
 *           only as set / not set with Replace and Clear), each with when it applies, "Changed" and Reset to default; an owner's
 *           confirmation (`confirm`) is asked in a dialog and answered by its id; a refusal is shown under its field.
 * [POS]: T-P5's form on the T-P4 detail page. Values live in main; the form sends one field at a time and shows what main answers,
 *        so a secret's clear text never comes back.
 */
import { useState } from "react";
import { Minus, Plus, RotateCcw } from "lucide-react";
import { ConfirmationDialog } from "@ai-chat/ui/components/ui/app-dialog";
import { Input } from "@ai-chat/ui/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@ai-chat/ui/components/ui/select";
import { formatWorkbench, type WorkbenchCopy } from "@ai-chat/ui/lib/workbench-copy";
import { SettingsBadge, SettingsButton, SettingsIconButton, SettingsList, SettingsSection, SettingsSwitch } from "@/components/settings/settings-layout";
import type { PluginsBridge } from "@ai-chat/cloud-protocol/contracts/plugins/catalog";
import type { PluginSettingsView, SettingField, SettingValue, SettingsSubmitResult } from "@ai-chat/cloud-protocol/contracts/plugins/settings";
import { appliesAtLabel, pluginText } from "../copy";

type Confirm = Extract<SettingsSubmitResult, { status: "confirm" }>["confirmation"] & { patch: Record<string, SettingValue | null> };

function TextField({ field, value, label, onSave }: { field: Extract<SettingField, { type: "text" }>; value: string; label: string; onSave(value: string): void }) {
  const [draft, setDraft] = useState(value);
  const [previous, setPrevious] = useState(value);
  if (previous !== value) { setPrevious(value); setDraft(value); }
  const commit = () => { if (draft !== value) onSave(draft); };
  return <Input size="lg" className="w-56" aria-label={label} maxLength={field.maxLength} value={draft} onChange={event => setDraft(event.target.value)}
    onBlur={commit} onKeyDown={event => { if (event.key === "Enter") commit(); if (event.key === "Escape") setDraft(value); }} />;
}

function SecretField({ set, label, copy, onSave }: { set: boolean; label: string; copy: WorkbenchCopy["plugins"]; onSave(value: string | null): void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  if (editing) return (
    <form className="flex items-center gap-2" onSubmit={event => { event.preventDefault(); if (draft) { onSave(draft); setEditing(false); setDraft(""); } }}>
      <Input size="lg" type="password" autoComplete="off" autoFocus aria-label={label} className="w-48" value={draft} onChange={event => setDraft(event.target.value)} />
      <SettingsButton type="submit" disabled={!draft}>{copy.secretSave}</SettingsButton>
      <SettingsButton variant="ghost" onClick={() => { setEditing(false); setDraft(""); }}>{copy.secretCancel}</SettingsButton>
    </form>
  );
  return (
    <span className="flex items-center gap-2">
      <SettingsBadge tone={set ? "neutral" : "muted"}>{set ? copy.secretSet : copy.secretUnset}</SettingsBadge>
      <SettingsButton variant="outline" onClick={() => setEditing(true)}>{set ? copy.secretReplace : copy.secretSave}</SettingsButton>
      {set && <SettingsButton variant="ghost" onClick={() => onSave(null)}>{copy.secretClear}</SettingsButton>}
    </span>
  );
}

export function PluginSettingsForm({ pluginId, provider, view: initial, bridge, workbench }: {
  pluginId: string;
  name: string;
  provider: boolean;
  view: PluginSettingsView;
  bridge: PluginsBridge;
  workbench: WorkbenchCopy;
}) {
  const copy = workbench.plugins;
  const [view, setView] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [previous, setPrevious] = useState(initial);
  if (previous !== initial) { setPrevious(initial); setView(initial); }
  const submit = async (fieldId: string, patch: Record<string, SettingValue | null>, answer?: string) => {
    setBusy(fieldId); setErrors(current => { const next = { ...current }; delete next[fieldId]; return next; });
    const label = pluginText(view.fields.find(field => field.id === fieldId)?.label, workbench);
    try {
      const result = await bridge.setSettings(pluginId, patch, answer);
      if (result.status === "applied") setView(result.view);
      else if (result.status === "confirm") setConfirm({ ...result.confirmation, patch });
      else setErrors(current => ({ ...current, [fieldId]: formatWorkbench(copy.settingsFailed, { setting: label }) }));
    } catch { setErrors(current => ({ ...current, [fieldId]: formatWorkbench(copy.settingsFailed, { setting: label }) })); }
    finally { setBusy(null); }
  };
  const control = (field: SettingField) => {
    const value = view.values[field.id];
    const label = pluginText(field.label, workbench);
    const save = (next: SettingValue | null) => void submit(field.id, { [field.id]: next });
    const disabled = busy === field.id;
    switch (field.type) {
      case "toggle": return <SettingsSwitch id={`setting-${pluginId}-${field.id}`} label={label} checked={value === true} disabled={disabled} onToggle={next => save(next)} />;
      case "select": return (
        <Select value={String(value)} disabled={disabled} onValueChange={next => save(next)}>
          <SelectTrigger size="lg" aria-label={label} className="min-w-36"><SelectValue /></SelectTrigger>
          <SelectContent>{field.options.map(option => <SelectItem key={option.value} value={option.value}>{pluginText(option.label, workbench)}</SelectItem>)}</SelectContent>
        </Select>
      );
      case "number": {
        const current = typeof value === "number" ? value : field.default;
        return (
          <span className="flex items-center gap-1 rounded-md border" role="group" aria-label={label}>
            <SettingsIconButton label={copy.decrease} disabled={disabled || current <= field.min} onClick={() => save(Math.max(field.min, current - field.step))}><Minus /></SettingsIconButton>
            <output className="min-w-8 text-center text-sm tabular-nums" aria-live="polite">{current}</output>
            <SettingsIconButton label={copy.increase} disabled={disabled || current >= field.max} onClick={() => save(Math.min(field.max, current + field.step))}><Plus /></SettingsIconButton>
          </span>
        );
      }
      case "text": return <TextField field={field} value={typeof value === "string" ? value : field.default} label={label} onSave={next => save(next)} />;
      case "secret": return <SecretField set={typeof value === "object" && value?.secret === "set"} label={label} copy={copy} onSave={save} />;
    }
  };
  return (
    <SettingsSection title={copy.sectionSettings} action={<span className="text-muted-foreground text-xs">{provider ? copy.settingsProviderNote : copy.settingsNote}</span>}>
      <SettingsList>
        {view.fields.map(field => {
          const changed = view.changed.includes(field.id);
          return (
            <div key={field.id} className="flex items-start gap-4 px-4 py-3.5" data-plugin-setting={field.id} data-changed={changed ? "true" : "false"}>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-sm">{pluginText(field.label, workbench)}</span>
                  <SettingsBadge tone="muted">{appliesAtLabel(field.appliesAt, copy)}</SettingsBadge>
                  {changed && field.type !== "secret" && <>
                    <SettingsBadge>{copy.changed}</SettingsBadge>
                    <button type="button" className="inline-flex items-center gap-1 rounded text-primary text-xs hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                      onClick={() => void submit(field.id, { [field.id]: null })}><RotateCcw aria-hidden className="size-3" />{copy.resetDefault}</button>
                  </>}
                </div>
                {field.description && <p className="text-pretty text-muted-foreground text-xs leading-[18px]">{pluginText(field.description, workbench)}</p>}
                {errors[field.id] && <p role="alert" className="text-destructive text-xs">{errors[field.id]}</p>}
              </div>
              <div className="shrink-0 pt-0.5">{control(field)}</div>
            </div>
          );
        })}
      </SettingsList>
      <ConfirmationDialog open={Boolean(confirm)} busy={busy !== null} title={confirm ? pluginText(confirm.title, workbench) : ""}
        description={confirm ? pluginText(confirm.body, workbench) : ""} confirmLabel={copy.confirmContinue}
        confirmTone={confirm?.danger ? "destructive" : "default"}
        onConfirm={() => { if (confirm) { const answer = confirm; setConfirm(null); void submit(Object.keys(answer.patch)[0]!, answer.patch, answer.id); } }}
        onOpenChange={open => { if (!open) setConfirm(null); }} />
    </SettingsSection>
  );
}
