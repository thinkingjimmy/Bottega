"use client";

/**
 * [INPUT]: Depends on PromptInput RichValue, RichInput hosts activate feedback, candidate icons and PathLabel
 * [OUTPUT]: Provides RichInputNodes; Activate the chip, swallow the Enter/Space, focus ring and coarse-pointer 44px minimum target, static nodes without the fake button
 * [POS]: ai-elements RichInput node view layer; Edit/history/candidate matters remain with rich-input.tsx, with nodes only responsible for semantics and activating surfaces
 */

import { PackageIcon } from "lucide-react";
import type { KeyboardEvent, ReactNode } from "react";
import type { RichNode, RichValue } from "./prompt-input";
import {
  fileIcon,
  PathLabel,
  workspaceEntryIcon,
} from "./rich-input-suggestions";

type NodeOf<Type extends RichNode["type"]> = Extract<RichNode, { type: Type }>;

function activateWithKeyboard(
  event: KeyboardEvent<HTMLButtonElement>,
  activate: () => void
) {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  event.stopPropagation();
  activate();
}

export function RichInputNodes({
  value,
  onFileClick,
  onWorkspaceFileClick,
  fileClickTitle,
  workspaceFileClickTitle,
  renderSectionIcon,
}: {
  value: RichValue;
  onFileClick?: (node: NodeOf<"file">) => void;
  onWorkspaceFileClick?: (node: NodeOf<"workspace-file">) => void;
  fileClickTitle?: string;
  workspaceFileClickTitle?: string;
  renderSectionIcon?: (agent: string) => ReactNode;
}) {
  return value.map((node) => {
    if (node.type === "text") {
      if (!node.value) return null;
      return (
        <span data-rich-text-id={node.id} key={node.id}>
          {node.value}
        </span>
      );
    }
    if (node.type === "skill") {
      return (
        <span
          className="mx-0.5 inline-flex select-none items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 align-baseline text-primary"
          contentEditable={false}
          data-rich-node-id={node.id}
          key={node.id}
        >
          <PackageIcon className="size-3.5" />${node.label}
        </span>
      );
    }
    if (node.type === "section" || node.type === "history") {
      return (
        <span
          className="mx-0.5 inline-flex select-none items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 align-baseline text-primary"
          contentEditable={false}
          data-rich-node-id={node.id}
          key={node.id}
        >
          {renderSectionIcon?.(node.agent)}@{node.name}
        </span>
      );
    }
    if (node.type === "workspace-file") {
      const Icon = workspaceEntryIcon(node.entryKind, node.path);
      const displayPath = `${node.path}${node.entryKind === "dir" ? "/" : ""}`;
      const content = (
        <>
          <Icon className="size-3.5 shrink-0" />
          <span className="shrink-0">@</span>
          <PathLabel path={displayPath} />
        </>
      );
      if (node.entryKind === "dir" || !onWorkspaceFileClick) {
        return (
          <span
            className="mx-0.5 inline-flex max-w-64 select-none items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 align-baseline text-primary"
            contentEditable={false}
            data-rich-node-id={node.id}
            key={node.id}
            title={node.path}
          >
            {content}
          </span>
        );
      }
      const activate = () => onWorkspaceFileClick(node);
      return (
        <button
          aria-label={
            workspaceFileClickTitle
              ? `${workspaceFileClickTitle} ${node.path}`
              : node.path
          }
          className="mx-0.5 inline-flex max-w-64 cursor-pointer select-none items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 align-baseline text-primary hover:bg-muted/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11"
          contentEditable={false}
          data-rich-node-id={node.id}
          key={node.id}
          onClick={activate}
          onKeyDown={(event) => activateWithKeyboard(event, activate)}
          onMouseDown={(event) => event.preventDefault()}
          title={workspaceFileClickTitle ?? node.path}
          type="button"
        >
          {content}
        </button>
      );
    }
    const Icon = fileIcon(node.name);
    const content = (
      <>
        <Icon className="size-4 shrink-0" />
        <span className="truncate">{node.name}</span>
      </>
    );
    if (!onFileClick) {
      return (
        <span
          className="mx-0.5 inline-flex max-w-64 select-none items-center gap-1 rounded-md px-1 py-0.5 align-baseline text-blue-500 dark:text-blue-400"
          contentEditable={false}
          data-rich-node-id={node.id}
          key={node.id}
        >
          {content}
        </span>
      );
    }
    const activate = () => onFileClick(node);
    return (
      <button
        className="mx-0.5 inline-flex max-w-64 cursor-pointer select-none items-center gap-1 rounded-md px-1 py-0.5 align-baseline text-blue-500 hover:bg-muted hover:text-blue-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 dark:text-blue-400 dark:hover:text-blue-300 [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11"
        contentEditable={false}
        data-rich-node-id={node.id}
        key={node.id}
        onClick={activate}
        onKeyDown={(event) => activateWithKeyboard(event, activate)}
        onMouseDown={(event) => event.preventDefault()}
        title={fileClickTitle}
        type="button"
      >
        {content}
      </button>
    );
  });
}
