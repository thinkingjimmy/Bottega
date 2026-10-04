/**
 * [INPUT]: Depends on React state/ref, the shared Input primitive, and Base mutation outcomes
 * [OUTPUT]: Provides InlineNameInput, the blur-committed rename control shared by Base views, columns, and lanes
 * [POS]: Shared Base presentation in ui/chrome.
 */

import { useRef, useState } from "react";
import { Input } from "@ai-chat/ui/components/ui/input";
import type { BaseMutationOutcome } from "../state/base-mutation-error";

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
