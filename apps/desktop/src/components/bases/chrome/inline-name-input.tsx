/**
 * [INPUT]: Depends on React state/ref, the shared Input primitive, and Base mutation outcomes
 * [OUTPUT]: Provides InlineNameInput, the blur-committed rename control shared by Base views, columns, and lanes
 * [POS]: Small Base chrome editing primitive extracted from base-toolbar so view controls share one cancellation contract
 */

import { useRef, useState } from "react";
import { Input } from "@ai-chat/ui/components/ui/input";
import type { BaseMutationOutcome } from "../state/base-mutation-error";

// Base/视图/列共用的行内改名原语：blur 收口提交，Enter 即 blur，空值回退原名
export function InlineNameInput({
  name,
  ariaLabel,
  className,
  autoFocus = false,
  onRename,
  onDone,
}: {
  name: string;
  ariaLabel: string;
  className?: string;
  autoFocus?: boolean;
  onRename(name: string): Promise<BaseMutationOutcome>;
  onDone?(): void;
}) {
  const [draft, setDraft] = useState(name);
  /* Esc 走 ref 而不是 setDraft：置空是异步的，而 blur() 同步触发 onBlur——
   * 那次 onBlur 读到的仍是旧闭包里的 draft，于是「取消」反而把编辑值提交了。
   * 用一枚同步的标记告诉 onBlur「这次不是提交」，退出仍只有 blur 一条通道。 */
  const cancelled = useRef(false);
  return (
    <Input
      aria-label={ariaLabel}
      autoFocus={autoFocus}
      className={className}
      maxLength={200}
      onBlur={() => {
        const next = cancelled.current ? "" : draft.trim();
        cancelled.current = false;
        if (next && next !== name) void onRename(next);
        else setDraft(name);
        onDone?.();
      }}
      onChange={(event) => setDraft(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") {
          cancelled.current = true;
          event.currentTarget.blur();
        }
      }}
      value={draft}
    />
  );
}
