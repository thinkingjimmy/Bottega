/**
 * [INPUT]: Depends on PromptInput RichNode/RichValue and ReactNode
 * [OUTPUT]: Provides RichQuery/group/suggestion/copy/handle/props Public type
 * [POS]: The boundary of the stable type of ai-elements RichInput; The state-machine, pure model and candidate view are consumable in a one-way contract to avoid type cycles
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
};

export type RichSuggestionGroup = {
  kind: RichInputSuggestion["kind"];
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
