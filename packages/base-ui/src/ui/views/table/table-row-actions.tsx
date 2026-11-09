/**
 * [INPUT]: Uses `lucide-react`, `@ai-chat/base-core/model/bases-ipc`, `@ai-chat/ui/lib/utils`, `../../chrome/base-toolbar`, `../../platform/i18n`, `../../state/record-slots` for its declared types and implementation.
 * [OUTPUT]: Provides TableRowActions and dynamic TITLE_ACTIONS_RESERVE for accessible record actions and history.
 * [POS]: Table title-cell action presentation; touch reserves space for every contributed action.
 */
import { HistoryIcon } from "lucide-react";
import type { BaseRow } from "@ai-chat/base-core/model/bases-ipc";
import { cn } from "@ai-chat/ui/lib/utils";
import { baseActionButtonClass } from "../../chrome/base-toolbar";
import { useAppTranslation } from "../../platform/i18n";
import { RecordActions, useRecordSlots } from "../../state/record-slots";

/* Hover reveals on fine pointers; keyboard focus reveals too. Touch has no hover, so both stay shown
   and each button is a real 44px column (row height is 34–38px, so touch-target-44 supplies the height). */
const revealClass =
  "opacity-0 group-hover/row:opacity-100 focus-within:opacity-100 no-hover:opacity-100 pointer-coarse:opacity-100";
const buttonClass = cn(baseActionButtonClass, "[--touch-target-inset:-0.25rem] pointer-coarse:flex pointer-coarse:w-11 pointer-coarse:justify-center pointer-coarse:[--touch-target-inset:0px]");

/** Room the title text keeps on touch, where the buttons never hide: two 44px buttons plus the edge gap. */
export const TITLE_ACTIONS_RESERVE = "pointer-coarse:pr-[var(--record-actions-width)] no-hover:pr-[var(--record-actions-width)]";

export function TableRowActions({ row, title, onHistory }: {
  row: BaseRow;
  title: string;
  onHistory?(rowId: string): void;
}) {
  const { t } = useAppTranslation();
  const slots = useRecordSlots();
  if (!onHistory && !slots.some(slot => slot.actions)) return null;
  const label = title || row.id;
  return (
    <div
      className={cn("absolute inset-y-0 right-0 flex items-center gap-0.5 bg-background pr-1 pl-1 transition-opacity group-hover/row:bg-[color-mix(in_oklab,var(--muted)_25%,var(--background))]", revealClass)}
      data-row-actions={row.id}
    >
      <RecordActions rowId={row.id} title={label} />
      {onHistory ? (
        <button aria-label={`${t("bases.history.open")}: ${label}`} className={buttonClass} data-row-action="history"
          onClick={() => onHistory(row.id)} title={t("bases.history.open")} type="button">
          <HistoryIcon className="size-3.5" />
        </button>
      ) : null}
    </div>
  );
}
