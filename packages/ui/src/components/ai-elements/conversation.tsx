"use client";

/**
 * [INPUT]: Depends on use-stick-to-bottom, ui Button Original language and AI SDK UIMessage type
 * [OUTPUT]: Provides Conversation fixed horizontal boundary, sticky bottom scrolling container, empty bottom, back-end button, optional unlocking signal useScrollLockRelease and messagesToMarkdown to download
 * [POS]: The meeting of ai-elements rolled the skeleton; Unified prohibits whole sessions from rolling horizontally, and broad content from local containers within messages
 */

import { Button } from "@ai-chat/ui/components/ui/button";
import { cn } from "@ai-chat/ui/lib/utils";
import type { UIMessage } from "ai";
import { ArrowDownIcon, DownloadIcon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { createContext, useCallback, useContext } from "react";
import { StickToBottom, useStickToBottomContext } from "use-stick-to-bottom";

// 供消费方（如会话目录 minimap）访问滚动容器，无需直接依赖 use-stick-to-bottom
export { useStickToBottomContext };

// ─── 脱锁信号：容器内是真 stopScroll，容器外恒为 no-op ───
// turn 渲染器既服务会话流，也被 Base 全屏 dock 的 Latest turn 复用；后者没有
// 粘底容器，直接向 StickToBottom 要 context 会当场抛错、把整棵树打白。
// 「没有锁可脱」是事实而非异常，用哨兵默认值承接，调用点因此无需辨认容器身份。
const NO_SCROLL_LOCK = () => {};
const ScrollLockContext = createContext<() => void>(NO_SCROLL_LOCK);

export const useScrollLockRelease = () => useContext(ScrollLockContext);

const ScrollLockBridge = ({ children }: { children: ReactNode }) => {
  const { stopScroll } = useStickToBottomContext();
  return (
    <ScrollLockContext.Provider value={stopScroll}>
      {children}
    </ScrollLockContext.Provider>
  );
};

export type ConversationProps = Omit<
  ComponentProps<typeof StickToBottom>,
  "children"
> & { children?: ReactNode };

export const Conversation = ({
  className,
  children,
  ...props
}: ConversationProps) => (
  <StickToBottom
    className={cn("relative min-w-0 flex-1 overflow-y-hidden", className)}
    initial="smooth"
    resize="smooth"
    role="log"
    {...props}
  >
    <ScrollLockBridge>{children}</ScrollLockBridge>
  </StickToBottom>
);

export type ConversationContentProps = ComponentProps<
  typeof StickToBottom.Content
>;

export const ConversationContent = ({
  className,
  scrollClassName,
  ...props
}: ConversationContentProps) => (
  <StickToBottom.Content
    className={cn("flex w-full min-w-0 max-w-full flex-col gap-8 p-4", className)}
    scrollClassName={cn("overflow-x-hidden", scrollClassName)}
    {...props}
  />
);

export type ConversationEmptyStateProps = ComponentProps<"div"> & {
  title?: string;
  description?: string;
  icon?: React.ReactNode;
};

export const ConversationEmptyState = ({
  className,
  title = "No messages yet",
  description = "Start a conversation to see messages here",
  icon,
  children,
  ...props
}: ConversationEmptyStateProps) => (
  <div
    className={cn(
      "flex size-full flex-col items-center justify-center gap-3 p-8 text-center",
      className
    )}
    {...props}
  >
    {children ?? (
      <>
        {icon && <div className="text-muted-foreground">{icon}</div>}
        <div className="space-y-1">
          <h3 className="font-medium text-sm">{title}</h3>
          {description && (
            <p className="text-muted-foreground text-sm">{description}</p>
          )}
        </div>
      </>
    )}
  </div>
);

export type ConversationScrollButtonProps = ComponentProps<typeof Button>;

export const ConversationScrollButton = ({
  className,
  ...props
}: ConversationScrollButtonProps) => {
  const { isAtBottom, scrollToBottom } = useStickToBottomContext();

  const handleScrollToBottom = useCallback(() => {
    scrollToBottom();
  }, [scrollToBottom]);

  return (
    !isAtBottom && (
      <Button
        className={cn(
          "absolute bottom-4 left-[50%] translate-x-[-50%] rounded-full bg-background shadow-md hover:bg-accent dark:bg-background dark:hover:bg-muted",
          className
        )}
        onClick={handleScrollToBottom}
        size="icon"
        type="button"
        variant="outline"
        {...props}
      >
        <ArrowDownIcon className="size-4" />
      </Button>
    )
  );
};

const getMessageText = (message: UIMessage): string =>
  message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");

export type ConversationDownloadProps = Omit<
  ComponentProps<typeof Button>,
  "onClick"
> & {
  messages: UIMessage[];
  filename?: string;
  formatMessage?: (message: UIMessage, index: number) => string;
};

const defaultFormatMessage = (message: UIMessage): string => {
  const roleLabel =
    message.role.charAt(0).toUpperCase() + message.role.slice(1);
  return `**${roleLabel}:** ${getMessageText(message)}`;
};

export const messagesToMarkdown = (
  messages: UIMessage[],
  formatMessage: (
    message: UIMessage,
    index: number
  ) => string = defaultFormatMessage
): string => messages.map((msg, i) => formatMessage(msg, i)).join("\n\n");

export const ConversationDownload = ({
  messages,
  filename = "conversation.md",
  formatMessage = defaultFormatMessage,
  className,
  children,
  ...props
}: ConversationDownloadProps) => {
  const handleDownload = useCallback(() => {
    const markdown = messagesToMarkdown(messages, formatMessage);
    const blob = new Blob([markdown], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }, [messages, filename, formatMessage]);

  return (
    <Button
      className={cn(
        "absolute top-4 right-4 rounded-full dark:bg-background dark:hover:bg-muted",
        className
      )}
      onClick={handleDownload}
      size="icon"
      type="button"
      variant="outline"
      {...props}
    >
      {children ?? <DownloadIcon className="size-4" />}
    </Button>
  );
};
