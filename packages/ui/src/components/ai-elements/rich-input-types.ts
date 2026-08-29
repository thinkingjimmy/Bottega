/**
 * [INPUT]: Depends on PromptInput RichNode/RichValue and ReactNode
 * [OUTPUT]: Provides public RichQuery, multi-kind group, suggestion, structured footer action, invalid-state, copy, handle, and props types
 * [POS]: Stable RichInput type boundary shared one-way by the state machine, pure model, and candidate view
 */

import type { ReactNode } from "react";
import type { RichNode, RichValue } from "./prompt-input";

export type RichQuery = {
  kind: "skill" | "mention";
  nodeId: string;
  start: number;
  value: string;
};

export type RichInputSuggestion =
  | {
      kind: "skill";
      ref: string;
      name: string;
      label: string;
      description: string;
      icon?: ReactNode;
    }
  | {
      kind: "section";
      chatId: string;
      name: string;
      label: string;
      description: string;
      agent: string;
      icon?: ReactNode;
    }
  | {
      kind: "history";
      opaqueId: string;
      name: string;
      label: string;
      description: string;
      agent: string;
      icon?: ReactNode;
    }
  | {
      kind: "workspace-file";
      path: string;
      label: string;
      description: string;
      entryKind?: "file" | "dir";
      icon?: ReactNode;
    };

export type RichSuggestionCopy = {
  empty: string;
  noMatch: string;
  groups: readonly RichSuggestionGroup[];
  footer?: string;
  footerAction?: Readonly<{ label: string; onSelect: () => void }>;
};

export type RichSuggestionGroup = {
  kind: RichInputSuggestion["kind"];
  /** 多个候选身份可共享一个视觉组；kind 仍是该组稳定的渲染身份。 */
  kinds?: readonly RichInputSuggestion["kind"][];
  label: string;
  /** 在过滤与排序之后裁剪，避免空 query 渲染无界列表且不牺牲后段命中。 */
  limit?: number;
  note?: string;
  /** 同一候选组可由 @ / $ 多入口唤起；缺省保持旧 kind 映射。 */
  triggers?: readonly RichQuery["kind"][];
};

export type RichInputHandle = {
  focus: () => void;
  saveSelection: () => void;
  insertNode: (node: Exclude<RichNode, { type: "text" }>) => void;
};

export type RichInputProps = {
  value: RichValue;
  onChange: (value: RichValue) => void;
  onNodeDiscarded?: (node: Exclude<RichNode, { type: "text" }>) => void;
  onFileClick?: (node: Extract<RichNode, { type: "file" }>) => void;
  onWorkspaceFileClick?: (
    node: Extract<RichNode, { type: "workspace-file" }>
  ) => void;
  onSuggestionSelect?: (
    item: RichInputSuggestion
  ) => boolean | Promise<boolean>;
  onSuggestionPendingChange?: (pending: boolean) => void;
  fileClickTitle?: string;
  workspaceFileClickTitle?: string;
  invalidSkillRefs?: readonly string[];
  invalidSkillTitle?: string;
  suggestions?: RichInputSuggestion[];
  suggestionCopy?: Partial<
    Record<RichQuery["kind"], Partial<RichSuggestionCopy>>
  >;
  onQueryChange?: (query: RichQuery | null) => void;
  renderSectionIcon?: (agent: string) => ReactNode;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
};
