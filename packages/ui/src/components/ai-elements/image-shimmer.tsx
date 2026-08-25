"use client";

/**
 * [INPUT]: Depends on React CSSProperties, cn class name merged with subject --muted / --muted-foreground
 * [OUTPUT]: Provides ImageShimmer (picture waiting for position: bottom color + drift point array + floating high light)
 * [POS]: The image form of ai-elements is loaded in native language, parallel to the text form Shimmer; Live charts and shortened charts by chat transcript are waiting for state consumption
 */

import type { CSSProperties } from "react";
import { cn } from "@ai-chat/ui/lib/utils";

// ─── 纯 CSS 点阵：DOM 恒为两层，点数与容器大小解耦 ───
// 逐点建 DOM 是最直白的错解——点数随面积平方增长，动效即重排。
// 点阵本就是周期函数，交给 background-image 平铺：一层静态底纹 + 一层被
// 软遮罩裁出的高亮，两层共用同一瓦片与同一漂移，永不错位。
//
// 漂移行程恰为一个瓦片：位移 TILE 后图案与初始完全同构，循环无接缝。

const TILE = 14; // 点阵周期（px）
const DRIFT = "ui-image-dots-drift";
const WANDER = "ui-image-dots-wander";

const KEYFRAMES = `
@keyframes ${DRIFT}{to{background-position:${TILE}px ${TILE}px}}
@keyframes ${WANDER}{
  0%{mask-position:6% 10%}
  25%{mask-position:76% 24%}
  50%{mask-position:56% 84%}
  75%{mask-position:12% 60%}
  100%{mask-position:6% 10%}
}
@media (prefers-reduced-motion: reduce){
  [data-slot=image-shimmer] *{animation:none}
}`;

// 点阵瓦片：圆点半径 1.1px，1.3px 处收敛为透明，边缘留一档抗锯齿
const dots: CSSProperties = {
  backgroundImage:
    "radial-gradient(var(--muted-foreground) 1.1px, transparent 1.3px)",
  backgroundSize: `${TILE}px ${TILE}px`,
};

// 底纹：整片可见但极淡，靠径向遮罩向边角自然消隐，不需要描边收口
const field: CSSProperties = {
  ...dots,
  animation: `${DRIFT} 14s linear infinite`,
};

// 高亮：同一瓦片提亮，被一枚软圆遮罩裁成"一小簇点"，沿闭合路径缓慢游走
const wander: CSSProperties = {
  ...dots,
  maskImage: "radial-gradient(circle, #000 0%, transparent 62%)",
  maskSize: "62% 62%",
  maskRepeat: "no-repeat",
  animation: `${DRIFT} 14s linear infinite, ${WANDER} 9s ease-in-out infinite`,
};

// 视野遮罩：点阵向边角消隐，方块只剩底色，边界不需要额外分割线
const vignette =
  "[mask-image:radial-gradient(115%_95%_at_42%_38%,#000_25%,transparent_78%)]";

export type ImageShimmerProps = {
  className?: string;
  /** 无障碍标签；默认表述为生图等待 */
  label?: string;
};

export const ImageShimmer = ({
  className,
  label = "正在生成图片",
}: ImageShimmerProps) => (
  <div
    aria-label={label}
    className={cn(
      "relative aspect-square w-full max-w-xs overflow-hidden rounded-3xl bg-muted",
      className
    )}
    data-slot="image-shimmer"
    role="img"
  >
    <style>{KEYFRAMES}</style>
    {/* 遮罩挂在两层之上：消隐只描述一次，也避开与高亮层自身遮罩的争用 */}
    <div className={cn("absolute inset-0", vignette)}>
      <div className="absolute inset-0 opacity-25" style={field} />
      <div className="absolute inset-0 opacity-70" style={wander} />
    </div>
  </div>
);
