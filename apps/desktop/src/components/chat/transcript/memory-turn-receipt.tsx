/**
 * [INPUT]: Depends on the assistant message on optional/versioned TurnContextReceipt
 * [OUTPUT]: Provides a rotating long-term memory fact badge with a single document projection in five languages; The government has been trying to stop the violence
 * [POS]: The request-bound Memory status filter for chat/transcript; Not reading the lastRecall, not deducting the absence receipt
 */

import { BrainIcon } from "lucide-react";
import type { TurnContextReceipt } from "../../../../shared/memory-ipc";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import type { MemoryTranslate } from "@/lib/memory-view";

const translated = (
  translate: MemoryTranslate | undefined,
  key: string,
  fallback: string,
  options?: Record<string, unknown>
) => translate?.(key, options) ?? fallback;

export function memoryReceiptCopy(
  receipt?: TurnContextReceipt,
  translate?: MemoryTranslate
) {
  const outcome = receipt?.memory;
  if (!outcome) return null;
  if (outcome.kind === "used") {
    return {
      label: translated(
        translate,
        "memory.receipt.used",
        `长期记忆 · 已随请求发送 ${outcome.count} 条`,
        { count: outcome.count }
      ),
      detail: translated(
        translate,
        "memory.receipt.usedDetail",
        "发送不代表模型一定采用"
      ),
      title: null,
    };
  }
  if (outcome.kind === "none") {
    return {
      label: translated(translate, "memory.receipt.none", "长期记忆 · 未找到相关内容"),
      detail: null,
      title: null,
    };
  }
  if (outcome.kind === "unavailable") {
    return {
      label: translated(
        translate,
        "memory.receipt.unavailable",
        "长期记忆不可用 · 本轮未使用长期记忆"
      ),
      detail: null,
      title: translated(
        translate,
        `memory.receipt.failure.${outcome.failureKind}`,
        outcome.failureKind
      ),
    };
  }
  if (outcome.reason === "plan-mode") {
    return {
      label: translated(
        translate,
        "memory.receipt.planMode",
        "长期记忆 · 本轮未使用（Plan 模式）"
      ),
      detail: null,
      title: null,
    };
  }
  if (outcome.reason === "prompt-not-issued") {
    return {
      label: translated(
        translate,
        "memory.receipt.promptNotIssued",
        "长期记忆 · Agent 请求未成功发送"
      ),
      detail: null,
      title: null,
    };
  }
  return null;
}

export function MemoryTurnReceipt({ receipt }: { receipt?: TurnContextReceipt }) {
  const { t } = useAppTranslation();
  const copy = memoryReceiptCopy(
    receipt,
    (key, options) => t(key, options)
  );
  if (!copy) return null;
  return (
    <div
      className="mt-2 flex items-start gap-1.5 text-xs text-muted-foreground"
      data-testid="memory-turn-receipt"
      title={copy.title ?? undefined}
    >
      <BrainIcon aria-hidden className="mt-0.5 size-3.5 shrink-0" />
      <span>
        {copy.label}
        {copy.detail ? <span className="ml-1 opacity-75">· {copy.detail}</span> : null}
      </span>
    </div>
  );
}
