"use client";

/**
 * [INPUT]: Depends on host-injected UI text, shared DropdownMenu/InputGroup/Spinner/Tooltip primitives, and the AI SDK ChatStatus type
 * [OUTPUT]: Provides PromptInput header/footer/tools layout, tooltip-aware buttons, the action menu family, and the localized `preferSubmit`-aware submit/stop control
 * [POS]: ai-elements is a non-business visual control layer of PromptInput; Form transactions and provider status held by sibling files
 */

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@ai-chat/ui/components/ui/dropdown-menu";
import {
  InputGroupAddon,
  InputGroupButton,
} from "@ai-chat/ui/components/ui/input-group";
import { Spinner } from "@ai-chat/ui/components/ui/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@ai-chat/ui/components/ui/tooltip";
import { cn } from "@ai-chat/ui/lib/utils";
import { useUiText } from "@ai-chat/ui/lib/ui-text";
import type { ChatStatus } from "ai";
import { ArrowUpIcon, PlusIcon, SquareIcon, XIcon } from "lucide-react";
import {
  Children,
  useCallback,
  type ComponentProps,
  type HTMLAttributes,
  type MouseEvent,
  type ReactNode,
} from "react";

export type PromptInputHeaderProps = Omit<
  ComponentProps<typeof InputGroupAddon>,
  "align"
>;

export const PromptInputHeader = ({
  className,
  ...props
}: PromptInputHeaderProps) => (
  <InputGroupAddon
    align="block-end"
    className={cn("order-first flex-wrap gap-1", className)}
    {...props}
  />
);

export type PromptInputFooterProps = Omit<
  ComponentProps<typeof InputGroupAddon>,
  "align"
>;

export const PromptInputFooter = ({
  className,
  ...props
}: PromptInputFooterProps) => (
  <InputGroupAddon
    align="block-end"
    className={cn("justify-between gap-1", className)}
    {...props}
  />
);

export type PromptInputToolsProps = HTMLAttributes<HTMLDivElement>;

export const PromptInputTools = ({
  className,
  ...props
}: PromptInputToolsProps) => (
  <div
    className={cn("flex min-w-0 items-center gap-1", className)}
    {...props}
  />
);

export type PromptInputButtonTooltip =
  | string
  | {
      content: ReactNode;
      shortcut?: string;
      side?: ComponentProps<typeof TooltipContent>["side"];
    };

export type PromptInputButtonProps = ComponentProps<typeof InputGroupButton> & {
  tooltip?: PromptInputButtonTooltip;
};

export const PromptInputButton = ({
  variant = "ghost",
  size,
  tooltip,
  ...props
}: PromptInputButtonProps) => {
  const newSize =
    size ?? (Children.count(props.children) > 1 ? "sm" : "icon-sm");
  const button = (
    <InputGroupButton
      size={newSize}
      type="button"
      variant={variant}
      {...props}
    />
  );
  if (!tooltip) return button;

  const tooltipContent =
    typeof tooltip === "string" ? tooltip : tooltip.content;
  const shortcut = typeof tooltip === "string" ? undefined : tooltip.shortcut;
  const side = typeof tooltip === "string" ? "top" : (tooltip.side ?? "top");
  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side={side}>
        {tooltipContent}
        {shortcut && (
          <span className="ml-2 text-muted-foreground">{shortcut}</span>
        )}
      </TooltipContent>
    </Tooltip>
  );
};

export type PromptInputActionMenuProps = ComponentProps<typeof DropdownMenu>;
export const PromptInputActionMenu = (props: PromptInputActionMenuProps) => (
  <DropdownMenu {...props} />
);

export type PromptInputActionMenuTriggerProps = PromptInputButtonProps;
export const PromptInputActionMenuTrigger = ({
  children,
  ...props
}: PromptInputActionMenuTriggerProps) => (
  <DropdownMenuTrigger asChild>
    <PromptInputButton {...props}>
      {children ?? <PlusIcon className="size-4" />}
    </PromptInputButton>
  </DropdownMenuTrigger>
);

export type PromptInputActionMenuContentProps = ComponentProps<
  typeof DropdownMenuContent
>;
export const PromptInputActionMenuContent = (
  props: PromptInputActionMenuContentProps
) => <DropdownMenuContent align="start" {...props} />;

export type PromptInputActionMenuItemProps = ComponentProps<
  typeof DropdownMenuItem
>;
export const PromptInputActionMenuItem = (
  props: PromptInputActionMenuItemProps
) => <DropdownMenuItem {...props} />;

export type PromptInputSubmitProps = ComponentProps<typeof InputGroupButton> & {
  status?: ChatStatus;
  onStop?: () => void;
  /**
   * 编辑区里有待发内容且此刻发得出去。为真时提交压过状态图标——生成中打的
   * 字总要有个去处（队列），而「停止」在那一刻不再是唯一能做的事。
   */
  preferSubmit?: boolean;
};

export const PromptInputSubmit = ({
  variant = "default",
  size = "icon-sm",
  status,
  onStop,
  onClick,
  children,
  preferSubmit = false,
  ...props
}: PromptInputSubmitProps) => {
  const stopLabel = useUiText("stop", "Stop");
  const submitLabel = useUiText("submit", "Submit");
  /* 按钮表达「此刻最该做的事」，不是「turn 处于什么状态」。有待发内容时
     状态图标一律没有话语权——否则用户打完字盯着一个方块，不知道回车会去
     哪里。停止只在没东西可发时独占这个位置。 */
  const stopping =
    !preferSubmit && (status === "submitted" || status === "streaming");
  let Icon = <ArrowUpIcon className="size-[18px]" />;
  if (!preferSubmit) {
    if (status === "submitted") Icon = <Spinner />;
    else if (status === "streaming") {
      Icon = <SquareIcon className="size-3 fill-current stroke-none" />;
    } else if (status === "error") Icon = <XIcon className="size-4" />;
  }

  const handleClick = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      if (stopping && onStop) {
        event.preventDefault();
        onStop();
        return;
      }
      onClick?.(event);
    },
    [stopping, onClick, onStop]
  );
  return (
    <InputGroupButton
      aria-label={stopping ? stopLabel : submitLabel}
      onClick={handleClick}
      size={size}
      type={stopping && onStop ? "button" : "submit"}
      variant={variant}
      {...props}
    >
      {children ?? Icon}
    </InputGroupButton>
  );
};
