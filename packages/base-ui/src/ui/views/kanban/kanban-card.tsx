/**
 * [INPUT]: Depends on dnd-kit useDraggable, editors useBaseAttachmentThumbnail, kanban-fields kanbanCardFace projection and tones
 * [OUTPUT]: Provides KanbanCard (lane slot plus drag handle that keeps vertical touch scrolling) and KanbanCardBody (the shared card visual, reused by DragOverlay), and KANBAN_CARD_CLASS
 * [POS]: Shared Base presentation in ui/views/kanban.
 */

import { useMemo } from "react";
import { useDraggable } from "@dnd-kit/core";
import { useAppTranslation } from "../../platform/i18n";
import { ImageIcon } from "lucide-react";
import type {
  BaseAttachmentValue,
  BaseCellContext,
  BaseRow,
} from "@ai-chat/base-ui/model/bases-ipc";
import { useBaseAttachmentThumbnail } from "../../editors/cells/base-cell-editor";
import {
  kanbanCardFace,
  KANBAN_NEUTRAL_TONE,
  type KanbanCardFace,
  type KanbanFaceSpec,
} from "./kanban-fields";

export type KanbanAttachmentOwner = { chatId: string; incarnationId: string };

export const KANBAN_CARD_CLASS =
  "rounded-lg border bg-background p-3 text-xs shadow-xs";

const COVER_MAX_EDGE = 480;

export function KanbanCard({
  cellContext,
  row,
  spec,
  owner,
  index,
  top,
  measure,
  onOpen,
}: {
  cellContext: BaseCellContext;
  row: BaseRow;
  spec: KanbanFaceSpec;
  owner?: KanbanAttachmentOwner;
  index: number;
  top: number;
  measure(node: Element | null): void;
  onOpen?(): void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: row.id,
  });

  const face = useMemo(
    () => kanbanCardFace(row, spec, cellContext),
    [cellContext, row, spec]
  );

  return (
    <div
      ref={measure}
      className="absolute left-0 w-full pb-2"
      data-index={index}
      style={{ transform: `translateY(${top}px)` }}
    >
      <article
        ref={setNodeRef}
        {...attributes}
        {...listeners}
        className={`${KANBAN_CARD_CLASS} cursor-grab touch-pan-y select-none [-webkit-touch-callout:none] transition-shadow hover:shadow-sm active:cursor-grabbing`}
        style={{ opacity: isDragging ? 0.35 : 1 }}
        // dnd-kit suppresses the click that ends a drag, so a plain tap or click is always an open.
        onClick={onOpen}
        onKeyDown={onOpen && ((event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onOpen(); } })}
      >
        <KanbanCardBody face={face} owner={owner} />
      </article>
    </div>
  );
}

export function KanbanCardBody({
  face,
  owner,
}: {
  face: KanbanCardFace;
  owner?: KanbanAttachmentOwner;
}) {
  const { t } = useAppTranslation();
  return (
    <>
      {face.cover && <KanbanCover owner={owner} value={face.cover} />}
      <p className="line-clamp-3 font-medium text-[13px] leading-snug">
        {face.title || <span className="text-muted-foreground">{t("bases.kanban.untitled")}</span>}
      </p>
      {face.chips.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1">
          {face.chips.map((chip) => (
            <span
              key={chip.key}
              className={`inline-flex max-w-full items-center gap-1 rounded px-1.5 py-0.5 text-[11px] leading-4 ${chip.tone.chip}`}
              title={`${chip.label} ${chip.text}`.trim()}
            >
              {chip.Icon && <chip.Icon aria-hidden className="size-3 shrink-0" />}
              {chip.label && (
                <span className="shrink-0 opacity-70">{chip.label}</span>
              )}
              {chip.text && <span className="truncate">{chip.text}</span>}
            </span>
          ))}
          {face.overflow.length > 0 && (
            <span
              className={`inline-flex items-center rounded px-1.5 py-0.5 text-[11px] leading-4 ${KANBAN_NEUTRAL_TONE.chip}`}
              title={face.overflow.join("\n")}
            >
              +{face.overflow.length}
            </span>
          )}
        </div>
      )}
    </>
  );
}

function KanbanCover({
  value,
  owner,
}: {
  value: BaseAttachmentValue;
  owner?: KanbanAttachmentOwner;
}) {
  const thumbnail = useBaseAttachmentThumbnail(owner, value, COVER_MAX_EDGE);
  return (
    <div className="mb-2 aspect-video overflow-hidden rounded bg-muted">
      {thumbnail ? (
        <img
          alt={value.filename}
          className="size-full object-cover"
          src={thumbnail}
        />
      ) : (
        <div className="grid size-full place-items-center">
          <ImageIcon aria-hidden className="size-5 text-muted-foreground/60" />
        </div>
      )}
    </div>
  );
}
