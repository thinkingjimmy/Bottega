/**
 * [INPUT]: Host branch operations, localized copy, shared UI primitives and branch controller.
 * [OUTPUT]: BranchSelector with native/Web search, paging, checkout, create and retry controls.
 * [POS]: Shared Project toolbar branch surface; hosts retain execution authority.
 */
import { useRef } from "react";
import { Check, GitBranch, LoaderCircle, Plus } from "lucide-react";
import { Button } from "@ai-chat/ui/components/ui/button";
import { Command, CommandInput, CommandItem, CommandList } from "@ai-chat/ui/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@ai-chat/ui/components/ui/dialog";
import { Input } from "@ai-chat/ui/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@ai-chat/ui/components/ui/popover";
import { focusIsLost } from "@ai-chat/ui/lib/focus-return";
import { useCoarsePointer } from "@ai-chat/ui/hooks/use-mobile";
import { composerContextButtonClass } from "../../selector";
import { useBranchSelector, type BranchSelectorProps } from "./controller";

export function BranchSelector(props: BranchSelectorProps) {
  const s = useBranchSelector(props), { copy } = props, touch = useCoarsePointer(), trigger = useRef<HTMLButtonElement>(null);
  if (s.page === null && !s.error) return null;
  const count = s.page?.uncommittedFiles ?? 0;
  const uncommitted = (count === 1 ? copy.uncommitted_one : copy.uncommitted_other).replace("{{count}}", String(count));
  const retry = <Button type="button" variant="ghost" className="h-8 max-md:h-11 pointer-coarse:h-11" disabled={s.loading || s.busy || Boolean(props.unavailable)}
    onClick={() => void s.load(s.query)}>{s.uncertain ? copy.checkResult : copy.retry}</Button>;
  return <>
    <Popover open={s.open} onOpenChange={next => {
      if (props.disabled || s.busy) return;
      s.setOpen(next);
      if (next) { s.setQuery(""); void s.load(""); }
    }}>
      <PopoverTrigger asChild><Button ref={trigger} type="button" variant="ghost" size="lg" disabled={props.disabled || s.busy}
        aria-label={`${copy.fallback}: ${s.page?.head ?? copy.fallback}`} title={s.error || undefined}
        className={`${composerContextButtonClass} min-w-0 max-w-56 shrink gap-2 max-md:h-11 pointer-coarse:h-11 aria-expanded:bg-muted-foreground/10`}>
        {s.loading && !s.page || s.busy ? <LoaderCircle className="size-4 shrink-0 animate-spin" /> : <GitBranch className="size-4 shrink-0" />}
        <span className="truncate">{s.page?.head ?? copy.fallback}</span>
      </Button></PopoverTrigger>
      <PopoverContent side="top" align="start" sideOffset={10} collisionPadding={12} aria-label={copy.fallback}
        className="flex w-[18.5rem] max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden rounded-2xl p-0"
        onOpenAutoFocus={event => { if (touch) { event.preventDefault(); (event.target as HTMLElement).focus(); } }}
        onCloseAutoFocus={event => { event.preventDefault(); if (focusIsLost() && trigger.current?.isConnected && !trigger.current.disabled) trigger.current.focus({ preventScroll: true }); }}>
        <Command shouldFilter={false} loop className="min-h-0 rounded-2xl p-0 [&_[data-slot=command-input-wrapper]]:p-3 [&_[data-slot=input-group]]:border-0 [&_[data-slot=input-group]]:bg-transparent [&_[data-slot=input-group]]:shadow-none">
          <CommandInput value={s.query} onValueChange={s.setQuery} aria-label={copy.search} placeholder={copy.search} disabled={s.locked} maxLength={256} className="text-sm max-md:text-base" />
          <CommandList className="max-h-72 min-h-48 px-2">
            <p className="px-3 pt-2 pb-1 text-xs text-muted-foreground">{copy.group}</p>
            {!s.loading && !s.error && s.page?.branches.length === 0 && <p className="py-5 text-center text-sm">{copy.empty}</p>}
            {s.page?.detached && <div className="flex min-h-11 items-center gap-2 px-3 py-2 text-sm"><GitBranch className="size-4" /><span className="min-w-0 flex-1 truncate">{s.page.head}<span className="block text-xs text-muted-foreground">{copy.detached}</span></span><Check className="size-4" /></div>}
            {s.page?.branches.map(branch => <CommandItem key={`${branch.kind}:${branch.name}`} value={`${branch.kind}:${branch.name}`} disabled={s.locked || s.loading}
              className="min-h-11 px-3 py-2 text-sm" onSelect={() => void s.mutate(branch)}>
              <GitBranch className="size-4 text-muted-foreground" /><span className="min-w-0 flex-1"><span className="block truncate">{branch.name}</span>
                {branch.current && count > 0 && <span className="block text-xs text-muted-foreground">{uncommitted}</span>}</span>{branch.current && <Check className="ml-auto size-4" />}
            </CommandItem>)}
            {s.loading && <p role="status" className="px-3 py-2 text-xs text-muted-foreground">{copy.refreshing}</p>}
            <div onKeyDown={event => { if (event.key === "Enter") event.stopPropagation(); }}>
              {s.page?.nextCursor && <Button type="button" variant="ghost" disabled={s.loading || s.locked} className="w-full max-md:h-11 pointer-coarse:h-11" onClick={() => void s.load(s.query, s.page!.nextCursor)}>{copy.more}</Button>}
              {s.error && <div className="px-3 py-2"><p role="alert" className="text-xs text-destructive">{s.error}</p>{retry}</div>}
            </div>
          </CommandList>
          <div className="relative p-1 before:absolute before:top-0 before:right-3 before:left-3 before:border-t before:border-border" onKeyDown={event => { if (event.key === "Enter") event.stopPropagation(); }}>
            <Button type="button" variant="ghost" className="h-8 w-full justify-start gap-2 rounded-xl px-2 text-sm font-normal max-md:h-11 pointer-coarse:h-11" disabled={s.locked || !s.page || s.loading}
              onClick={() => { s.setOpen(false); s.setCreateOpen(true); }}><Plus className="size-4" /><span className="truncate">{copy.newAction}</span></Button>
          </div>
        </Command>
      </PopoverContent>
    </Popover>
    <Dialog open={s.createOpen} onOpenChange={next => { if (!s.busy) { s.setCreateOpen(next); if (!next) s.setName(""); } }}>
      <DialogContent className="gap-5 rounded-3xl p-5 sm:max-w-[25rem]" overlayClassName="bg-black/20">
        <DialogHeader><DialogTitle className="text-xl font-semibold">{copy.createTitle}</DialogTitle><DialogDescription className="sr-only">{copy.createDescription}</DialogDescription></DialogHeader>
        <label className="flex flex-col gap-3 text-sm font-medium"><span>{copy.name}</span><Input autoFocus className="h-10 rounded-xl text-sm font-normal max-md:h-11 max-md:text-base"
          placeholder={copy.placeholder} value={s.name} disabled={s.locked} aria-invalid={Boolean(s.createError)} onChange={event => s.setName(event.target.value)}
          onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); void s.mutate(); } }} /></label>
        {s.createError && <p role="alert" className="text-xs text-destructive">{s.createError}</p>}
        {s.uncertain && retry}
        <DialogFooter><Button type="button" size="lg" variant="secondary" className="rounded-xl px-4" disabled={s.busy} onClick={() => { s.setCreateOpen(false); s.setName(""); }}>{copy.close}</Button>
          <Button type="button" size="lg" className="rounded-xl px-4" disabled={s.locked || !s.name.trim()} onClick={() => void s.mutate()}>{s.busy ? copy.creating : copy.createAndCheckout}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
