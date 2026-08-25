"use client";

/**
 * [INPUT]: Depends on React CSSProperties merged with cn class names
 * [OUTPUT]: The system Provides Shimmer to scan text components (duration/delay/spread available)
 * [POS]: The load of ai-elements indicates the native language, and is assembled in a streamlined state by the ThinkingShimmer class
 */

import type { CSSProperties, ElementType, ReactNode } from "react";
import { cn } from "@ai-chat/ui/lib/utils";

export type ShimmerProps = {
  children: ReactNode;
  /** 扫光一轮的秒数 */
  duration?: number;
  /** 渐变铺展倍数（背景宽度 = spread × 100%） */
  spread?: number;
  as?: ElementType;
  className?: string;
};

// 纯 CSS 实现（决策 9）：text-transparent + background-clip 扫动渐变，
// 对外签名与官方 AI Elements Shimmer 一致，不引入 framer-motion。
//
// ─── 方案 1：周期化平铺，从根上消灭空隙 ───
// bg-clip-text 下，背景未覆盖处 = 文字透明（消失）。
// no-repeat + 越界 position 会露出空隙 → 文字被"擦除"。
// 改用 background-repeat: repeat：渐变瓦片无限平铺，容器恒被覆盖，position 任意漂移
// 都不可能露白，"空隙"不复存在。渐变两端同为 muted-foreground → 瓦片接缝无痕。
// 唯一残留问题是循环接缝：动画恰好平移「一个瓦片」即首尾同构、无缝衔接。

// 位移一个瓦片（宽 spread×C）对应的 background-position 行程。
// percentage 定位基于「容器 − 图像」之差：offset(p)=(p/100)·C·(1−spread)，
// 令 |offset| = spread·C 解得行程 = 100·spread/(spread−1)。spread=2 → 200%。
//
// 方向：spread>1 时 offset 随 p 递减，即 p 增大＝图像左移＝高光右→左。
// 阅读方向要求高光左→右，故动画反向播放：从 travel% 走回 0，图像持续右移。
const travelPercent = (spread: number) => (100 * spread) / (spread - 1);

export const Shimmer = ({
  children,
  duration = 2,
  spread = 2,
  as: Component = "p",
  className,
}: ShimmerProps) => {
  // 按 spread 命名 keyframes，避免不同 spread 实例互相覆盖同名规则。
  const animationName = `ui-shimmer-${String(spread).replace(".", "_")}`;
  const keyframes = `@keyframes ${animationName}{from{background-position:${travelPercent(
    spread
  )}% 0}to{background-position:0 0}}`;
  const style: CSSProperties = {
    backgroundImage:
      "linear-gradient(90deg, var(--muted-foreground) 40%, var(--foreground) 50%, var(--muted-foreground) 60%)",
    backgroundSize: `${spread * 100}% 100%`,
    backgroundRepeat: "repeat",
    animation: `${animationName} ${duration}s linear infinite`,
  };
  return (
    <>
      <style>{keyframes}</style>
      <Component
        className={cn(
          "inline-block select-none bg-clip-text text-sm text-transparent",
          className
        )}
        style={style}
      >
        {children}
      </Component>
    </>
  );
};
