/**
 * [INPUT]: Depends on dnd-kit useDraggable, editors useBaseAttachmentThumbnail, kanban-fields kanbanCardFace projection and tones
 * [OUTPUT]: Provides KanbanCard (window slot + dragging card area) √KanbanCardBody (card only format, shared with DragOverlay) and KANBAN_CARD_CLASS
 * [POS]: The card rendering layer of views/kanban; Canban-fields only show the face, not the column type
 */

import { useMemo } from "react";
import { useDraggable } from "@dnd-kit/core";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { ImageIcon } from "lucide-react";
import type {
  BaseAttachmentValue,
  BaseCellContext,
  BaseRow,
} from "../../../../../shared/bases-ipc";
import { useBaseAttachmentThumbnail } from "../../editors/cells/base-cell-editor";
import {
  kanbanCardFace,
  KANBAN_NEUTRAL_TONE,
  type KanbanCardFace,
  type KanbanFaceSpec,
} from "./kanban-fields";

export type KanbanAttachmentOwner = { chatId: string; incarnationId: string };

/* 卡面唯一表面：lane 内卡片与 DragOverlay 副本共用，两者不许各写一份。
 * lane 自身不画框，卡片是这块板上唯一的「盒子」——边框 + 微阴影足以让它
 * 从画布上浮起来，多一层容器只会变成卡片套卡片。 */
export const KANBAN_CARD_CLASS =
  "rounded-lg border bg-background p-3 text-xs shadow-xs";

/** 封面按 16:9 预留高度：图未到就先占位，虚拟化不会在加载完成那一刻抖一下。 */
const COVER_MAX_EDGE = 480;

export function KanbanCard({
  cellContext,
  row,
  spec,
  owner,
  index,
  top,
  measure,
}: {
  cellContext: BaseCellContext;
  row: BaseRow;
  spec: KanbanFaceSpec;
  owner?: KanbanAttachmentOwner;
  index: number;
  top: number;
  measure(node: Element | null): void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: row.id,
  });
  /* 卡面是一次投影而不是一次读取：relation 要回查目标行、formula 要求值。
     不 memo 就等于每一次无关重渲染都替整屏卡片重算一遍。 */
  const face = useMemo(
    () => kanbanCardFace(row, spec, cellContext),
    [cellContext, row, spec]
  );
  /* 被测量的是外层槽位而非卡片本身：虚拟化按 item.start 摆放、item 高度即
   * measureElement 的读数，两者一旦同体，卡片就首尾相接、连一条缝都没有。
   * 把 pb-2 放进槽位，间距便计入测量，卡片之间自然透气——而不是靠给每张卡
   * 加 margin 去和「最后一张多出一截」这种特殊情况纠缠。
   * 拖动位移由顶层 DragOverlay 呈现；源卡片原位淡出作占位。 */
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
        className={`${KANBAN_CARD_CLASS} cursor-grab transition-shadow hover:shadow-sm active:cursor-grabbing`}
        style={{ opacity: isDragging ? 0.35 : 1 }}
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
