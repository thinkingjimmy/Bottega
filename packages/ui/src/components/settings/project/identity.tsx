/**
 * [INPUT]: Project display name, localized labels, host appearance control and rename callback.
 * [OUTPUT]: ProjectIdentityRow with native General settings geometry.
 * [POS]: Shared Project identity presentation; hosts retain metadata writes and appearance state.
 */
import type { ReactNode } from "react";
import { Pencil } from "lucide-react";
import { SettingsButton } from "../controls";
export function ProjectIdentityRow({ name, label, renameLabel, appearance, onRename, disabled }: {
  name: string; label: string; renameLabel: string; appearance: ReactNode; onRename(): void; disabled?: boolean;
}) {
  return <div className="flex items-center justify-between gap-6 px-4 py-3 max-md:flex-wrap max-md:gap-3">
    <div className="flex min-w-0 items-center gap-3">{appearance}<div className="min-w-0">
      <p className="break-words font-medium text-sm">{name}</p><p className="mt-1 text-muted-foreground text-xs">{label}</p>
    </div></div>
    <SettingsButton disabled={disabled} onClick={onRename} variant="outline"><Pencil className="size-4" />{renameLabel}</SettingsButton>
  </div>;
}
