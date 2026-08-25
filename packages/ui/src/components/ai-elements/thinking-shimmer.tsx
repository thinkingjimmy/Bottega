"use client";

/**
 * [INPUT]: Depends on thinking-orbs, ThinkingOrb, similar to Shimmer, ui/marker, MarkerIcon icon slots combined with cn class names
 * [OUTPUT]: Provides ThinkingShimmer ((Thinking orb + scan the flow state line of the light label)
 * [POS]: The standard state native language of ai-elements, Shimmer's only assembly layer, is consumed by chat draft and subagent panels; The status bar is a row ((min-w-0 + truncate)), and the length of the tag does not change the height of the bar; Sharing icon and toolbar MarkerIcon slots, 14px in font, two lines of text aligned on the left edge
 */

import type { ReactNode } from "react";
import { ThinkingOrb } from "thinking-orbs";
import { Shimmer } from "@ai-chat/ui/components/ai-elements/shimmer";
import { MarkerIcon } from "@ai-chat/ui/components/ui/marker";
import { cn } from "@ai-chat/ui/lib/utils";

export type ThinkingShimmerProps = {
  children: ReactNode;
  className?: string;
};

// ─── orb 与工具图标同槽同号 ───
// 状态行与工具行是同一族的行，图标槽不该各说各话：槽走 MarkerIcon（size-4 的
// 16px 盒，居中），字形取 14px——正是 MarkerIcon 给 svg 定的 size-3.5。同槽同
// gap-2，文字左缘才与上方工具行严丝合缝；抄一份等价类名会在下次调整时分叉。
//
// 尺寸走 style 而非 className 是被迫的：thinking-orbs 把 width/height 写进
// inline style，且调用方 style 后置覆盖——className 压不过行内样式。
// 而 size 只接受 64 | 20 两个手调档（点数、点径、速度各自调过，不是缩放系数），
// 故仍取 20 档的绘制，再显示为 14px：背板是 20×DPR，缩小是下采样不会糊。
const ORB_PRESET = 20;
const ORB_GLYPH = { width: 14, height: 14 } as const;

// orb 与 shimmer 同生共死：状态行只有这一个入口，
// 不存在"orb 出现而 shimmer 未出现"的中间态。
//
// ─── 状态行恒为一行 ───
// 标签取自当前工具标题，长度不可控（一条 find 命令就能顶到三行），而它表达的
// 是"此刻在做什么"这一瞬态事实——占多少高度不该由内容长度决定，否则每换一个
// 工具整条流就抖一次。故在此钉死单行截断：全文本就在上方工具组里，展开可见，
// 这里只需要一个恒定高度的进度信号。
// min-w-0 是 flex 项截断的前提：默认 min-width:auto 会让它撑到 min-content，
// overflow 永不触发——只写 truncate 是不会生效的。
export const ThinkingShimmer = ({
  children,
  className,
}: ThinkingShimmerProps) => (
  <div className={cn("flex min-w-0 items-center gap-2 py-1", className)}>
    <MarkerIcon>
      <ThinkingOrb size={ORB_PRESET} state="shaping" style={ORB_GLYPH} />
    </MarkerIcon>
    <Shimmer className="min-w-0 truncate">{children}</Shimmer>
  </div>
);
