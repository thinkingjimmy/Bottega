/**
 * [INPUT]: Depends on confirmed target/Agent capabilities, shared dropdown/tooltip primitives, platform glyphs and remote interaction copy.
 * [OUTPUT]: Provides computer/Agent chips (the Agent chip keeps the chat's Agent, dimmed where it is not offered), the computer menu (DeviceMenu, shared with the read-only card), device rows and targetReason with distinct pending Project facts and confirmed local binding actions.
 * [POS]: The computer surface's chip and menu, shared by the composer and the read-only card; selecting a device delegates the claim to its host and never grants local authority.
 */
import { useEffect, useLayoutEffect, useRef, useState, useId, type ReactNode } from "react";
import { TriangleAlert } from "lucide-react";

import { Button } from "@ai-chat/ui/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@ai-chat/ui/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@ai-chat/ui/components/ui/tooltip";
import type { CloudChatHead } from "@ai-chat/cloud-protocol/chats/model";
import type { RemoteTarget } from "@ai-chat/cloud-protocol/remote/model";
import { backendName, type RemoteCopy } from "../../../i18n/remote";
import { PlatformGlyph, type PlatformGlyphKind } from "./glyphs";
export function targetReason(target: RemoteTarget, protocol: number, copy: RemoteCopy, allowLocalBinding = false) {
  if (!target.online) return copy.offline;
  if (target.protocolVersion !== protocol) return copy.update;
  if (target.reason === "local-facts-pending") return copy.projectPending;
  if (target.projectBound === false && !allowLocalBinding) return copy.projectUnbound;
  return null;
}
/** What the chip shows: the platform glyph, how it is drawn, and the tooltip that names the computer and its state. */
export type ComputerFace = { glyph: PlatformGlyphKind; tone: "ready" | "dim" | "working" | "attention"; label: string };
/** One outcome anchored to the chip — a failed switch or preparation — with its single recovery. */
export type ComputerCallout = { message: string; action?: { label: string; run(): void }; dismiss(): void };
type DeviceMenuProps = {
  items: RemoteTarget[]; selectedDeviceId: string; localDeviceId: string | null; protocol: number; copy: RemoteCopy;
  disabled?: boolean; onSelect(deviceId: string): void; allowLocalBinding?: boolean; sameAgent?: boolean;
  onLocalSelect?(): void; remoteBlockedReason?: string | null;
};
/** The computer menu: glyph, computer name and online state or the reason a row is off; opened from the chip or from the read-only card's button. */
export function DeviceMenu({ items, selectedDeviceId, localDeviceId, protocol, copy, disabled, onSelect, allowLocalBinding = false, onLocalSelect, remoteBlockedReason, align = "end" }: DeviceMenuProps & { align?: "start" | "end" }) {
  const name = (item: RemoteTarget) => item.deviceId === localDeviceId ? copy.local.replace("{name}", item.name) : item.name;
  return <DropdownMenuContent className="chat-remote-menu" align={align} side="top">
    {onLocalSelect && <DropdownMenuItem disabled={disabled} onSelect={onLocalSelect}>{copy.localAction}</DropdownMenuItem>}
    <DropdownMenuRadioGroup value={selectedDeviceId} onValueChange={id => { if (!remoteBlockedReason) onSelect(id); }}>
      {items.filter(item => !onLocalSelect || item.deviceId !== localDeviceId).map(item => {
        const reason = remoteBlockedReason ?? targetReason(item, protocol, copy, allowLocalBinding && item.deviceId === localDeviceId);
        return <DropdownMenuRadioItem key={item.deviceId} value={item.deviceId} disabled={disabled || Boolean(reason)} className="chat-remote-option" textValue={name(item)}>
          <PlatformGlyph kind={item.platform} className="chat-remote-option-glyph" />
          <span className="chat-remote-option-body"><span>{name(item)}</span><small>{reason ?? copy.online}</small></span>
        </DropdownMenuRadioItem>;
      })}
    </DropdownMenuRadioGroup>
    {!items.length && !onLocalSelect && <p className="chat-remote-hint">{copy.noComputers}</p>}
  </DropdownMenuContent>;
}
export function DeviceSelector({ currentDeviceId, face, callout, ...menu }: DeviceMenuProps & { currentDeviceId: string | null; face: ComputerFace; callout?: ComputerCallout | null }) {
  const { copy, disabled, items } = menu;
  const shown = items.find(item => item.deviceId === menu.selectedDeviceId) ?? items.find(item => item.deviceId === currentDeviceId);
  const name = shown ? shown.deviceId === menu.localDeviceId ? copy.local.replace("{name}", shown.name) : shown.name : copy.chooseComputer;
  return <div className="chat-remote-selector" data-remote-device-selector data-tone={face.tone}>
    <DropdownMenu><Chip label={`${copy.computer}: ${face.label}`} tooltip={face.label} disabled={disabled} named>
      {face.tone === "working"
        ? <span className="chat-remote-working"><PlatformGlyph kind={face.glyph} className="size-3.5" /></span>
        : <PlatformGlyph kind={face.glyph} className="size-4" />}
      <span className="max-w-32 truncate">{name}</span>
      {face.tone === "attention" && <TriangleAlert aria-hidden="true" className="size-3.5 shrink-0 text-destructive" />}
    </Chip><DeviceMenu {...menu} /></DropdownMenu>
    {callout && <Callout callout={callout} />}
    {currentDeviceId && !items.some(item => item.deviceId === currentDeviceId) && <span className="sr-only">{copy.revoked}</span>}
  </div>;
}
import { QuotaSummaryText } from "../../composer/agent/quota/summary";
import { AgentPicker, type AgentPickerRow } from "../../composer/agent/picker";
import { createQuotaFormat } from "../../composer/agent/quota/format";
import { quotaTranslate } from "../../composer/agent/quota/copy";
import { emptyAgentLimits } from "@ai-chat/cloud-protocol/remote/quota";
export function RemoteAgentSelector({ target, value, head: _head, copy, disabled, onSelect, locale = "en", quotaEnabled = true }: {
  quotaEnabled?: boolean; locale?: string; target: RemoteTarget | undefined; value: string; head: CloudChatHead | null; copy: RemoteCopy; disabled?: boolean;
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
/* Named computer and unavailable-Agent chips keep their full accessible labels when visual text is truncated. */
function Chip({ label, tooltip, disabled, children, named }: { label: string; tooltip: string; disabled?: boolean; children: ReactNode; named?: boolean }) {
  return <TooltipProvider><Tooltip><TooltipTrigger asChild><DropdownMenuTrigger asChild>
    <Button type="button" variant="ghost" size="icon-lg" disabled={disabled} aria-label={label} className={`chat-remote-chip rounded-full ${named ? "!w-auto gap-1 px-2" : ""}`}>{children}</Button>
  </DropdownMenuTrigger></TooltipTrigger><TooltipContent side="top">{tooltip}</TooltipContent></Tooltip></TooltipProvider>;
}
function Callout({ callout }: { callout: ComputerCallout }) {
  const element = useRef<HTMLDivElement>(null);
  // The host rebuilds the callout object every render; a latest ref keeps the dismissal listeners registered once.
  const latest = useRef(callout);
  useLayoutEffect(() => { latest.current = callout; }, [callout]);
  useEffect(() => {
    const away = (event: PointerEvent) => { if (element.current && !element.current.contains(event.target as Node)) latest.current.dismiss(); };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") latest.current.dismiss(); };
    document.addEventListener("pointerdown", away); document.addEventListener("keydown", key);
    return () => { document.removeEventListener("pointerdown", away); document.removeEventListener("keydown", key); };
  }, []);
  return <div ref={element} role="alert" className="chat-remote-callout">
    <TriangleAlert aria-hidden="true" className="size-3.5 shrink-0 text-destructive" />
    <p>{callout.message}</p>
    {callout.action && <Button type="button" variant="outline" onClick={callout.action.run}>{callout.action.label}</Button>}
  </div>;
}
