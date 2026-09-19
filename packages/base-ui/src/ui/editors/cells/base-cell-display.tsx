/**
 * [INPUT]: Depends on baseCellText/isBaseAttachmentValue from the Base model, the attachment preview from the cell editor, i18n and the canonical BaseCellContext
 * [OUTPUT]: Provides BaseCellDisplay, the read-only tap-to-open cell used by the table on coarse pointers instead of a live inline editor
 * [POS]: Shared Base presentation in ui/editors/cells; the table decides when a cell is display-only, the record editor owns the edit
 */

import {
  baseCellText,
  cellValue,
  isBaseAttachmentValue,
  type BaseCellContext,
  type BaseColumn,
  type BaseRow,
} from "@ai-chat/base-ui/model/bases-ipc";
import { useAppTranslation } from "../../platform/i18n";
import { BaseAttachmentPreview } from "./base-cell-editor";

export function BaseCellDisplay({
  column,
  row,
  context,
  attachmentOwner,
  onOpen,
}: {
  column: BaseColumn;
  row: BaseRow;
  context: BaseCellContext;
  attachmentOwner?: { chatId: string; incarnationId: string };
  onOpen(): void;
}) {
  const { t } = useAppTranslation();
  const value = cellValue(row, column, context);
  const stored = row.values[column.id];
  return (
    <button
      aria-label={t("bases.cell.openRecordAria", { column: column.name })}
      className="flex h-9 w-full min-w-0 cursor-pointer items-center px-2 text-left text-xs"
      onClick={onOpen}
      type="button"
    >
      {column.type === "attachment" && isBaseAttachmentValue(stored) ? (
        <BaseAttachmentPreview owner={attachmentOwner} value={stored} />
      ) : (
        <span className="block min-w-0 flex-1 truncate">
          {baseCellText(column, value) || "—"}
        </span>
      )}
    </button>
  );
}
