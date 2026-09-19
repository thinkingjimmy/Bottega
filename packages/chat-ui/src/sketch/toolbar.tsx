/**
 * [INPUT]: Depends on shared Button/Popover/Tooltip primitives, shape/tool enums, and editor state.
 * [OUTPUT]: Provides a close-only leading header, a compact localized tool strip, shapes/history, and an accessible vertical width slider.
 * [POS]: Floating Sketch controls above the canvas; controls consume their own input and never enter exported images.
 */
import {
  ArrowUpRightIcon,
  CircleIcon,
  DiamondIcon,
  EraserIcon,
  HeartIcon,
  MinusIcon,
  MousePointer2Icon,
  PencilIcon,
  RectangleHorizontalIcon,
  Redo2Icon,
  ShapesIcon,
  StarIcon,
  TriangleIcon,
  TypeIcon,
  Undo2Icon,
  XIcon,
  type LucideIcon,
} from "lucide-react";
import type { ComponentProps, KeyboardEvent } from "react";
import { Button } from "@ai-chat/ui/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@ai-chat/ui/components/ui/tooltip";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@ai-chat/ui/components/ui/popover";
import { useSketchTranslation as useAppTranslation } from "./platform";
import { SHAPE_TYPES, type ShapeType } from "./model/document";
import type { SketchEditor } from "./editor/state";
export function SketchButton({
  label,
  icon: Icon,
  ...props
}: ComponentProps<typeof Button> & { label: string; icon: LucideIcon }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          {...props}
          aria-label={label}
          className={"size-11 shrink-0 rounded-full " + (props.className ?? "")}
        >
          <Icon className="size-5" aria-hidden="true" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
const shapeIcons: Record<ShapeType, LucideIcon> = {
  line: MinusIcon,
  arrow: ArrowUpRightIcon,
  rectangle: RectangleHorizontalIcon,
  circle: CircleIcon,
  triangle: TriangleIcon,
  diamond: DiamondIcon,
  star: StarIcon,
  heart: HeartIcon,
};
function moveFocus(
  event: KeyboardEvent<HTMLElement>,
  selector: string,
  columns = 1,
) {
  const delta =
    event.key === "ArrowRight"
      ? 1
      : event.key === "ArrowLeft"
        ? -1
        : event.key === "ArrowDown"
          ? columns
          : event.key === "ArrowUp"
            ? -columns
            : 0;
  if (!delta) return;
  event.preventDefault();
  event.stopPropagation();
  const buttons = [
    ...event.currentTarget.querySelectorAll<HTMLButtonElement>(selector),
  ].filter((button) => !button.disabled);
  const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
  buttons[(index + delta + buttons.length) % buttons.length]?.focus();
}
export function SketchToolbar({ editor }: { editor: SketchEditor }) {
  const { t } = useAppTranslation();
  const shapeLabels: Record<ShapeType, string> = {
    line: t("sketch.shape.line"),
    arrow: t("sketch.shape.arrow"),
    rectangle: t("sketch.shape.rectangle"),
    circle: t("sketch.shape.circle"),
    triangle: t("sketch.shape.triangle"),
    diamond: t("sketch.shape.diamond"),
    star: t("sketch.shape.star"),
    heart: t("sketch.shape.heart"),
  };
  const tools = [
    { tool: "select", icon: MousePointer2Icon, label: t("sketch.select") },
    { tool: "pen", icon: PencilIcon, label: t("sketch.pen") },
    { tool: "text", icon: TypeIcon, label: t("sketch.text") },
    { tool: "shape", icon: ShapesIcon, label: t("sketch.shapeTool") },
    { tool: "eraser", icon: EraserIcon, label: t("sketch.eraser") },
  ] as const;
  return (
    <header className="sketch-header">
      <div className="sketch-exit flex">
        <SketchButton
          label={t("common.close")}
          icon={XIcon}
          disabled={editor.phase === "saving"}
          onClick={() => editor.requestClose()}
        />
      </div>
      <div
        className="sketch-tools flex items-center rounded-full"
        role="toolbar"
        aria-label={t("sketch.title")}
        onKeyDown={(event) => moveFocus(event, "[data-sketch-tool]")}
      >
        {tools.map(({ tool, icon, label }) => {
          const button = (
            <SketchButton
              data-sketch-tool={tool}
              label={label}
              icon={icon}
              aria-pressed={editor.tool === tool}
              tabIndex={editor.tool === tool ? 0 : -1}
              disabled={editor.blocked}
              className={editor.tool === tool ? "bg-foreground/7" : ""}
              onClick={() => {
                if (editor.chooseTool(tool) && tool === "shape") {
                  editor.patch({
                    popover: editor.popover === "shape" ? null : "shape",
                  });
                }
              }}
            />
          );
          return tool === "shape" ? (
            <Popover
              key={tool}
              open={editor.popover === "shape"}
              onOpenChange={(open) => {
                if (!open) {
                  editor.patch({ popover: null });
                }
              }}
            >
              <PopoverTrigger asChild>{button}</PopoverTrigger>
              <PopoverContent
                className="w-auto p-2"
                style={{
                  pointerEvents: editor.popover === "shape" ? "auto" : "none",
                }}
                onKeyDown={(event) =>
                  moveFocus(event, "[data-sketch-shape]", 4)
                }
              >
                <div
                  role="radiogroup"
                  aria-label={label}
                  className="grid grid-cols-4 gap-1"
                >
                  {SHAPE_TYPES.map((shape) => (
                    <SketchButton
                      key={shape}
                      data-sketch-shape={shape}
                      label={shapeLabels[shape]}
                      icon={shapeIcons[shape]}
                      role="radio"
                      aria-checked={editor.shape === shape}
                      className={
                        editor.shape === shape ? "bg-foreground/7" : ""
                      }
                      onClick={() => {
                        editor.patch({ shape, popover: null });
                      }}
                    />
                  ))}
                </div>
              </PopoverContent>
            </Popover>
          ) : (
            <span key={tool}>{button}</span>
          );
        })}
      </div>
      <div className="sketch-history flex justify-end gap-1">
        <SketchButton
          label={t("sketch.undo")}
          icon={Undo2Icon}
          disabled={
            editor.blocked ||
            !editor.history.undoSteps.length ||
            Boolean(editor.textDraft)
          }
          onClick={() => editor.undo()}
        />
        <SketchButton
          label={t("sketch.redo")}
          icon={Redo2Icon}
          disabled={
            editor.blocked ||
            !editor.history.redoSteps.length ||
            Boolean(editor.textDraft)
          }
          onClick={() => editor.undo(true)}
        />
      </div>
    </header>
  );
}
export function SketchWidth({ editor }: { editor: SketchEditor }) {
  const { t } = useAppTranslation(),
    eraser = editor.tool === "eraser",
    visible = eraser || editor.tool === "pen";
  const value = eraser ? editor.eraserWidth : editor.penWidth,
    min = eraser ? 8 : 1,
    max = eraser ? 96 : 48;
  return (
    <aside className="sketch-width-rail" aria-hidden={!visible}>
      {visible && (
        <label className="sketch-width-control">
          <span className="sr-only">
            {eraser ? t("sketch.eraserWidth") : t("sketch.penWidth")}
          </span>
          <span className="sketch-width-track" />
          <output className="sketch-width-value" aria-hidden="true">
            {value}
          </output>
          <input
            type="range"
            min={min}
            max={max}
            step={1}
            value={value}
            aria-label={eraser ? t("sketch.eraserWidth") : t("sketch.penWidth")}
            aria-valuetext={value + " px"}
            disabled={editor.blocked}
            onChange={(event) => {
              editor.patch(
                eraser
                  ? { eraserWidth: Number(event.target.value) }
                  : { penWidth: Number(event.target.value) },
              );
            }}
          />
        </label>
      )}
    </aside>
  );
}
