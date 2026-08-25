/**
 * [INPUT]: Depends on dnd-kit draggable/droppable, lucide, icons, steering, ability to move and turn, double-blocking, QueueItem/editableItem
 * [OUTPUT]: Provides accessible single message queue rows, ability to render in presence and only active turn, available Steer, drag/Edit/Delete and discrete decision buttons
 * [POS]: The composer/queue atomic line view; Not reading session controller or external store
 */

import { useDraggable, useDroppable } from "@dnd-kit/core";
import {
  CornerDownRightIcon,
  GripVerticalIcon,
  PencilIcon,
  RotateCcwIcon,
  Trash2Icon,
} from "lucide-react";
import { editableItem, type QueueItem } from "@/lib/message-queue-model";

const iconButton =
  "grid size-7 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-35";

export function MessageQueueRow({
  item,
  index,
  count,
  dragging,
  steerSupported,
  canSteer,
  onRemove,
  onEdit,
  onSteer,
  onResendAmbiguous,
  onRemoveAmbiguous,
}: {
  item: QueueItem;
  index: number;
  count: number;
  dragging: boolean;
  /** 后端报了 steering 能力位——没有就不给这个动作，而不是给一个点不动的 */
  steerSupported: boolean;
  canSteer: boolean;
  onRemove(id: string): void;
  onEdit(id: string): void;
  onSteer(id: string): void;
  onResendAmbiguous(id: string): void;
  onRemoveAmbiguous(id: string): void;
}) {
  const {
    attributes,
    listeners,
    setActivatorNodeRef,
    setNodeRef: setDraggableNodeRef,
    transform,
  } = useDraggable({ id: item.id, disabled: !editableItem(item) });
  const {
    isOver,
    setNodeRef: setDroppableNodeRef,
  } = useDroppable({ id: item.id });
  const setRef = (element: HTMLDivElement | null) => {
    setDraggableNodeRef(element);
    setDroppableNodeRef(element);
  };
  const editable = editableItem(item);
  return (
    <div
      ref={setRef}
      className={[
        "relative flex min-w-0 items-center gap-1 border-b px-2 py-1.5 last:border-b-0",
        dragging ? "opacity-45" : "",
        isOver ? "before:absolute before:inset-x-2 before:top-0 before:h-px before:bg-foreground/40" : "",
      ].join(" ")}
      style={transform
        ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
        : undefined}
    >
      <button
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        aria-label={`拖动第 ${index + 1} 条，共 ${count} 条`}
        className={`${iconButton} cursor-grab touch-none active:cursor-grabbing`}
        disabled={!editable}
        type="button"
      >
        <GripVerticalIcon className="size-3.5" />
      </button>
      <p className="min-w-0 flex-1 truncate text-xs" title={item.prompt.displayText}>
        {item.prompt.displayText}
      </p>
      {item.state === "ambiguous" ? (
        <>
          <button
            aria-label="重发这条消息"
            className={iconButton}
            onClick={() => onResendAmbiguous(item.id)}
            type="button"
          >
            <RotateCcwIcon className="size-3.5" />
          </button>
          <button
            aria-label="删除这条歧义消息"
            className={iconButton}
            onClick={() => onRemoveAmbiguous(item.id)}
            type="button"
          >
            <Trash2Icon className="size-3.5" />
          </button>
        </>
      ) : (
        <>
          {steerSupported && (
            <button
              aria-label="立即插入当前运行任务"
              className={iconButton}
              disabled={!editable || !canSteer}
              onClick={() => onSteer(item.id)}
              type="button"
            >
              <CornerDownRightIcon className="size-3.5" />
            </button>
          )}
          <button
            aria-label="删除这条排队消息"
            className={iconButton}
            disabled={!editable}
            onClick={() => onRemove(item.id)}
            type="button"
          >
            <Trash2Icon className="size-3.5" />
          </button>
          <button
            aria-label="编辑这条排队消息"
            className={iconButton}
            disabled={!editable}
            onClick={() => onEdit(item.id)}
            type="button"
          >
            <PencilIcon className="size-3.5" />
          </button>
        </>
      )}
    </div>
  );
}
