"use client";

/**
 * [INPUT]: Depends on React, Lucide ChevronDown/ChevronUp/X, ui Input/Button with i18n
 * [OUTPUT]: Provides InstructionsFind The bar is attached to the instruction editor to find the bar, and the target is to locate the original choice area using the textarea
 * [POS]: The instruction editor attachments of settings; The shape is similar to TranscriptFind in chat/transcript, but the content is a string rather than a full transcript
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import { Button } from "@ai-chat/ui/components/ui/button";
import { Input } from "@ai-chat/ui/components/ui/input";
import { useAppTranslation } from "@/components/providers/i18n-provider";

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/* ============================================================
 * 高亮不用自己画。
 *
 * textarea 里的命中位置本就有一个现成的表征——原生选区。自绘覆盖层要
 * 逐字复刻字体、行高、换行与滚动偏移，任何一项对不上，高亮就和文字错位，
 * 而错位不会报错。选区没有这个问题：它由布局本身产生，天生对齐。
 *
 * 代价是焦点要借一下：选区必须在 textarea 获得焦点时设置，浏览器才会把
 * 它滚进视野。设完立刻把焦点还给输入框——不还，用户敲的第二个字就跑进
 * 正文里去了。失焦后的选区仍会以灰底绘出，这正是「查找命中」该有的样子。
 * ============================================================ */
function useMatches(value: string, query: string) {
  return useMemo(() => {
    if (!query) return [];
    const pattern = new RegExp(escapeRegExp(query), "gi");
    const found: number[] = [];
    for (let hit; (hit = pattern.exec(value)); ) found.push(hit.index);
    return found;
  }, [query, value]);
}

export function InstructionsFind({
  value,
  textarea,
  onClose,
}: {
  value: string;
  textarea: HTMLTextAreaElement | null;
  onClose(): void;
}) {
  const { t } = useAppTranslation();
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const matches = useMatches(value, query);
  const active = matches.length ? Math.min(index, matches.length - 1) : 0;

  useEffect(() => {
    input.current?.focus();
  }, []);

  useEffect(() => {
    const start = matches[active];
    if (start === undefined || !textarea) return;
    textarea.focus();
    textarea.setSelectionRange(start, start + query.length);
    input.current?.focus();
  }, [active, matches, query.length, textarea]);

  const move = (delta: number) => {
    if (!matches.length) return;
    setIndex((active + delta + matches.length) % matches.length);
  };

  return (
    <div
      className="absolute top-3 right-3 z-10 flex w-80 items-center gap-1 rounded-lg border bg-background/95 p-2 shadow-sm backdrop-blur"
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
    >
      <Input
        ref={input}
        aria-label={t("settings.personalization.find.placeholder")}
        className="h-8"
        onChange={(event) => {
          setQuery(event.target.value);
          setIndex(0);
        }}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          move(event.shiftKey ? -1 : 1);
        }}
        placeholder={t("settings.personalization.find.placeholder")}
        value={query}
      />
      <span className="min-w-14 text-center text-muted-foreground text-xs tabular-nums">
        {matches.length
          ? t("settings.personalization.find.count", {
              current: active + 1,
              total: matches.length,
            })
          : t("settings.personalization.find.noMatches")}
      </span>
      <Button
        aria-label={t("settings.personalization.find.previous")}
        onClick={() => move(-1)}
        size="icon-sm"
        variant="ghost"
      >
        <ChevronUp />
      </Button>
      <Button
        aria-label={t("settings.personalization.find.next")}
        onClick={() => move(1)}
        size="icon-sm"
        variant="ghost"
      >
        <ChevronDown />
      </Button>
      <Button
        aria-label={t("settings.personalization.find.close")}
        onClick={onClose}
        size="icon-sm"
        variant="ghost"
      >
        <X />
      </Button>
    </div>
  );
}
