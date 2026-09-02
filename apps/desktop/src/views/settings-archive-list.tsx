/**
 * [INPUT]: Depends on Agent-identified Archive DTOs, the shared Agent backend icon, app i18n/locale, Settings row geometry, Button, Tooltip, cn, and Lucide action icons
 * [OUTPUT]: Provides the shared ArchiveListItem model, select-all/row checkbox, Agent-consistent chronological row renderer, and stable row locator for archived Chats and Projects
 * [POS]: Presentation boundary for Settings Archive list rows; read-only entities keep restore but expose an explained non-destructive delete boundary
 */

import { Folder, RotateCcw, Trash2 } from "lucide-react";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import type { ArchivedEntity } from "../../shared/archive-ipc";
import { AgentBackendIcon } from "@/lib/agent-backends";
import { intlLocale } from "@/lib/i18n-locale";
import { Button } from "@ai-chat/ui/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@ai-chat/ui/components/ui/tooltip";
import { cn } from "@ai-chat/ui/lib/utils";

export type ArchiveListItem = {
  key: string;
  archivedAt: number;
  entity: ArchivedEntity;
};

export const archiveRowId = (key: string) =>
  `archive-target-${key.replaceAll(":", "-")}`;

const formatArchivedAt = (value: number) =>
  new Intl.DateTimeFormat(intlLocale(), {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));

function entityKind(
  entity: ArchivedEntity,
  t: ReturnType<typeof useAppTranslation>["t"]
) {
  return entity.target.kind === "project"
    ? t("archive.projectKind", { count: entity.memberCount })
    : t("archive.chatKind");
}

/* Chat 行用它自己的 Agent 图标——导入历史与原生 Chat 在这里同一套语言；
   Project 没有 Agent 身份，落回文件夹。 */
function ArchiveItemIcon({ entity }: { entity: ArchivedEntity }) {
  if (!("agent" in entity)) {
    return <Folder aria-hidden="true" className="size-4" />;
  }
  return (
    <AgentBackendIcon
      backend={entity.agent}
      aria-hidden="true"
      className="size-4"
      data-agent-backend={entity.agent}
    />
  );
}

/* 44px 命中区只放大交互，不放大 16px 方块。indeterminate 是 DOM
   property，只能经 ref 同步；展开标签仍由同一个 label 承担命中。 */
export function ArchiveSelectBox({
  label,
  showLabel = false,
  checked,
  indeterminate = false,
  disabled,
  onChange,
}: {
  label: string;
  showLabel?: boolean;
  checked: boolean;
  indeterminate?: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label
      className={cn(
        "flex min-h-11 cursor-pointer items-center",
        showLabel && "pr-2",
        disabled && "cursor-not-allowed"
      )}
    >
      <span className="flex size-11 shrink-0 touch-manipulation items-center justify-center">
        <input
          ref={(node) => {
            if (node) node.indeterminate = indeterminate;
          }}
          aria-label={label}
          type="checkbox"
          className="size-4 accent-foreground"
          checked={checked}
          disabled={disabled}
          onChange={(event) => onChange(event.currentTarget.checked)}
        />
      </span>
      {showLabel && (
        <span aria-hidden="true" className="text-muted-foreground text-xs">
          {label}
        </span>
      )}
    </label>
  );
}

/* 不可用不是 native disabled：按钮必须继续接收 hover/focus，Tooltip 才能
   解释只读边界。aria-disabled + 空 handler 保留语义与键盘可发现性。 */
function RowAction({
  label,
  icon: Icon,
  destructive = false,
  disabled,
  unavailableReason,
  onClick,
}: {
  label: string;
  icon: typeof RotateCcw;
  destructive?: boolean;
  disabled: boolean;
  unavailableReason?: string;
  onClick?: () => void;
}) {
  const unavailable = Boolean(unavailableReason);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          aria-label={label}
          aria-disabled={unavailable || undefined}
          aria-description={unavailableReason}
          disabled={disabled}
          className={cn(
            "size-11 touch-manipulation text-muted-foreground",
            destructive && !unavailable && "hover:text-destructive",
            unavailable &&
              "cursor-not-allowed opacity-50 hover:bg-transparent hover:text-muted-foreground"
          )}
          onClick={unavailable ? undefined : onClick}
        >
          <Icon className="size-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top">{unavailableReason ?? label}</TooltipContent>
    </Tooltip>
  );
}

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
  const { t } = useAppTranslation();
  const title = item.entity.title;
  const isProject = item.entity.target.kind === "project";
  const kindLabel = entityKind(item.entity, t);
  const unavailableReason = item.entity.readOnly
    ? t("archive.importedDeleteUnavailable")
    : undefined;

  return (
    <div
      id={archiveRowId(item.key)}
      data-testid="archive-row"
      data-selected={checked}
      data-search-targeted={searchTargeted}
      tabIndex={-1}
      className={cn(
        "flex items-center gap-2 pr-2 pl-1 transition-colors hover:bg-muted/50 focus-visible:outline-none motion-reduce:transition-none",
        searchTargeted && "bg-accent ring-2 ring-inset ring-ring"
      )}
    >
      <ArchiveSelectBox
        label={t("archive.selectEntity", { title })}
        checked={checked}
        disabled={busy}
        onChange={onChange}
      />

      <span
        role="img"
        aria-label={kindLabel}
        className="flex shrink-0 items-center text-muted-foreground"
      >
        <ArchiveItemIcon entity={item.entity} />
      </span>

      <span
        title={title}
        className="min-w-0 flex-1 truncate font-medium text-sm"
      >
        {title}
        {isProject && (
          <span aria-hidden="true" className="font-normal text-muted-foreground">
            {" · "}
            {t("archive.chatCount", { count: item.entity.memberCount })}
          </span>
        )}
      </span>

      <span className="w-40 shrink-0 truncate text-right text-muted-foreground text-xs tabular-nums">
        {formatArchivedAt(item.archivedAt)}
      </span>

      <span className="flex shrink-0 items-center">
        <RowAction
          label={t("archive.restoreEntity", { title })}
          icon={RotateCcw}
          disabled={busy}
          onClick={onRestore}
        />
        <RowAction
          label={t("archive.deleteEntity", { title })}
          icon={Trash2}
          destructive
          disabled={busy}
          unavailableReason={unavailableReason}
          onClick={onPurge}
        />
      </span>
    </div>
  );
}
