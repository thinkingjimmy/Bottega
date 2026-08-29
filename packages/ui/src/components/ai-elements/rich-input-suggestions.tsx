"use client";

/**
 * [INPUT]: Depends on RichInput Candidate/text type, rich-input model, single projection/identity, Command, and the icon of the file type
 * [OUTPUT]: Provides the suggestion menu with real listbox/option ids, a focusable fixed footer action, textbox combobox ARIA projection, PathLabel and file-type icons
 * [POS]: ai-elements the candidate view layer of RichInput; No query/preview/selected status, all selection facts are fed by parent level
 */

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@ai-chat/ui/components/ui/command";
import { keepRichSuggestionVisible } from "@ai-chat/ui/lib/rich-input-dom";
import {
  suggestionKey,
  type RichQuery,
  type SuggestionProjection,
} from "@ai-chat/ui/lib/rich-input-model";
import {
  FileArchiveIcon,
  FileCodeIcon,
  FileIcon,
  FileSpreadsheetIcon,
  FileTextIcon,
  FolderIcon,
  PackageIcon,
} from "lucide-react";
import { useLayoutEffect, useRef } from "react";
import type {
  RichInputSuggestion,
  RichSuggestionCopy,
} from "./rich-input-types";

export const DEFAULT_SUGGESTION_COPY: Record<
  RichQuery["kind"],
  RichSuggestionCopy
> = {
  skill: {
    empty: "没有可用 Skill",
    noMatch: "没有匹配的 Skill",
    groups: [{ kind: "skill", label: "Skills", triggers: ["skill"] }],
  },
  mention: {
    empty: "没有可用引用",
    noMatch: "没有匹配的引用",
    groups: [
      { kind: "section", label: "Chats" },
      { kind: "workspace-file", label: "Files" },
      { kind: "skill", label: "Skills", triggers: ["mention"] },
    ],
  },
};

export function fileIcon(name: string) {
  const extension = name.split(".").at(-1)?.toLowerCase();
  if (["md", "mdx", "txt", "rtf"].includes(extension ?? "")) {
    return FileTextIcon;
  }
  if (
    ["ts", "tsx", "js", "jsx", "json", "html", "css", "py", "go", "rs"].includes(
      extension ?? ""
    )
  ) {
    return FileCodeIcon;
  }
  if (["csv", "xls", "xlsx", "numbers"].includes(extension ?? "")) {
    return FileSpreadsheetIcon;
  }
  if (["zip", "tar", "gz", "rar", "7z"].includes(extension ?? "")) {
    return FileArchiveIcon;
  }
  return FileIcon;
}

export const workspaceEntryIcon = (
  entryKind: "file" | "dir" | undefined,
  name: string
) => entryKind === "dir" ? FolderIcon : fileIcon(name);

export function suggestionEditorAria(
  listId: string | undefined,
  query: RichQuery | null,
  activeOptionId: string | undefined
) {
  return {
    "aria-activedescendant": query ? activeOptionId : undefined,
    "aria-autocomplete": "list" as const,
    "aria-controls": query && listId ? listId : undefined,
    "aria-expanded": Boolean(query),
    "aria-haspopup": "listbox" as const,
  };
}

/** 路径省略只发生在头部，末段保留同名文件真正的区分信息。 */
export function PathLabel({ path }: { path: string }) {
  const trailingSlash = path.endsWith("/");
  const barePath = trailingSlash ? path.slice(0, -1) : path;
  const cut = barePath.lastIndexOf("/");
  return (
    <span className="flex min-w-0 items-baseline">
      {cut > 0 ? (
        <span className="min-w-0 truncate">{barePath.slice(0, cut)}</span>
      ) : null}
      <span className="shrink-0">
        {cut < 0 ? barePath : barePath.slice(cut)}
        {trailingSlash ? "/" : null}
      </span>
    </span>
  );
}

export function SuggestionMenu({
  active,
  copy,
  disabled,
  onActiveOptionIdChange,
  onListIdChange,
  onSelect,
  projection,
  query,
}: {
  active: number | null;
  copy: RichSuggestionCopy;
  disabled?: boolean;
  onActiveOptionIdChange: (id: string | undefined) => void;
  onListIdChange: (id: string | undefined) => void;
  onSelect: (item: RichInputSuggestion) => void;
  query: RichQuery | null;
  projection: SuggestionProjection;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const list = listRef.current;
    const item = selectedRef.current;
    onListIdChange(query ? list?.id : undefined);
    onActiveOptionIdChange(query ? item?.id : undefined);
    if (query && list && item) keepRichSuggestionVisible(list, item);
  }, [active, onActiveOptionIdChange, onListIdChange, projection, query]);

  if (!query) return null;
  let flatIndex = 0;
  return (
    <div
      className="absolute -right-px bottom-full -left-px z-50 mb-2 overflow-hidden rounded-xl border bg-popover shadow-none"
    >
      <Command
        value={active === null ? "" : suggestionKey(projection.flat[active]!)}
      >
        <CommandList className="max-h-64" ref={listRef}>
          {projection.flat.length === 0 && projection.groups.length === 0 ? (
            <CommandEmpty>{query.value ? copy.noMatch : copy.empty}</CommandEmpty>
          ) : null}
          {projection.groups.map((group) => (
            <CommandGroup heading={group.label} key={group.kind}>
              {group.items.map((item) => {
                const index = flatIndex++;
                const Icon =
                  item.kind === "workspace-file"
                    ? workspaceEntryIcon(item.entryKind, item.path)
                    : null;
                return (
                  <CommandItem
                    className="gap-2.5 [@media(pointer:coarse)]:min-h-11"
                    data-selected={index === active ? "true" : undefined}
                    disabled={disabled}
                    key={suggestionKey(item)}
                    onMouseDown={(event) => event.preventDefault()}
                    onSelect={() => onSelect(item)}
                    ref={index === active ? selectedRef : undefined}
                    value={suggestionKey(item)}
                  >
                    {item.icon ??
                      (Icon ? (
                        <Icon className="size-4" />
                      ) : (
                        <PackageIcon className="size-4" />
                      ))}
                    <span className="flex min-w-0 flex-1 items-baseline gap-2">
                      <span className="shrink-0 font-medium">{item.label}</span>
                      <span className="min-w-0 flex-1 text-muted-foreground">
                        {item.kind === "workspace-file" ? (
                          <PathLabel path={item.description || "."} />
                        ) : (
                          <span className="block truncate">{item.description}</span>
                        )}
                      </span>
                    </span>
                  </CommandItem>
                );
              })}
              {group.note ? (
                <div
                  className="px-2 py-1.5 text-xs text-muted-foreground"
                  data-rich-suggestion-note={group.kind}
                >
                  {group.note}
                </div>
              ) : null}
            </CommandGroup>
          ))}
          {copy.footer ? (
            <div className="border-t px-3 py-2 text-xs text-muted-foreground">
              {copy.footer}
            </div>
          ) : null}
          {copy.footerAction ? (
            <button
              className="sticky bottom-0 flex w-full items-center border-t bg-popover px-3 py-2 text-left font-medium text-primary text-xs hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
              onMouseDown={(event) => event.preventDefault()}
              onClick={copy.footerAction.onSelect}
              type="button"
            >
              {copy.footerAction.label}
            </button>
          ) : null}
        </CommandList>
      </Command>
    </div>
  );
}
