/**
 * [INPUT]: Depends on the confirmed target's Agent capabilities and quota, the shared Agent picker and remote interaction copy.
 * [OUTPUT]: Provides RemoteAgentSelector — the Agent chip that keeps the chat's Agent, dimmed with its reason where the computer does not offer it.
 * [POS]: The computer surface's Agent chip, shared by creation and conversation; it chooses an Agent on one computer and never chooses a computer.
 */
import { useEffect, useId, useState } from "react";
import type { RemoteTarget } from "@ai-chat/cloud-protocol/remote/model";
import { emptyAgentLimits } from "@ai-chat/cloud-protocol/remote/quota";
import { backendName, type RemoteCopy } from "../../../i18n/remote";
import { QuotaSummaryText } from "../../composer/agent/quota/summary";
import { AgentPicker, type AgentPickerRow } from "../../composer/agent/picker";
import { createQuotaFormat } from "../../composer/agent/quota/format";
import { quotaTranslate } from "../../composer/agent/quota/copy";
export function RemoteAgentSelector({ target, value, copy, disabled, onSelect, locale = "en", quotaEnabled = true }: {
  quotaEnabled?: boolean; locale?: string; target: RemoteTarget | undefined; value: string; copy: RemoteCopy; disabled?: boolean;
  onSelect(backend: RemoteTarget["agents"][number]["backend"]): void;
}) {
  const options = target?.agents ?? [], selected = options.find(option => option.backend === value);
  const [open, setOpen] = useState(false), [now, setNow] = useState(Date.now), descriptionId = useId();
  useEffect(() => { if (!open) return; const timer = setInterval(() => setNow(Date.now()), 1_000); return () => clearInterval(timer); }, [open]);
  const reasonText = (reason: string | null | undefined, backend: string) => ({ "agent-missing": copy.agentMissing, "agent-outdated": copy.agentOutdated, "auth-required": copy.authRequired }[reason ?? ""] ?? copy.unavailableAgent).replace("{agent}", backendName(backend));
  const label = !options.length ? copy.noAgentAvailable : selected && !selected.available ? reasonText(selected.reason, selected.backend) : value ? backendName(value) : copy.chooseAgent;
  const t = quotaTranslate(locale), { quotaDescription } = createQuotaFormat(() => locale);
  const rows: AgentPickerRow[] = options.map(option => {
    const quota = option.quota ?? emptyAgentLimits(option.backend), current = option.backend === value;
    return { id: option.backend, name: backendName(option.backend), current, choosable: option.available || current, inert: Boolean(disabled || !option.available), dim: !current && !option.available,
      tone: option.available ? "quiet" : "attention", label: backendName(option.backend), description: option.available ? quotaEnabled ? quotaDescription(quota, now, t) : copy.online : reasonText(option.reason, option.backend),
      line: option.available ? quotaEnabled ? <QuotaSummaryText agent={quota} now={now} locale={locale} /> : undefined : reasonText(option.reason, option.backend),
      select: () => { if (option.available && !disabled) onSelect(option.backend); } };
  });
  return <div className="chat-remote-selector" data-remote-agent-selector><AgentPicker value={(value || "codex") as RemoteTarget["agents"][number]["backend"]}
    open={open} onOpenChange={setOpen} label={`${copy.agent}: ${label}`} disabled={disabled || !options.length} tone={selected && !selected.available ? "attention" : "quiet"}
    tooltip={<p>{label}</p>} rows={rows} descriptionId={descriptionId} announcement={options.length ? label : undefined} /></div>;
}
