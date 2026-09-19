/**
 * [INPUT]: Depends on the canonical BaseCellContext, React refs/state, dnd-kit mouse and long-press touch sensors, react-virtual, shared grouping, InlineNameInput, Kanban field projection, card rendering, and mutation outcomes
 * [OUTPUT]: Provides BaseKanbanView with canonical computed/relation values, virtualized lanes, option management, and LWW drag patches
 * [POS]: Shared Base presentation in ui/views/kanban.
 */

import { SlimScroller } from "@ai-chat/ui/components/ui/slim-scroller";
import { useMemo, useRef, useState } from "react";
import { useAppTranslation } from "../../platform/i18n";
import type { BaseMutationOutcome } from "../../state/base-mutation-error";
import { createPortal } from "react-dom";
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { useVirtualizer } from "@tanstack/react-virtual";
import { CheckIcon, KanbanIcon, PencilIcon, PlusIcon } from "lucide-react";
import { Button } from "@ai-chat/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@ai-chat/ui/components/ui/dropdown-menu";
import { cn } from "@ai-chat/ui/lib/utils";
import type {
  BaseCellContext,
  BaseColumn,
  BaseColumnType,
  BaseRow,
  BaseRowPatch,
  BaseSelectOption,
} from "@ai-chat/base-ui/model/bases-ipc";
import {
  groupBaseRows,
} from "@ai-chat/base-ui/model/bases-ipc";
import {
  baseActionButtonClass,
  baseMenuItemHoverClass,
} from "../../chrome/base-toolbar";
import { InlineNameInput } from "../../chrome/inline-name-input";
import {
  KANBAN_CARD_CLASS,
  KanbanCard,
  KanbanCardBody,
  type KanbanAttachmentOwner,
} from "./kanban-card";
import {
  KANBAN_TONE_CHOICES,
  kanbanCardFace,
  kanbanFaceSpec,
  selectTone,
  type KanbanFaceSpec,
  type KanbanTone,
} from "./kanban-fields";

type Lane = ReturnType<typeof groupBaseRows>[number];

// Lanes keep their 18rem desktop width but never exceed the scroller (100cqw) minus the gutter, so a phone shows one
// lane plus a peek of the next and snaps lane by lane.
const LANE_WIDTH_CLASS = "w-[min(18rem,calc(100cqw-1.5rem))] snap-start";
const CARD_WIDTH_CLASS = "w-[min(17.75rem,calc(100vw-2.5rem))]";
// Mouse drags start after a small travel; touch drags start on a long press so lanes keep scrolling
// with a plain swipe. A single PointerSensor would win the race with its distance rule before the
// press could complete, which is why the two sensors are separate.
export const KANBAN_MOUSE_ACTIVATION = { distance: 5 } as const;
export const KANBAN_TOUCH_ACTIVATION = { delay: 250, tolerance: 5 } as const;

export function BaseKanbanView({
  columns,
  context,
  rows,
  groupByColumnId,
  visibleColumnIds,
  busy = false,
  chatId,
  incarnationId,
  onPatch,
  onAddColumn,
  onAddRow,
  onUpdateOption,
  onOpenRow,
}: {

  columns: BaseColumn[];
  context: BaseCellContext;
  rows: BaseRow[];
  groupByColumnId?: string;

  visibleColumnIds?: string[];
  busy?: boolean;
  chatId?: string;
  incarnationId?: string;

  onPatch?(rowId: string, patch: BaseRowPatch): Promise<BaseMutationOutcome>;
  onAddColumn?(type: BaseColumnType): Promise<BaseMutationOutcome>;
  onAddRow?(values: BaseRow["values"]): Promise<BaseMutationOutcome>;

  onUpdateOption?(
    columnId: string,
    optionId: string,
    patch: Partial<Pick<BaseSelectOption, "label" | "color">>
  ): Promise<BaseMutationOutcome>;
  /** Tap or Enter on a card; the only way into a record on touch, where there is no double-click. */
  onOpenRow?(row: BaseRow): void;
}) {
  const { t } = useAppTranslation();

  const group = useMemo(() => {
    const selectColumns = columns.filter((column) => column.type === "select");
    return (
      selectColumns.find((column) => column.id === groupByColumnId) ??
      selectColumns[0]
    );
  }, [columns, groupByColumnId]);
  const lanes = useMemo(
    () => (group ? groupBaseRows(rows, group, context) : []),
    [context, group, rows]
  );
  const laneIds = useMemo(() => new Set(lanes.map((lane) => lane.id)), [lanes]);

  const spec = useMemo(
    () => kanbanFaceSpec(columns, group?.id ?? "", visibleColumnIds),
    [columns, group?.id, visibleColumnIds]
  );

  const sensors = useSensors(
    useSensor(MouseSensor, {
      activationConstraint: onPatch
        ? KANBAN_MOUSE_ACTIVATION
        : { distance: Number.POSITIVE_INFINITY },
    }),
    useSensor(TouchSensor, {
      activationConstraint: onPatch
        ? KANBAN_TOUCH_ACTIVATION
        : { distance: Number.POSITIVE_INFINITY },
    })
  );
  const [activeRowId, setActiveRowId] = useState("");
  const activeRow = useMemo(
    () => (activeRowId ? rows.find((row) => row.id === activeRowId) : undefined),
    [activeRowId, rows]
  );
  const activeFace = useMemo(
    () => (activeRow ? kanbanCardFace(activeRow, spec, context) : null),
    [activeRow, context, spec]
  );
  if (!group) {
    return (
      <div className="grid flex-1 place-items-center p-8">
        <div className="flex flex-col items-center gap-3 text-center">
          <KanbanIcon className="size-8 text-muted-foreground/50" />
          <p className="text-muted-foreground text-sm">
            {t("bases.kanban.hint")}
          </p>
          {onAddColumn && (
            <Button
              className="cursor-pointer"
              disabled={busy}
              onClick={() => void onAddColumn("select")}
              size="sm"
              type="button"
              variant="outline"
            >
              <PlusIcon />
              {t("bases.kanban.addColumn")}
            </Button>
          )}
        </div>
      </div>
    );
  }
  const owner =
    chatId && incarnationId ? { chatId, incarnationId } : undefined;
  const dragStart = (event: DragStartEvent) =>
    setActiveRowId(String(event.active.id));
  const dragEnd = (event: DragEndEvent) => {
    setActiveRowId("");
    const rowId = String(event.active.id);
    const laneId = event.over ? String(event.over.id) : "";
    if (!laneIds.has(laneId)) return;
    void onPatch?.(rowId, { [group.id]: laneId === "__none__" ? null : laneId });
  };

  return (
    <DndContext
      onDragCancel={() => setActiveRowId("")}
      onDragEnd={dragEnd}
      onDragStart={dragStart}
      sensors={sensors}
    >
      <SlimScroller className="@container/kanban flex min-h-0 flex-1 gap-3 overflow-x-auto scroll-pl-4 px-4 py-3 @max-[40rem]/kanban:snap-x @max-[40rem]/kanban:snap-mandatory @[40rem]/kanban:gap-5">
        {lanes.map((lane) => (
          <KanbanLane
            key={lane.id}
            busy={busy}
            cellContext={context}
            lane={lane}
            label={
              lane.unassigned ? t("bases.group.unassigned") : lane.label
            }
            onAddRow={
              onAddRow &&
              (() =>
                onAddRow(
                  lane.id === "__none__" ? {} : { [group.id]: lane.id }
                ))
            }

            onUpdate={
              onUpdateOption && lane.id !== "__none__"
                ? (patch) => onUpdateOption(group.id, lane.id, patch)
                : undefined
            }
            onOpenRow={onOpenRow}
            option={group.options?.find((option) => option.id === lane.id)}
            owner={owner}
            spec={spec}
            tone={selectTone(group, lane.id)}
          />
        ))}
      </SlimScroller>

      {createPortal(
        <DragOverlay dropAnimation={null}>
          {activeFace ? (
            <article
              className={`${KANBAN_CARD_CLASS} ${CARD_WIDTH_CLASS} cursor-grabbing shadow-md`}
            >
              <KanbanCardBody face={activeFace} owner={owner} />
            </article>
          ) : null}
        </DragOverlay>,
        document.body
      )}
    </DndContext>
  );
}

function KanbanLane({
  cellContext,
  lane,
  label,
  option,
  spec,
  tone,
  owner,
  busy,
  onAddRow,
  onUpdate,
  onOpenRow,
}: {
  cellContext: BaseCellContext;
  lane: Lane;
  label: string;
  option?: BaseSelectOption;
  spec: KanbanFaceSpec;
  tone: KanbanTone;
  owner?: KanbanAttachmentOwner;
  busy: boolean;
  onAddRow?: () => Promise<BaseMutationOutcome>;
  onUpdate?(
    patch: Partial<Pick<BaseSelectOption, "label" | "color">>
  ): Promise<BaseMutationOutcome>;
  onOpenRow?(row: BaseRow): void;
}) {
  const { t } = useAppTranslation();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [renaming, setRenaming] = useState(false);
  const { setNodeRef, isOver } = useDroppable({ id: lane.id });


  const virtualizer = useVirtualizer({
    count: lane.rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => (spec.coverColumn ? 200 : 92),
    overscan: 5,
    initialRect: { width: 288, height: 480 },
  });

  return (
    <section
      ref={setNodeRef}
      className={`flex ${LANE_WIDTH_CLASS} shrink-0 flex-col rounded-xl transition-colors ${isOver ? "bg-muted/60" : ""}`}
      data-lane-id={lane.id}
    >
      <header className="flex h-9 shrink-0 items-center gap-1.5 px-1.5 text-xs">
        <KanbanLaneDot
          busy={busy}
          color={option?.color}
          label={label}
          onPick={onUpdate && ((color) => onUpdate({ color }))}
          onRename={onUpdate && (() => setRenaming(true))}
          tone={tone}
        />

        {renaming && onUpdate ? (
          <InlineNameInput
            ariaLabel={t("bases.kanban.renameAria", { lane: label })}
            autoFocus
            className="h-6 min-w-0 flex-1 px-1.5 text-xs"
            name={label}
            onDone={() => setRenaming(false)}
            onRename={(label) => onUpdate({ label })}
          />
        ) : (
          <span
            className={cn(
              "min-w-0 flex-1 truncate font-medium",
              onUpdate && "cursor-text"
            )}
            onDoubleClick={onUpdate && (() => setRenaming(true))}
            title={
              onUpdate
                ? t("bases.kanban.renameHint", { lane: label })
                : label
            }
          >
            {label}
          </span>
        )}
        <span className="shrink-0 tabular-nums text-muted-foreground">
          {lane.rows.length}
        </span>
        {onAddRow && (
          <button
            aria-label={t("bases.kanban.addCardTo", { lane: label })}
            className={baseActionButtonClass}
            disabled={busy}
            onClick={() => void onAddRow()}
            title={t("bases.kanban.addCard")}
            type="button"
          >
            <PlusIcon className="size-3.5" />
          </button>
        )}
      </header>

      <SlimScroller
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-0.5 pb-1"
      >
        <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((item) => {
            const row = lane.rows[item.index]!;
            return (
              <KanbanCard
                key={row.id}
                cellContext={cellContext}
                index={item.index}
                measure={virtualizer.measureElement}
                onOpen={onOpenRow && (() => onOpenRow(row))}
                owner={owner}
                row={row}
                spec={spec}
                top={item.start}
              />
            );
          })}
        </div>

        {lane.rows.length === 0 && <KanbanLaneEmpty busy={busy} onAddRow={onAddRow} />}
      </SlimScroller>
    </section>
  );
}

function KanbanLaneDot({
  tone,
  color,
  label,
  busy,
  onPick,
  onRename,
}: {
  tone: KanbanTone;
  color?: string;
  label: string;
  busy: boolean;
  onPick?(color: string | undefined): Promise<BaseMutationOutcome>;
  onRename?(): void;
}) {
  const { t } = useAppTranslation();
  const dot = <span className={`size-2 shrink-0 rounded-full ${tone.dot}`} />;
  if (!onPick) return dot;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          aria-label={t("bases.kanban.laneMenu", { lane: label })}
          className="grid size-5 shrink-0 cursor-pointer place-items-center rounded transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50 pointer-coarse:size-8"
          disabled={busy}
          title={t("bases.kanban.laneColor")}
          type="button"
        >
          {dot}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-36">
        {/* Rename lives in the menu because double-click has no touch equivalent. */}
        {onRename && (
          <>
            <DropdownMenuItem className={baseMenuItemHoverClass} onSelect={onRename}>
              <PencilIcon className="size-3.5" />
              {t("bases.kanban.renameItem")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuLabel>{t("bases.kanban.laneColor")}</DropdownMenuLabel>
        <DropdownMenuItem
          className={baseMenuItemHoverClass}
          onSelect={() => void onPick(undefined)}
        >
          <CheckIcon className={cn("size-3.5", color && "opacity-0")} />
          {t("bases.kanban.auto")}
        </DropdownMenuItem>
        {KANBAN_TONE_CHOICES.map((choice) => (
          <DropdownMenuItem
            key={choice.color}
            className={baseMenuItemHoverClass}
            onSelect={() => void onPick(choice.color)}
          >
            <CheckIcon
              className={cn("size-3.5", choice.color !== color && "opacity-0")}
            />
            <span className={`size-2 rounded-full ${choice.tone.dot}`} />
            {t(`bases.kanban.color.${choice.color}`)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function KanbanLaneEmpty({
  busy,
  onAddRow,
}: {
  busy: boolean;
  onAddRow?: () => Promise<BaseMutationOutcome>;
}) {
  const { t } = useAppTranslation();
  const className =
    "flex h-20 w-full items-center justify-center gap-1 rounded-lg border border-dashed text-[11px] text-muted-foreground";
  if (!onAddRow) return <div className={className}>{t("bases.kanban.dropHere")}</div>;
  return (
    <button
      className={`${className} cursor-pointer transition-colors hover:border-foreground/25 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50`}
      disabled={busy}
      onClick={() => void onAddRow()}
      type="button"
    >
      <PlusIcon aria-hidden className="size-3.5" />
      {t("bases.kanban.addCard")}
    </button>
  );
}
