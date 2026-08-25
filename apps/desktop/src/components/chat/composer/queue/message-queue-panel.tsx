/**
 * [INPUT]: Depends on React, dnd-kit pointer/keyboard sensors, Steering Ability level and determination by QueueItem Steer, QueueItem and message-queue-row
 * [OUTPUT]: Provides high rolling limits, unlockable store reorder lock, step by step Steer, double lock, suspension/error status and aria-live announcements
 * [POS]: The narrow props of the composer/queue are the combination roots; Trailer vision and spacing are interacting with store access commands
 */

import { useEffect, useRef, useState } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragCancelEvent,
  type DragEndEvent,
  type DragStartEvent,
  type KeyboardCoordinateGetter,
} from "@dnd-kit/core";
import { PlayIcon, XIcon } from "lucide-react";
import type { QueueItem } from "@/lib/message-queue-model";
import { MessageQueueRow } from "./message-queue-row";
import { SlimScroller } from "@ai-chat/ui/components/ui/slim-scroller";

const verticalKeyboardCoordinates: KeyboardCoordinateGetter = (
  event,
  { currentCoordinates }
) => {
  if (event.code === "ArrowDown") {
    return { ...currentCoordinates, y: currentCoordinates.y + 40 };
  }
  if (event.code === "ArrowUp") {
    return { ...currentCoordinates, y: currentCoordinates.y - 40 };
  }
  return undefined;
};

export function MessageQueuePanel({
  items,
  paused,
  steerSupported,
  canSteer,
  queueError,
  onMove,
  onRemove,
  onEdit,
  onSteer,
  onResume,
  onDismissError,
  onResendAmbiguous,
  onRemoveAmbiguous,
  onReorderLock,
}: {
  items: QueueItem[];
  paused: boolean;
  steerSupported: boolean;
  canSteer: (item: QueueItem) => boolean;
  queueError: string | null;
  onMove(from: number, to: number): void;
  onRemove(id: string): void;
  onEdit(id: string): void;
  onSteer(id: string): void;
  onResume(): void;
  onDismissError(): void;
  onResendAmbiguous(id: string): void;
  onRemoveAmbiguous(id: string): void;
  onReorderLock(locked: boolean): void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: verticalKeyboardCoordinates })
  );
  const [activeId, setActiveId] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const reorderLockRef = useRef(onReorderLock);
  useEffect(() => {
    reorderLockRef.current = onReorderLock;
  }, [onReorderLock]);
  useEffect(
    () => () => {
      reorderLockRef.current(false);
    },
    []
  );
  if (!items.length) return null;
  const finish = (announcementText: string) => {
    setActiveId("");
    onReorderLock(false);
    setAnnouncement(announcementText);
  };
  const dragStart = (event: DragStartEvent) => {
    setActiveId(String(event.active.id));
    onReorderLock(true);
    setAnnouncement("已拾起排队消息，使用上下方向键调整位置");
  };
  const dragCancel = (_event: DragCancelEvent) => finish("已取消重排");
  const dragEnd = (event: DragEndEvent) => {
    const from = items.findIndex((item) => item.id === String(event.active.id));
    const to = items.findIndex((item) => item.id === String(event.over?.id ?? ""));
    if (from >= 0 && to >= 0) onMove(from, to);
    finish(from >= 0 && to >= 0 ? `已移动到第 ${to + 1} 条` : "位置未改变");
  };
  return (
    <section className="relative z-10 mx-3 -mb-px overflow-hidden rounded-t-xl border bg-background">
      <div aria-live="polite" className="sr-only">{announcement}</div>
      {paused && (
        <div className="flex items-center gap-2 border-b bg-muted/40 px-3 py-1.5 text-xs">
          <span className="min-w-0 flex-1 text-muted-foreground">队列已暂停</span>
          <button className="inline-flex items-center gap-1 hover:text-foreground" onClick={onResume} type="button">
            <PlayIcon className="size-3" />继续发送
          </button>
        </div>
      )}
      {queueError && (
        <div className="flex items-start gap-2 border-b px-3 py-1.5 text-destructive text-xs">
          <p className="min-w-0 flex-1">{queueError}</p>
          <button aria-label="关闭队列错误" onClick={onDismissError} type="button">
            <XIcon className="size-3.5" />
          </button>
        </div>
      )}
      <DndContext
        onDragCancel={dragCancel}
        onDragEnd={dragEnd}
        onDragStart={dragStart}
        sensors={sensors}
      >
        <SlimScroller className="max-h-48 overflow-y-auto">
          {items.map((item, index) => (
            <MessageQueueRow
              key={item.id}
              count={items.length}
              canSteer={canSteer(item)}
              steerSupported={steerSupported}
              dragging={activeId === item.id}
              index={index}
              item={item}
              onEdit={onEdit}
              onRemove={onRemove}
              onRemoveAmbiguous={onRemoveAmbiguous}
              onResendAmbiguous={onResendAmbiguous}
              onSteer={onSteer}
            />
          ))}
        </SlimScroller>
      </DndContext>
    </section>
  );
}
