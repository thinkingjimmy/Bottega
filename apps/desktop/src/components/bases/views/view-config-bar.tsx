/**
 * [INPUT]: Depends on React, shadcn Select, ui of cn and tailwind class
 * [OUTPUT]: Provides ViewConfigBar Set bar containers, ViewConfigSelect selector and viewConfigHitAreaClass ((28px Views / 44px live)
 * [POS]: bases/views are set to view in native language, map and galleryJust send the id intent and permanently to the workbench
 */

import type { ReactNode } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@ai-chat/ui/components/ui/select";
import { cn } from "@ai-chat/ui/lib/utils";

/* ── 为何不画底线 ──────────────────────────────────────────────────
 * 分隔线是 chrome 的语言，它说的是「线之上是框，线之下是内容」。
 * 设置条画上它，就等于自称第三层框——宿主 tab、视图 tab、再一条线，
 * 三条横线堆下来，内容还没出现就已被切了三刀。
 * 可它本就不是框：它是这个视图自己的控件，与下面的画布同属一件东西。
 * 去掉线，层级从三降到二，而边界并不会丢——留白与控件形状足够说明。
 * ────────────────────────────────────────────────────────────── */
export function ViewConfigBar({ children }: { children: ReactNode }) {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-3 bg-background px-3 py-1.5">
      {children}
    </div>
  );
}

/* ── 44px 命中区，视觉不变 ────────────────────────────────────────
 * 「可达性要求 44px」与「桌面 chrome 要 28px 密度」看似冲突，实则问的
 * 是两件事：看起来多大，和点得中多大。把它们分开，冲突就不存在了——
 * 控件仍是 28px，::after 只在竖直方向撑到 44px 承接指针。
 * 反面教材是把控件本身撑成 min-h-11：命中区达标了，可它同时把视觉
 * 层级也一起放大，密排的设置条于是压过它上面的主导航。
 *
 * 只给未定位的控件用：这里的 relative 与 absolute 同属 position 组，
 * 经 cn 的 tailwind-merge 后写在后面的赢——贴到 absolute 控件上会把它
 * 打回文档流。定位过的宿主自己就是包含块，只取 after:* 那几个即可。
 * ────────────────────────────────────────────────────────────── */
export const viewConfigHitAreaClass =
  "relative after:absolute after:inset-x-0 after:top-1/2 after:h-11 after:-translate-y-1/2 after:content-['']";

export function ViewConfigSelect({
  label,
  value,
  options,
  placeholder,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ id: string; name: string }>;
  placeholder?: string;
  disabled?: boolean;
  onChange(id: string): void;
}) {
  const selected = value || EMPTY_VIEW_CONFIG_VALUE;
  return (
    <div className="flex items-center gap-1.5 text-muted-foreground text-xs">
      <span>{label}</span>
      <Select
        disabled={disabled}
        onValueChange={(next) =>
          onChange(next === EMPTY_VIEW_CONFIG_VALUE ? "" : next)
        }
        value={selected}
      >
        <SelectTrigger
          aria-label={label}
          className={cn(
            viewConfigHitAreaClass,
            "h-7 min-w-24 bg-background px-2 text-foreground text-xs"
          )}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {placeholder !== undefined && (
            <SelectItem value={EMPTY_VIEW_CONFIG_VALUE}>
              {placeholder}
            </SelectItem>
          )}
          {options.map((option) => (
            <SelectItem key={option.id} value={option.id}>
              {option.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

const EMPTY_VIEW_CONFIG_VALUE = "__base-empty!__";
