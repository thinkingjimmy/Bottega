"use client";

/**
 * [INPUT]: Depends on use-stick-to-bottom, ui Button/SlimScroller primitives, and cn
 * [OUTPUT]: Provides Conversation fixed horizontal boundary, unified-scrollbar sticky bottom container, back-to-bottom button, the re-exported useStickToBottomContext, and the optional unlocking signal useScrollLockRelease
 * [POS]: ai-elements' scroll-container skeleton; forbids the whole conversation from scrolling horizontally, confining wide content to its own local container inside a message
 */

import { Button } from "@ai-chat/ui/components/ui/button";
import { SlimScroller } from "@ai-chat/ui/components/ui/slim-scroller";
import { cn } from "@ai-chat/ui/lib/utils";
import { ArrowDownIcon } from "lucide-react";
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

export type ConversationContentProps = Omit<
  ComponentProps<typeof StickToBottom.Content>,
  "children"
> & { children?: ReactNode };

export const ConversationContent = ({
  children,
  className,
  scrollClassName,
  ...props
}: ConversationContentProps) => {
  const {
    scrollRef: setScrollElement,
    contentRef: setContentElement,
  } = useStickToBottomContext();
  return (
    <SlimScroller
      className={cn("overflow-x-hidden overflow-y-auto", scrollClassName)}
      ref={setScrollElement}
      style={{
        height: "100%",
        width: "100%",
        scrollbarGutter: "stable both-edges",
      }}
    >
      <div
        className={cn(
          "flex w-full min-w-0 max-w-full flex-col gap-8 p-4",
          className
        )}
        ref={setContentElement}
        {...props}
      >
        {children}
      </div>
    </SlimScroller>
  );
};

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
