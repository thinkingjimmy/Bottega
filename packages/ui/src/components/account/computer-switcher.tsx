/**
 * [INPUT]: Depends on the shared side-panel tablist, the device list's relative moment and host-projected computer facts.
 * [OUTPUT]: Provides ComputerSwitcher — one tab per computer, an online dot or its offline moment, as the sidebar strip or the phone home's pill row — plus computerPresenceLabel and COMPUTER_PANEL_ID.
 * [POS]: The account's computer strip above the sidebar groups, shared by Cloud Web and the desktop; the host owns presence, selection and storage.
 */
import { SidePanelTabs, type SidePanelTab } from "../workspace/side-panel/tabs";
import { relativeMoment } from "./moment";
import { cn } from "../../lib/utils";
/** The sidebar region the strip switches; the frame puts this id on the groups the tabs control. */
export const COMPUTER_PANEL_ID = "workspace-computer-panel";
export interface SwitchableComputer {
  machineIdHash: string; name: string; online: boolean; lastSeenAt: number | null;
}
export interface ComputerSwitcherCopy {
  /** The tablist's accessible name. */ label: string;
  online: string; offline: string;
  /** "Offline · {{when}}". */ offlineSince: string;
}
export function computerPresenceLabel(computer: SwitchableComputer, copy: ComputerSwitcherCopy, locale: string) {
  if (computer.online) return copy.online;
  return computer.lastSeenAt === null ? copy.offline : copy.offlineSince.replace("{{when}}", relativeMoment(computer.lastSeenAt, locale));
}
/**
 * One computer is not a choice: the strip appears only once the account has a second one, so a single-computer
 * account never pays for a control it cannot use. A long name truncates inside its tab; the title keeps it whole.
 */
/* A phone row has width to scroll and fingers to serve: 44px pills, the selected one filled dark, one line that scrolls sideways. */
const pills = "px-3 pb-2 [&_[role=tab]]:h-11 [&_[role=tab]]:max-w-56 [&_[role=tab]]:rounded-full [&_[role=tab]]:px-4 [&_[role=tab]]:text-sm [&_[role=tab][aria-selected=true]]:bg-foreground [&_[role=tab][aria-selected=true]]:text-background";
export function ComputerSwitcher({ computers, selected, onSelect, copy, locale, className, variant = "strip" }: {
  computers: readonly SwitchableComputer[];
  selected: string | null;
  onSelect(machineIdHash: string): void;
  copy: ComputerSwitcherCopy;
  locale: string;
  className?: string;
  /** The sidebar's wrapping strip, or the phone home's scrolling pill row. */
  variant?: "strip" | "pills";
}) {
  if (computers.length < 2) return null;
  const items: SidePanelTab[] = computers.map(computer => {
    const presence = computerPresenceLabel(computer, copy, locale);
    return {
      key: computer.machineIdHash, label: computer.name, panelId: COMPUTER_PANEL_ID,
      selected: computer.machineIdHash === selected, hint: `${computer.name} · ${presence}`,
      /* An offline tab carries its moment as well as its name, so it may take the whole row rather than lose the name. */
      widthClass: computer.online ? undefined : "max-w-full",
      icon: computer.online ? <span aria-label={presence} className="size-2 shrink-0 rounded-full bg-emerald-500" /> : null,
      actions: computer.online ? undefined : <span className="shrink-0 text-[10px] leading-none opacity-70">{presence}</span>,
      select: () => onSelect(computer.machineIdHash),
    };
  });
  /* A sidebar has rows to spare and no width to spare: the strip wraps rather than hiding a computer off its edge. */
  return <div className={cn(variant === "pills" ? pills : "px-2 pb-0.5", className)} data-computer-switcher={variant}>
    <SidePanelTabs items={items} label={copy.label} className={variant === "pills" ? "gap-2 [scrollbar-width:none]" : "flex-wrap gap-y-1 overflow-x-visible"} />
  </div>;
}
