/**
 * [INPUT]: Depends on React, current MemoryStatusSnapshot, memory-client title level supply IPC and i18n
 * [OUTPUT]: Provides MemorySupplyList: Successfully removes old error loading, disabled/failure prompt, decreased dynamic effects, chat/foreign aggregation, scope three-way fence loading range not to be delayed until discarded and maintained loading, red only left for rejection
 * [POS]: Settings › Memory The folding source sub-block of the observed segment; Only display the count/title/state, never touch the memory in writing
 */

import { useEffect, useRef, useState } from "react";
import { ChevronRight, Loader2 } from "lucide-react";
import type {
  MemoryStatusSnapshot,
  MemorySupplyResult,
} from "../../../../shared/memory-ipc";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { fetchMemorySupplyStreams } from "@/lib/memory-client";
import { cn } from "@ai-chat/ui/lib/utils";

export function MemorySupplyList({ status }: { status: MemoryStatusSnapshot }) {
  const { t } = useAppTranslation();
  const [open, setOpen] = useState(false);
  const [response, setResponse] = useState<{
    scopeKey: string;
    result: MemorySupplyResult;
  } | null>(null);
  const [failedScopeKey, setFailedScopeKey] = useState<string | null>(null);
  const request = useRef(0);
  const scope = status.observationScope;
  const scopeKey = scope ? scopeKeyOf(scope) : "disabled";
  const result = response?.scopeKey === scopeKey ? response.result : null;
  const failed = failedScopeKey === scopeKey;
  const loading = open && result === null && !failed;

  useEffect(() => {
    if (!open) return;
    const token = ++request.current;
    void fetchMemorySupplyStreams()
      .then((next) => {
        if (token !== request.current) return;
        /* 范围对不上 = 这份答案回答的是上一个问题，不是「读取失败」。
           把迟到染成红色告警，等于要求用户为一件正在自愈的事动手：
           下一次 status 推送会带来新范围，effect 重跑即得正确答案。
           所以这里只丢弃，保持 loading——红色只留给真正的 .catch。 */
        if (next.state === "ready" && scopeKeyOf(next.scope) !== scopeKey) return;
        setFailedScopeKey((failedKey) => failedKey === scopeKey ? null : failedKey);
        setResponse({ scopeKey, result: next });
      })
      .catch(() => {
        if (token !== request.current) return;
        setFailedScopeKey(scopeKey);
      });
    return () => {
      request.current += 1;
    };
  }, [open, scopeKey]);

  const toggle = () => {
    if (!open) setFailedScopeKey(null);
    setOpen(!open);
  };

  return (
    <div className="rounded-lg bg-card ring-1 ring-foreground/10">
      <button
        type="button"
        className="flex min-h-11 w-full items-center gap-2 px-4 py-3 text-left"
        aria-expanded={open}
        onClick={toggle}
      >
        <ChevronRight
          className={cn(
            "size-4 text-muted-foreground motion-safe:transition-transform",
            open && "rotate-90"
          )}
        />
        <span className="font-medium text-sm">{t("memory.supply.title")}</span>
        {loading && (
          <Loader2 className="ml-auto size-4 text-muted-foreground motion-safe:animate-spin" />
        )}
        {!loading && result?.state === "ready" && (
          <span className="ml-auto text-muted-foreground text-xs tabular-nums">
            {t("memory.supply.summary", {
              streams: result.totalStreams,
              delivered: result.totalDelivered,
            })}
          </span>
        )}
      </button>
      {open && (
        <div className="border-t px-4 py-3">
          {failed ? (
            <p role="alert" className="text-destructive text-xs">
              {t("memory.supply.loadFailed")}
            </p>
          ) : result?.state === "disabled" ? (
            <p className="text-muted-foreground text-xs">
              {t("memory.supply.disabled")}
            </p>
          ) : result?.state === "ready" && result.rows.length ? (
            <ul className="divide-y">
              {result.rows.map((row) => (
                <li key={row.id} className="flex min-h-11 items-center gap-3 py-2 text-xs">
                  <span className="min-w-0 flex-1 truncate">
                    {row.kind === "foreign"
                      ? t("memory.supply.foreign")
                      : row.title ?? t("memory.supply.untitled")}
                  </span>
                  {row.kind === "chat" && row.state !== "active" && (
                    <span className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground">
                      {t(`memory.supply.${row.state}`)}
                    </span>
                  )}
                  <span className="text-muted-foreground tabular-nums">
                    {t("memory.supply.counts", row)}
                  </span>
                </li>
              ))}
            </ul>
          ) : loading ? null : (
            <p className="text-muted-foreground text-xs">{t("memory.supply.empty")}</p>
          )}
        </div>
      )}
    </div>
  );
}

const scopeKeyOf = (scope: NonNullable<MemoryStatusSnapshot["observationScope"]>) =>
  `${scope.providerDataInstanceId}\0${scope.sharingMode}\0${scope.sharingGeneration}`;
