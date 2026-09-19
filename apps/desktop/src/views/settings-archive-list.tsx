/**
 * [INPUT]: Native Archive DTOs, i18n, Agent identity and shared archive row/controls.
 * [OUTPUT]: Native ArchiveListItem and ArchivedItemRow adapters; re-exports shared selection and stable locators.
 * [POS]: Native capability boundary for the common Archive presentation; main retains restore/purge authority.
 */
import { Folder, RotateCcw, Trash2 } from "lucide-react";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import type { ArchivedEntity } from "../../shared/archive-ipc";
import { AgentBackendIcon } from "@/lib/agent-backends";
import { intlLocale } from "@/lib/i18n-locale";
import {
  ArchiveRow,
  archiveRowId,
  formatArchivedAt,
} from "@ai-chat/ui/components/archive/row";
import {
  ArchiveSelectBox,
  ArchiveRowAction,
} from "@ai-chat/ui/components/archive/controls";
export { archiveRowId, ArchiveSelectBox };
export type ArchiveListItem = {
  key: string;
  archivedAt: number;
  entity: ArchivedEntity;
};

export function ArchivedItemRow({
  item,
  searchTargeted,
  checked,
  onChange,
  busy,
  onRestore,
  onPurge,
}: {
  item: ArchiveListItem;
  searchTargeted: boolean;
  checked: boolean;
  onChange: (checked: boolean) => void;
  busy: boolean;
  onRestore: () => void;
  onPurge?: () => void;
}) {
  const { t } = useAppTranslation(),
    { entity } = item,
    title = entity.title;
  const isProject = entity.target.kind === "project";
  return (
    <ArchiveRow
      id={archiveRowId(item.key)}
      targeted={searchTargeted}
      data-selected={checked}
      title={title}
      titleDetail={
        isProject
          ? t("archive.chatCount", { count: entity.memberCount })
          : undefined
      }
      iconLabel={t(isProject ? "archive.projectKind" : "archive.chatKind", {
        count: entity.memberCount,
      })}
      icon={
        "agent" in entity ? (
          <AgentBackendIcon
            backend={entity.agent}
            aria-hidden="true"
            className="size-4"
            data-agent-backend={entity.agent}
          />
        ) : (
          <Folder aria-hidden="true" className="size-4" />
        )
      }
      date={formatArchivedAt(item.archivedAt, intlLocale())}
      leading={
        <ArchiveSelectBox
          label={t("archive.selectEntity", { title })}
          checked={checked}
          disabled={busy}
          onChange={onChange}
        />
      }
      actions={
        <>
          <ArchiveRowAction
            label={t("archive.restoreEntity", { title })}
            icon={RotateCcw}
            disabled={busy}
            onClick={onRestore}
          />
          <ArchiveRowAction
            label={t("archive.deleteEntity", { title })}
            icon={Trash2}
            destructive
            disabled={busy}
            unavailableReason={
              entity.readOnly
                ? t("archive.importedDeleteUnavailable")
                : undefined
            }
            onClick={onPurge}
          />
        </>
      }
    />
  );
}
