"use client";

/**
 * [INPUT]: Depends on React pointer/keyboard events, i18n, and the BaseMutationOutcome contract
 * [OUTPUT]: Provides ColumnResizeHandle with localized semantics, live drag previews, and release-only commits
 * [POS]: Column-width interaction primitive for bases/views/table; Workbench owns persistent CAS updates
 */

import {
  useEffect,
  useRef,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import type { BaseMutationOutcome } from "../../state/base-mutation-error";
import { useHorizontalResize } from "@ai-chat/ui/hooks/use-horizontal-resize";
import {
  BASE_COLUMN_WIDTH_MAX,
  BASE_COLUMN_WIDTH_MIN,
} from "../../../../../shared/bases-ipc";

export function ColumnResizeHandle({
  busy,
  columnId,
  name,
  width,
  onActiveChange,
  onChange,
  onCancel,
  onCommit,
}: {
  busy?: boolean;
  columnId: string;
  name: string;
  width: number;
  onActiveChange(active: boolean): void;
  onChange(width: number): void;
  onCancel(): void;
  /** workbench 收口 intent：判决即返回值，永不 reject */
  onCommit(width: number): Promise<BaseMutationOutcome>;
}) {
  const { t } = useAppTranslation();
  const currentWidthRef = useRef(width);
  useEffect(() => {
    currentWidthRef.current = width;
  }, [width]);
  const resize = useHorizontalResize({
    enabled: !busy,
    open: true,
    setOpen: () => {},
    width,
    minWidth: BASE_COLUMN_WIDTH_MIN,
    maxWidth: BASE_COLUMN_WIDTH_MAX,
    direction: 1,
    onWidthChange: (nextWidth) => {
      currentWidthRef.current = nextWidth;
      onChange(nextWidth);
    },
  });
  const start = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    currentWidthRef.current = width;
    onActiveChange(true);
    resize.start(event);
  };
  const finish = (
    event: PointerEvent<HTMLButtonElement>,
    commit: boolean
  ) => {
    resize.finish(event);
    onActiveChange(false);
    if (commit) void onCommit(currentWidthRef.current);
  };
  const keyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const direction = event.key === "ArrowLeft" ? -1 : 1;
    const nextWidth = clampColumnWidth(
      width + direction * (event.shiftKey ? 16 : 8)
    );
    currentWidthRef.current = nextWidth;
    onChange(nextWidth);
    void onCommit(nextWidth);
  };
  return (
    <button
      aria-label={t("bases.table.resizeAria", { column: name })}
      aria-orientation="vertical"
      aria-valuemax={BASE_COLUMN_WIDTH_MAX}
      aria-valuemin={BASE_COLUMN_WIDTH_MIN}
      aria-valuenow={width}
      className="absolute top-0 right-0 z-20 h-full w-2 translate-x-1/2 cursor-col-resize touch-none border-0 bg-transparent p-0 outline-none after:absolute after:top-0 after:bottom-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:bg-transparent hover:after:bg-ring focus-visible:outline-none focus-visible:after:bg-ring data-[active=true]:after:bg-ring"
      data-active={resize.active}
      data-column-resize={columnId}
      disabled={busy}
      onKeyDown={keyDown}
      onLostPointerCapture={(event) => finish(event, false)}
      onPointerCancel={(event) => {
        finish(event, false);
        onCancel();
      }}
      onPointerDown={start}
      onPointerMove={resize.move}
      onPointerUp={(event) => finish(event, true)}
      role="separator"
      title={t("bases.table.resizeHint")}
      type="button"
    />
  );
}

function clampColumnWidth(width: number) {
  return Math.min(
    BASE_COLUMN_WIDTH_MAX,
    Math.max(BASE_COLUMN_WIDTH_MIN, Math.round(width))
  );
}
