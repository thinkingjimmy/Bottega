/**
 * [INPUT]: React, shared Command primitives, pointer capabilities and host-owned copy/results.
 * [OUTPUT]: SearchDialog, SearchPalette and SearchNotice with common geometry, focus and selection behavior.
 * [POS]: Native/Web command search presentation; no query transport, routing or account authority.
 */
import { useId, useState, type ComponentProps, type ReactNode } from "react";
import {
  Command,
  CommandDialog,
  CommandInput,
  CommandList,
} from "../ui/command";
import { useCoarsePointer } from "../../hooks/use-mobile";
import { cn } from "../../lib/utils";

export function SearchDialog({
  contentProps,
  ...props
}: ComponentProps<typeof CommandDialog>) {
  const touch = useCoarsePointer();
  return (
    <CommandDialog
      {...props}
      className="flex max-h-[calc(100dvh*2/3-2rem)] flex-col sm:max-w-2xl max-md:top-[max(1rem,env(safe-area-inset-top))] max-md:max-h-[calc(100dvh-2rem)]"
      contentProps={{
        ...contentProps,
        onOpenAutoFocus(event) {
          contentProps?.onOpenAutoFocus?.(event);
          if (touch && !event.defaultPrevented) {
            event.preventDefault();
            (event.target as HTMLElement).focus();
          }
        },
      }}
    />
  );
}

export function SearchPalette({
  query,
  onQueryChange,
  label,
  placeholder,
  first,
  children,
  footer,
  inputProps,
  busy = false,
}: {
  query: string;
  onQueryChange(value: string): void;
  label: string;
  placeholder: string;
  first?: string;
  children: ReactNode;
  footer?: ReactNode;
  busy?: boolean;
  inputProps?: Omit<
    ComponentProps<typeof CommandInput>,
    "value" | "onValueChange" | "placeholder" | "id"
  >;
}) {
  const id = useId();
  const [anchor, setAnchor] = useState(first),
    [selected, setSelected] = useState(first);
  // A newly arrived first row owns Enter; appending results preserves keyboard selection.
  if (first !== anchor) {
    setAnchor(first);
    setSelected(first);
  }
  return (
    <Command
      shouldFilter={false}
      loop
      value={selected ?? ""}
      onValueChange={setSelected}
      className="min-h-0 [&_[data-slot=input-group]]:max-md:h-11! [&_[data-slot=input-group]]:pointer-coarse:h-11!"
    >
      <label className="sr-only" htmlFor={id}>
        {label}
      </label>
      <CommandInput
        {...inputProps}
        id={id}
        data-slot="input-group-control"
        data-search-input
        inputMode="search"
        enterKeyHint="search"
        autoComplete="off"
        spellCheck={false}
        data-1p-ignore
        data-lpignore="true"
        className="min-w-0 bg-transparent max-md:text-base pointer-coarse:text-base"
        aria-label={label}
        placeholder={placeholder}
        value={query}
        onValueChange={onQueryChange}
      />
      <CommandList aria-busy={busy} className="min-h-0 max-h-[420px] flex-1">
        {children}
      </CommandList>
      {footer && (
        <div
          data-slot="search-footer"
          className="max-h-36 shrink-0 overflow-y-auto border-t border-border/50 px-3 py-2 text-[0.6875rem] leading-relaxed text-muted-foreground"
        >
          {footer}
        </div>
      )}
    </Command>
  );
}
export function SearchNotice({ className, ...props }: ComponentProps<"p">) {
  return (
    <p
      className={cn("px-3 py-2 text-xs text-muted-foreground", className)}
      {...props}
    />
  );
}
