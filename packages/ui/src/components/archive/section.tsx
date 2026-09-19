/**
 * [INPUT]: Shared Settings presentation, the Archive icon and host copy/content slots.
 * [OUTPUT]: ArchiveContent, ArchiveList and ArchiveEmpty for native and browser settings.
 * [POS]: One archive page layout; data readiness and available operations belong to the host.
 */
import type { ComponentProps, ReactNode } from "react";
import { Archive } from "lucide-react";
import { SettingsCanvas, SettingsSection } from "../settings/page-frame";
import { SettingsEmpty, SettingsList } from "../settings/content";

export function ArchiveContent({
  before,
  ...section
}: ComponentProps<typeof SettingsSection> & { before?: ReactNode }) {
  return (
    <SettingsCanvas>
      <div className="space-y-8">
        {before}
        <SettingsSection {...section} />
      </div>
    </SettingsCanvas>
  );
}
export function ArchiveList(props: ComponentProps<typeof SettingsList>) {
  return <SettingsList data-testid="archive-list" {...props} />;
}
export function ArchiveEmpty({
  title,
  hint,
}: {
  title: string;
  hint: ReactNode;
}) {
  return <SettingsEmpty icon={<Archive />} title={title} hint={hint} />;
}
