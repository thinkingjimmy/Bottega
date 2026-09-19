/**
 * [INPUT]: React, shared UI primitives and host-owned presentation slots.
 * [OUTPUT]: Shared Chat empty state and composer layout without platform effects.
 * [POS]: Common Chat presentation for local desktop, remote desktop and browser.
 */
import type { ComponentProps } from "react";
import { PromptInput, PromptInputFooter } from "@ai-chat/ui/components/ai-elements/prompt-input";
import { InputGroup } from "@ai-chat/ui/components/ui/input-group";
import { cn } from "@ai-chat/ui/lib/utils";
const inputClass = "relative z-10 [&_[data-slot=input-group]]:overflow-visible [&_[data-slot=input-group]]:rounded-2xl [&_[data-slot=input-group]]:bg-background";
export function ComposerDock({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("mx-auto w-full max-w-3xl shrink-0 p-4 pt-0 pb-[max(1rem,env(safe-area-inset-bottom))] max-sm:px-3", className)} {...props} />;
}
export function ComposerContext({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("relative z-0 mx-3 -mb-px flex min-w-0 items-center gap-2 rounded-t-2xl bg-muted px-2 py-[calc(1rem/3)]", className)} {...props} />;
}
export function ComposerInput({ className, ...props }: ComponentProps<typeof PromptInput>) {
  return <PromptInput className={cn(inputClass, className)} {...props} />;
}
export function ComposerForm({ className, children, ...props }: ComponentProps<"form">) {
  return <form className={cn(inputClass, className)} {...props}><InputGroup>{children}</InputGroup></form>;
}
export function ComposerToolbar({ className, ...props }: ComponentProps<typeof PromptInputFooter>) {
  return <PromptInputFooter className={cn("@container/composer", className)} {...props} />;
}
export function ComposerActions({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("ml-auto flex min-w-0 items-center gap-1", className)} {...props} />;
}
