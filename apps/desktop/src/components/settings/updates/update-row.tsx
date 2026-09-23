/**
 * [INPUT]: Depends on React, ui Spinner, Settings icon buttons and lucide status glyphs
 * [OUTPUT]: Provides UpdateRow (identity, `current → latest` versions, one trailing status/action and an optional detail line) and its trailing slot helpers
 * [POS]: Shared row shell of Settings › Updates; AppUpdateRow and CliUpdateRow only decide what fills the slots
 */

import type { ReactNode } from "react";
import { ArrowRight, CircleAlert, CircleCheck, Download } from "lucide-react";
import { Spinner } from "@ai-chat/ui/components/ui/spinner";
import { SettingsIconButton } from "@/components/settings/settings-layout";

export function UpdateRow({ icon, name, current, latest, trailing, detail }: {
  icon: ReactNode;
  name: string;
  current?: string;
  /** Only a newer version is shown; the arrow is the whole message. */
  latest?: string;
  trailing?: ReactNode;
  detail?: ReactNode;
}) {
  return <div role="group" aria-label={name} className="px-4 py-3">
    <div className="flex min-h-8 items-center gap-3">
      <span aria-hidden="true" className="flex size-5 shrink-0 items-center justify-center">{icon}</span>
      <span className="font-medium text-sm">{name}</span>
      {current && <span className="flex min-w-0 items-center gap-1 truncate text-muted-foreground text-xs tabular-nums">
        {current}
        {latest && <><ArrowRight aria-hidden="true" className="size-3 shrink-0" /><span className="font-semibold text-foreground">{latest}</span></>}
      </span>}
      <div className="ml-auto flex shrink-0 items-center gap-2">{trailing}</div>
    </div>
    {detail && <div className="min-w-0 pl-8 pt-1">{detail}</div>}
  </div>;
}

export const UpToDateMark = ({ label }: { label: string }) =>
  <CircleCheck role="img" aria-label={label} className="mx-2 size-4 text-muted-foreground/70" />;

export const FailedMark = ({ label }: { label: string }) =>
  <CircleAlert role="img" aria-label={label} className="mx-2 size-4 text-destructive" />;

export const UpdatingMark = ({ label }: { label: string }) =>
  <span role="status" aria-label={label} className="mx-2 flex"><Spinner className="size-4 text-muted-foreground" /></span>;

export const UpdateButton = ({ label, onClick, disabled }: { label: string; onClick(): void; disabled?: boolean }) =>
  <SettingsIconButton label={label} variant="ghost" disabled={disabled} onClick={onClick}><Download /></SettingsIconButton>;
