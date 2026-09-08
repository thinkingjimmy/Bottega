"use client";

/**
 * [INPUT]: Depends on UI Button/Tooltip, host-injected UI text, streamdown/CJK, MessageRendererContext, and the message plugin loader
 * [OUTPUT]: Provides Message/MessageContent layout, MessageActions/MessageAction, and MessageResponse; stabilizes locale-key/plugin detection, streams code-only rendering while Math/Mermaid stay available, and applies syntax highlighting once in a single pass after streaming settles
 * [POS]: ai-elements' message-display family; a Message never overflows its parent content list, and MessageResponse only auto-links http/mailto and hides behind a full skeleton until its plugins are chosen. The default Markdown heading scale is re-anchored here to the text-sm body size (h1-h4 keep distinct sizes, h5/h6 collapse onto text-sm); other rendering contexts need their own scale. className is always merged last through cn's tw-merge so a caller's class wins without needing to guess specificity
 */

import { Button } from "@ai-chat/ui/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@ai-chat/ui/components/ui/tooltip";
import { cn } from "@ai-chat/ui/lib/utils";
import { useUiText } from "@ai-chat/ui/lib/ui-text";
import { cjk } from "@streamdown/cjk";
import type { UIMessage } from "ai";
import type { ComponentProps, HTMLAttributes } from "react";
import { memo, useEffect, useMemo, useState } from "react";
import { defaultRehypePlugins, Streamdown } from "streamdown";
import {
  detectOptionalPlugins,
  messagePluginLoader,
  selectOptionalPlugins,
  type OptionalPluginKey,
} from "./message/plugin-loader";
import { useMessageRenderers } from "./message/renderer-context";

export type MessageProps = HTMLAttributes<HTMLDivElement> & {
  from: UIMessage["role"];
};

export const Message = ({ className, from, ...props }: MessageProps) => (
  <div
    className={cn(
      "group flex w-full min-w-0 max-w-full flex-col gap-2",
      from === "user"
        ? "is-user ml-auto max-w-[80%] justify-end"
        : "is-assistant",
      className
    )}
    {...props}
  />
);

export type MessageContentProps = HTMLAttributes<HTMLDivElement>;

export const MessageContent = ({
  children,
  className,
  ...props
}: MessageContentProps) => (
  <div
    className={cn(
      "is-user:dark flex w-full min-w-0 max-w-full flex-col gap-2 overflow-hidden text-sm group-[.is-user]:w-fit",
      "group-[.is-user]:ml-auto group-[.is-user]:rounded-lg group-[.is-user]:bg-secondary group-[.is-user]:px-4 group-[.is-user]:py-3 group-[.is-user]:text-foreground",
      className
    )}
    {...props}
  >
    {children}
  </div>
);

export type MessageActionsProps = ComponentProps<"div">;

export const MessageActions = ({
  className,
  children,
  ...props
}: MessageActionsProps) => (
  <div className={cn("flex items-center gap-1", className)} {...props}>
    {children}
  </div>
);

export type MessageActionProps = ComponentProps<typeof Button> & {
  tooltip?: string;
  label?: string;
};

export const MessageAction = ({
  tooltip,
  children,
  label,
  variant = "ghost",
  size = "icon-sm",
  ...props
}: MessageActionProps) => {
  const button = (
    <Button size={size} type="button" variant={variant} {...props}>
      {children}
      <span className="sr-only">{label || tooltip}</span>
    </Button>
  );

  if (tooltip) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>{button}</TooltipTrigger>
          <TooltipContent>
            <p>{tooltip}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return button;
};

export type MessageResponseProps = ComponentProps<typeof Streamdown>;

function useMessagePlugins(
  markdown: string,
  enabled: boolean,
  languagesKey: string,
  codeEnabled: boolean
) {
  const detectedKey = useMemo(
    () =>
      enabled
        ? detectOptionalPlugins(
            markdown,
            JSON.parse(languagesKey) as string[]
          ).join(",")
        : "",
    [enabled, languagesKey, markdown]
  );
  const requestedKey = useMemo(
    () => selectOptionalPlugins(
      detectedKey
        .split(",")
        .filter(Boolean) as OptionalPluginKey[],
      codeEnabled
    ).join(","),
    [codeEnabled, detectedKey]
  );
  const requested = useMemo(
    () =>
      requestedKey
        ? (requestedKey.split(",") as OptionalPluginKey[])
        : [],
    [requestedKey]
  );
  const [, setRevision] = useState(0);
  const snapshot = messagePluginLoader.snapshot(requested);

  useEffect(() => {
    if (snapshot.settled) return;
    let active = true;
    void messagePluginLoader.load(requested).then(() => {
      if (active) setRevision((current) => current + 1);
    });
    return () => {
      active = false;
    };
  }, [requested, snapshot.settled]);

  return {
    plugins: { cjk, ...snapshot.plugins },
    settled: snapshot.settled,
  };
}

function MessageResponseLoading({ className }: { className?: string }) {
  const label = useUiText("loadingRichContent", "Loading rich content");
  return (
    <div
      aria-live="polite"
      className={cn("size-full space-y-2 py-1", className)}
      role="status"
    >
      <span className="sr-only">{label}</span>
      <div className="h-3 w-full animate-pulse rounded bg-muted" />
      <div className="h-3 w-5/6 animate-pulse rounded bg-muted" />
      <div className="h-3 w-2/3 animate-pulse rounded bg-muted" />
    </div>
  );
}

// ============================================================
// 链接降级策略：消息里只有 http(s)/mailto/页内锚点可点击
//
// streamdown 内置 rehype-harden 会拦截裸相对路径（如 todo/foo.md），
// 默认 indicator 策略追加 " [blocked]" 噪音文本。改为 text-only 静默
// 解包；"./"、"/" 前缀的相对路径能通过 harden 但点击必死（desktop 被
// 导航锁拦截、web 落 404），由 unwrapPlainLinks 统一解包为纯文本。
// ============================================================
const CLICKABLE_HREF = /^(?:https?:|mailto:|#)/i;

type HastNode = {
  type: string;
  tagName?: string;
  properties?: { href?: unknown };
  children?: HastNode[];
};

// 后序遍历：先处理子树再解包自身，嵌套链接一次拍平
const unwrapPlainLinks = () => (tree: HastNode) => {
  const walk = (node: HastNode) => {
    const kids = node.children;
    if (!kids) return;
    for (let i = kids.length - 1; i >= 0; i -= 1) {
      const kid = kids[i];
      walk(kid);
      if (
        kid.type === "element" &&
        kid.tagName === "a" &&
        !CLICKABLE_HREF.test(String(kid.properties?.href ?? ""))
      ) {
        kids.splice(i, 1, ...(kid.children ?? []));
      }
    }
  };
  walk(tree);
};

// 复用 streamdown 的 harden 默认配置，仅覆盖拦截策略，避免默认值漂移
const [hardenPlugin, hardenOptions] = defaultRehypePlugins.harden as [
  unknown,
  Record<string, unknown>,
];

const rehypePlugins = [
  defaultRehypePlugins.raw,
  defaultRehypePlugins.sanitize,
  [hardenPlugin, { ...hardenOptions, linkBlockPolicy: "text-only" }],
  unwrapPlainLinks,
] as MessageResponseProps["rehypePlugins"];

export const MessageResponse = memo(
  function MessageResponse({ className, ...props }: MessageResponseProps) {
    const contextRenderers = useMessageRenderers();
    const { plugins: callerPlugins, ...streamdownProps } = props;
    const renderers = useMemo(
      () => [
        ...contextRenderers,
        ...(callerPlugins?.renderers ?? []),
      ],
      [callerPlugins?.renderers, contextRenderers]
    );
    const languagesKey = useMemo(
      () =>
        JSON.stringify(
          renderers.flatMap((renderer) =>
            Array.isArray(renderer.language)
              ? renderer.language
              : [renderer.language]
          )
        ),
      [renderers]
    );
    const runtime = useMessagePlugins(
      props.children ?? "",
      callerPlugins === undefined,
      languagesKey,
      !props.isAnimating
    );
    if (!runtime.settled) {
      return <MessageResponseLoading className={className} />;
    }

    return (
      <Streamdown
        {...streamdownProps}
        className={cn(
          // streamdown 默认 linkSafety.enabled=true，链接渲染成 <button> 而非 <a>，
          // 故光标锁定两分支共有的 data-streamdown="link"，避免追 tag 名的特殊情况
          "size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_[data-streamdown=link]]:cursor-pointer",
          // streamdown 默认 list-inside 无悬挂缩进，覆盖为 outside + 左内边距
          "[&_ol]:list-outside [&_ol]:pl-5 [&_ul]:list-outside [&_ul]:pl-5",
          // streamdown 给 li 套 [&>p]:inline 配合 inside 标记，宽松列表段落会被
          // 拍平成一行；outside 布局下恢复块级并给相邻段落留间距
          "[&_li>p]:block [&_li>p+p]:mt-2",
          // ─── 标题梯级：以 text-sm 正文为唯一锚点重定 ───
          // streamdown 默认梯级 30/24/20/18/16/14 是按 1rem 正文设计的——它的 h5
          // 恰好就是 text-base。本产品正文一律 text-sm(14px)，沿用默认等于让梯级
          // 钉在一堵不存在的墙上：h1 被抻到 2.14×，h6 又与正文同号，两头一个过长
          // 一个塌陷。字号是绝对值，正文基准却是别处定的，漂移是迟早的事。
          //
          // 重定后字号只承载到 h4。Tailwind 的 12/14/16/18/20 是等差不是等比，
          // 14px 正文下字号最多区分四级；硬撑六级必然在末端同号或倒置。故 h5/h6
          // 停在正文同号，改由字重接力（600 → 500 → 正文 400）——换一个区分得开
          // 的维度，比在压扁的刻度上多凿两格诚实。
          //
          // mt 逐级收窄是本次新拥有的维度，六级全部钉死，不再继承 streamdown 的
          // 统一 mt-6：只钉一半，上游一改就会与继承的那一半分叉。mb-2 仍归上游，
          // 它是均匀值不是梯级，不拥有就不碰。
          "[&_h1]:mt-6 [&_h1]:text-2xl",
          "[&_h2]:mt-6 [&_h2]:text-xl",
          "[&_h3]:mt-5 [&_h3]:text-lg",
          "[&_h4]:mt-5 [&_h4]:text-base",
          "[&_h5]:mt-4 [&_h5]:text-sm",
          "[&_h6]:mt-4 [&_h6]:font-medium [&_h6]:text-sm",
          className
        )}
        plugins={{
          ...runtime.plugins,
          ...callerPlugins,
          ...(renderers.length ? { renderers } : {}),
        }}
        rehypePlugins={rehypePlugins}
      />
    );
  },
  (prevProps, nextProps) =>
    prevProps.children === nextProps.children &&
    nextProps.isAnimating === prevProps.isAnimating
);

MessageResponse.displayName = "MessageResponse";
