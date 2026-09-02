"use client";

/**
 * [INPUT]: Depends on React, AI SDK FileUIPart, host-injected UI text, pure file-admission rules, and typed useAttachmentList commands
 * [OUTPUT]: Provides the PromptInput value model, localized addValidated errors, workspace entry projection, and attachment access hooks
 * [POS]: The state contract layer of ai-elements PromptInput; Draft owners can upgrade the lifecycle of the attachment to a cross-mounted store
 */

import type { FileUIPart, SourceDocumentUIPart } from "ai";
import {
  selectPromptInputFiles,
  type PromptInputFileError,
} from "../../lib/prompt-input-files";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
  type RefObject,
} from "react";
import {
  useAttachmentList,
  type AttachmentCommand,
  type AttachmentListControl,
} from "../../hooks/use-attachment-list";
import { useUiText } from "../../lib/ui-text";

export type PromptInputFilePart = FileUIPart & {
  /** 原始 File 句柄：交给受信 preload 授权或 renderer 本地预览，路径不进入业务状态 */
  nativeFile?: File;
};

export type RichNode =
  | { id: string; type: "text"; value: string }
  | {
      id: string;
      type: "skill";
      ref: string;
      name: string;
      label: string;
    }
  | {
      id: string;
      type: "file";
      ref: string;
      name: string;
      mediaType: string;
    }
  | {
      id: string;
      type: "section";
      chatId: string;
      name: string;
      agent: string;
    }
  | {
      id: string;
      type: "history";
      opaqueId: string;
      name: string;
      agent: string;
    }
  | {
      id: string;
      type: "workspace-file";
      path: string;
      /** 旧 wire 缺省按 file；目录语义永远不靠尾斜杠猜。 */
      entryKind?: "file" | "dir";
    };

export type RichValue = RichNode[];

export type PromptInputSnapshot =
  | { kind: "plain"; displayText: string }
  | { kind: "rich"; value: RichValue; displayText: string };

export type PromptInputAdapter = {
  snapshot: () => PromptInputSnapshot;
  clear: () => void;
};

export function richValueDisplayText(value: RichValue) {
  return value
    .map((node) => {
      if (node.type === "text") return node.value;
      if (node.type === "skill") return `$${node.label}`;
      if (node.type === "section" || node.type === "history") return `@${node.name}`;
      if (node.type === "workspace-file") {
        return `@${node.path}${node.entryKind === "dir" ? "/" : ""}`;
      }
      return `[文件: ${node.name}]`;
    })
    .join("");
}

export interface AttachmentsContext {
  files: (PromptInputFilePart & { id: string })[];
  add: (files: File[] | FileList) => void;
  /** 校验与追加共享同一份 fresh filesRef，避免 await 后以陈旧 render 数量越过上限。 */
  addValidated: (
    files: File[] | FileList,
    options: {
      accept?: string;
      /** 返回值保留全部准入文件，仅把匹配项写入附件 store，供非附件 host 消费其余项。 */
      attachmentFileFilter?: (file: File) => boolean;
      externalFileCount?: number;
      maxFiles?: number;
      maxFileSize?: number;
    }
  ) => { files: File[]; error?: PromptInputFileError };
  remove: (id: string) => void;
  clear: () => void;
  command: (command: AttachmentCommand) => void;
  openFileDialog: () => void;
  fileInputRef: RefObject<HTMLInputElement | null>;
}

export interface TextInputContext {
  value: string;
  setInput: (value: string) => void;
  clear: () => void;
}

export interface PromptInputControllerProps {
  textInput: TextInputContext;
  attachments: AttachmentsContext;
  __registerFileInput: (
    ref: RefObject<HTMLInputElement | null>,
    open: () => void
  ) => void;
}

const PromptInputController = createContext<PromptInputControllerProps | null>(
  null
);
const ProviderAttachmentsContext = createContext<AttachmentsContext | null>(
  null
);
export const LocalAttachmentsContext =
  createContext<AttachmentsContext | null>(null);

export const usePromptInputController = () => {
  const context = useContext(PromptInputController);
  if (!context) {
    throw new Error(
      "Wrap your component inside <PromptInputProvider> to use usePromptInputController()."
    );
  }
  return context;
};

export const useOptionalPromptInputController = () =>
  useContext(PromptInputController);

export const useProviderAttachments = () => {
  const context = useContext(ProviderAttachmentsContext);
  if (!context) {
    throw new Error(
      "Wrap your component inside <PromptInputProvider> to use useProviderAttachments()."
    );
  }
  return context;
};

export const useOptionalProviderAttachments = () =>
  useContext(ProviderAttachmentsContext);

export const usePromptInputAttachments = () => {
  const provider = useOptionalProviderAttachments();
  const local = useContext(LocalAttachmentsContext);
  const context = local ?? provider;
  if (!context) {
    throw new Error(
      "usePromptInputAttachments must be used within a PromptInput or PromptInputProvider"
    );
  }
  return context;
};

export type PromptInputProviderProps = PropsWithChildren<{
  initialInput?: string;
  attachments?: AttachmentListControl;
}>;

export const PromptInputProvider = ({
  initialInput = "",
  attachments: controlledAttachments,
  children,
}: PromptInputProviderProps) => {
  const fileTypeError = useUiText(
    "fileTypeError",
    "No files match the accepted types."
  );
  const fileSizeError = useUiText(
    "fileSizeError",
    "All files exceed the maximum size."
  );
  const fileCountError = useUiText(
    "fileCountError",
    "Too many files. Some were not added."
  );
  const fileMessages = useMemo(
    () => ({
      accept: fileTypeError,
      max_file_size: fileSizeError,
      max_files: fileCountError,
    }),
    [fileCountError, fileSizeError, fileTypeError]
  );
  const [textInput, setTextInput] = useState(initialInput);
  // blob URL 生命周期统一在 useAttachmentList（与 PromptInput 本地路径共用同一实现）
  const list = useAttachmentList(controlledAttachments);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // oxlint-disable-next-line eslint(no-empty-function)
  const openRef = useRef<() => void>(() => {});
  const clearInput = useCallback(() => setTextInput(""), []);
  const { add: listAdd } = list;
  const add = useCallback(
    (files: File[] | FileList) => listAdd([...files]),
    [listAdd]
  );
  const addValidated = useCallback<AttachmentsContext["addValidated"]>(
    (files, options) => {
      const selection = selectPromptInputFiles(files, {
        accept: options.accept,
        currentCount:
          list.filesRef.current.length + (options.externalFileCount ?? 0),
        maxFiles: options.maxFiles,
        maxFileSize: options.maxFileSize,
        messages: fileMessages,
      });
      const attachments = options.attachmentFileFilter
        ? selection.files.filter(options.attachmentFileFilter)
        : selection.files;
      if (attachments.length > 0) listAdd(attachments);
      return selection;
    },
    [fileMessages, list.filesRef, listAdd]
  );

  const openFileDialog = useCallback(() => openRef.current?.(), []);
  const attachments = useMemo<AttachmentsContext>(
    () => ({
      add,
      addValidated,
      clear: list.clear,
      command: list.command,
      fileInputRef,
      files: list.files,
      openFileDialog,
      remove: list.remove,
    }),
    [
      add,
      addValidated,
      list.clear,
      list.command,
      list.files,
      list.remove,
      openFileDialog,
    ]
  );
  const registerFileInput = useCallback(
    (ref: RefObject<HTMLInputElement | null>, open: () => void) => {
      fileInputRef.current = ref.current;
      openRef.current = open;
    },
    []
  );
  const controller = useMemo<PromptInputControllerProps>(
    () => ({
      __registerFileInput: registerFileInput,
      attachments,
      textInput: {
        clear: clearInput,
        setInput: setTextInput,
        value: textInput,
      },
    }),
    [attachments, clearInput, registerFileInput, textInput]
  );

  return (
    <PromptInputController.Provider value={controller}>
      <ProviderAttachmentsContext.Provider value={attachments}>
        {children}
      </ProviderAttachmentsContext.Provider>
    </PromptInputController.Provider>
  );
};

export interface ReferencedSourcesContext {
  sources: (SourceDocumentUIPart & { id: string })[];
  add: (sources: SourceDocumentUIPart[] | SourceDocumentUIPart) => void;
  remove: (id: string) => void;
  clear: () => void;
}

export const LocalReferencedSourcesContext =
  createContext<ReferencedSourcesContext | null>(null);

export const usePromptInputReferencedSources = () => {
  const context = useContext(LocalReferencedSourcesContext);
  if (!context) {
    throw new Error(
      "usePromptInputReferencedSources must be used within a LocalReferencedSourcesContext.Provider"
    );
  }
  return context;
};
