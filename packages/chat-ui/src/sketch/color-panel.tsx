/**
 * [INPUT]: Depends on react-colorful, shared popovers, canonical sRGB presets, and transactional editor color changes.
 * [OUTPUT]: Provides isolated palette keyboard navigation, localized presets, white-canvas selection rings, a borderless color wheel, RGB validation, and transactional custom color.
 * [POS]: Lazy Sketch color controls; text color remains part of its uncommitted native editing copy.
 */
import { useEffect, useRef, useState } from "react";
import { HexColorPicker } from "react-colorful";
import { PipetteIcon } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@ai-chat/ui/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@ai-chat/ui/components/ui/tooltip";
import { Button } from "@ai-chat/ui/components/ui/button";
import { useSketchTranslation as useAppTranslation } from "./platform";
import { PRESET_COLORS } from "./model/document";
import type { SketchEditor } from "./editor/state";
function RgbChannel({
  index,
  editor,
  label,
}: {
  index: number;
  editor: SketchEditor;
  label: string;
}) {
  const current = parseInt(
    editor.color.slice(1 + index * 2, 3 + index * 2),
    16,
  );
  const [draft, setDraft] = useState({
    baseline: current,
    value: String(current),
  });
  const value = draft.baseline === current ? draft.value : String(current);
  const setValue = (value: string) => setDraft({ baseline: current, value });
  const commit = () => {
    if (!/^\d{1,3}$/.test(value) || Number(value) > 255) {
      setValue(String(current));
      return;
    }
    const start = 1 + index * 2;
    editor.setColor(
      editor.color.slice(0, start) +
        Number(value).toString(16).padStart(2, "0") +
        editor.color.slice(start + 2),
    );
  };
  return (
    <label className="flex min-w-0 flex-1 flex-col items-center gap-1 text-xs text-muted-foreground">
      {["R", "G", "B"][index]}
      <input
        aria-label={label}
        inputMode="numeric"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Enter" && !event.nativeEvent.isComposing) {
            event.preventDefault();
            commit();
          }
        }}
        className="h-11 w-full rounded-lg border bg-background px-1 text-center text-base text-foreground tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
    </label>
  );
}
export function SketchColors({ editor }: { editor: SketchEditor }) {
  const { t } = useAppTranslation(),
    panel = useRef<HTMLDivElement>(null);
  const visible =
    editor.tool !== "eraser" &&
    (editor.tool !== "select" ||
      Boolean(editor.selected) ||
      Boolean(editor.textDraft));
  useEffect(() => {
    const finish = () => editor.finishColor();
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
    return () => {
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
    };
  }, [editor]);
  useEffect(() => {
    panel.current
      ?.querySelectorAll("[role=slider]")
      .forEach((slider) =>
        slider.setAttribute(
          "aria-label",
          t("sketch.color", { value: editor.color }),
        ),
      );
  }, [editor.color, editor.popover, t]);
  if (!visible) return <div className="sketch-colors" />;
  return (
    <div
      className="sketch-colors flex flex-wrap items-center justify-center"
      role="toolbar"
      aria-label={t("sketch.customColor")}
      onKeyDown={(event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        event.stopPropagation();
        const buttons = [
          ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
            "[data-sketch-color]",
          ),
        ];
        const index = buttons.indexOf(
          document.activeElement as HTMLButtonElement,
        );
        buttons[
          (index + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) %
            buttons.length
        ]?.focus();
      }}
    >
      <Popover
        open={editor.popover === "color"}
        onOpenChange={(open) => {
          editor.finishColor();
          editor.patch({ popover: open ? "color" : null });
        }}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <button
                type="button"
                data-sketch-color="custom"
                aria-label={t("sketch.customColor")}
                disabled={editor.blocked}
                className="grid size-11 place-items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span
                  className="size-6 rounded-full"
                  style={{
                    background:
                      "conic-gradient(red, yellow, lime, cyan, blue, magenta, red)",
                  }}
                />
              </button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent>{t("sketch.customColor")}</TooltipContent>
        </Tooltip>
        <PopoverContent
          ref={panel}
          side="top"
          className="w-64 space-y-3"
          style={{
            pointerEvents: editor.popover === "color" ? "auto" : "none",
          }}
          onCloseAutoFocus={(event) => {
            if (editor.textDraft || editor.dropper) {
              event.preventDefault();
              if (!editor.dropper)
                document
                  .querySelector<HTMLTextAreaElement>("[data-sketch-text]")
                  ?.focus();
            }
          }}
        >
          <div onPointerDownCapture={() => editor.beginColor()}>
            <HexColorPicker
              color={editor.color}
              onChange={(color) => editor.setColor(color)}
              style={{ width: "100%", height: 160 }}
            />
          </div>
          <div className="flex gap-2">
            <RgbChannel index={0} editor={editor} label={t("sketch.red")} />
            <RgbChannel index={1} editor={editor} label={t("sketch.green")} />
            <RgbChannel index={2} editor={editor} label={t("sketch.blue")} />
          </div>
          <Button
            type="button"
            variant="outline"
            className="min-h-11 w-full"
            onClick={() => {
              editor.finishColor();
              editor.patch({ dropper: true, popover: null });
            }}
          >
            <PipetteIcon className="size-4" />
            {t("sketch.sampleColor")}
          </Button>
        </PopoverContent>
      </Popover>
      {PRESET_COLORS.map((color) => (
        <Tooltip key={color}>
          <TooltipTrigger asChild>
            <button
              type="button"
              data-sketch-color={color}
              aria-label={t("sketch.color", { value: color })}
              aria-pressed={editor.color === color}
              disabled={editor.blocked}
              onClick={() => editor.setColor(color)}
              className="grid size-11 place-items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span
                className={
                  "size-6 rounded-full border border-black/15 " +
                  (editor.color === color
                    ? "ring-2 ring-blue-600 ring-offset-2 ring-offset-white"
                    : "")
                }
                style={{ backgroundColor: color }}
              />
            </button>
          </TooltipTrigger>
          <TooltipContent>{t("sketch.color", { value: color })}</TooltipContent>
        </Tooltip>
      ))}
    </div>
  );
}
