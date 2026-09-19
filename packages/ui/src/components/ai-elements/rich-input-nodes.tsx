"use client";

/**
 * [INPUT]: Depends on PromptInput RichValue, host activation feedback, candidate icons, invalid-state metadata, and PathLabel
 * [OUTPUT]: Provides RichInputNodes with atomic chip activation, Enter/Space handling, focus rings, invalid state, host-owned file chip states (busy spinner, bad tone), and 44px coarse-pointer targets
 * [POS]: RichInput node view layer; editing history and candidate ownership remain in rich-input.tsx
 */

import { LoaderCircle, PackageIcon } from "lucide-react";
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

export type RichFileState = { kind: "busy" | "bad"; title?: string };

export function RichInputNodes({
  value,
  onFileClick,
  onWorkspaceFileClick,
  fileClickTitle,
  workspaceFileClickTitle,
  renderSectionIcon,
  invalidSkillRefs,
  invalidSkillTitle,
  fileStates,
}: {
  value: RichValue;
  onFileClick?: (node: NodeOf<"file">) => void;
  onWorkspaceFileClick?: (node: NodeOf<"workspace-file">) => void;
  fileClickTitle?: string;
  workspaceFileClickTitle?: string;
  renderSectionIcon?: (agent: string) => ReactNode;
  invalidSkillRefs?: readonly string[];
  invalidSkillTitle?: string;
  /** Host-owned state of a file chip by ref: busy shows a spinner, bad turns the chip destructive; the title explains either. */
  fileStates?: Readonly<Record<string, RichFileState>>;
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
      const invalid = invalidSkillRefs?.includes(node.ref) ?? false;
      return (
        <span
          aria-invalid={invalid || undefined}
          className={invalid
            ? "mx-0.5 inline-flex select-none items-center gap-1 rounded-md bg-destructive/10 px-1.5 py-0.5 align-baseline text-destructive ring-1 ring-destructive/30"
            : "mx-0.5 inline-flex select-none items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 align-baseline text-primary"}
          contentEditable={false}
          data-rich-node-id={node.id}
          key={node.id}
          title={invalid ? invalidSkillTitle : undefined}
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
          /* title 只说「我是谁」：PathLabel 会截断头部，悬停是读全路径的唯一出口，
             与 dir chip 同构。可点击这件事由 aria-label 与手型/hover 承担。 */
          title={node.path}
          type="button"
        >
          {content}
        </button>
      );
    }
    const state = fileStates?.[node.ref];
    const Icon = state?.kind === "busy" ? LoaderCircle : fileIcon(node.name);
    const content = (
      <>
        <Icon className={state?.kind === "busy" ? "size-4 shrink-0 animate-spin motion-reduce:animate-none" : "size-4 shrink-0"} />
        <span className="truncate">{node.name}</span>
      </>
    );
    const tone = state?.kind === "bad"
      ? "text-destructive hover:text-destructive"
      : "text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300";
    if (!onFileClick) {
      return (
        <span
          aria-invalid={state?.kind === "bad" || undefined}
          className={`mx-0.5 inline-flex max-w-64 select-none items-center gap-1 rounded-md px-1 py-0.5 align-baseline ${tone}`}
          contentEditable={false}
          data-rich-node-id={node.id}
          data-file-state={state?.kind}
          key={node.id}
          title={state?.title}
        >
          {content}
        </span>
      );
    }
    const activate = () => onFileClick(node);
    return (
      <button
        aria-invalid={state?.kind === "bad" || undefined}
        className={`mx-0.5 inline-flex max-w-64 cursor-pointer select-none items-center gap-1 rounded-md px-1 py-0.5 align-baseline hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11 ${tone}`}
        contentEditable={false}
        data-rich-node-id={node.id}
        data-file-state={state?.kind}
        key={node.id}
        onClick={activate}
        onKeyDown={(event) => activateWithKeyboard(event, activate)}
        onMouseDown={(event) => event.preventDefault()}
        title={state?.title ?? fileClickTitle}
        type="button"
      >
        {content}
      </button>
    );
  });
}
