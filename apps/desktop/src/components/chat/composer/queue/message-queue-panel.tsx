/**
 * [INPUT]: Depends on React, dnd-kit pointer/keyboard sensors, Chat composer i18n, QueueItem steering capability, and message-queue-row
 * [OUTPUT]: Provides localized bounded queue scrolling, reorder-lock cleanup, steering, pause/error status, and aria-live movement announcements
 * [POS]: Composer queue composition root; receives narrow state/actions and owns list interaction, status, and spacing
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
import { useAppTranslation } from "@/components/providers/i18n-provider";

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
  const { t } = useAppTranslation();
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
    setAnnouncement(t("chat.composer.queue.pickedUp"));
  };
  const dragCancel = (_event: DragCancelEvent) =>
    finish(t("chat.composer.queue.reorderCancelled"));
  const dragEnd = (event: DragEndEvent) => {
    const from = items.findIndex((item) => item.id === String(event.active.id));
    const to = items.findIndex((item) => item.id === String(event.over?.id ?? ""));
    if (from >= 0 && to >= 0) onMove(from, to);
    finish(
      from >= 0 && to >= 0
        ? t("chat.composer.queue.moved", { position: to + 1 })
        : t("chat.composer.queue.unchanged")
    );
  };
  return (
    <section className="relative z-10 mx-3 -mb-px overflow-hidden rounded-t-xl border bg-background">
      <div aria-live="polite" className="sr-only">{announcement}</div>
      {paused && (
        <div className="flex items-center gap-2 border-b bg-muted/40 px-3 py-1.5 text-xs">
          <span className="min-w-0 flex-1 text-muted-foreground">
            {t("chat.composer.queue.paused")}
          </span>
          <button className="inline-flex items-center gap-1 hover:text-foreground" onClick={onResume} type="button">
            <PlayIcon className="size-3" />
            {t("chat.composer.queue.resume")}
          </button>
        </div>
      )}
      {queueError && (
        <div className="flex items-start gap-2 border-b px-3 py-1.5 text-destructive text-xs">
          <p className="min-w-0 flex-1">{queueError}</p>
          <button
            aria-label={t("chat.composer.queue.dismissError")}
            onClick={onDismissError}
            type="button"
          >
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
