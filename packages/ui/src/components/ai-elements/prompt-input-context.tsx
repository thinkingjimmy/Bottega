"use client";

/**
 * [INPUT]: Depends on React, AI SDK FileUIPart, host-injected UI text, pure file-admission rules, and typed useAttachmentList commands
 * [OUTPUT]: Provides the PromptInput value model, the shared file-admission helpers (usePromptInputFileMessages/admitAttachmentFiles), workspace entry projection, and attachment access hooks
 * [POS]: The state contract layer of ai-elements PromptInput; Draft owners can upgrade the lifecycle of the attachment to a cross-mounted store
 */

import type { FileUIPart } from "ai";
import {
  selectPromptInputFiles,
  type PromptInputFileError,
  type PromptInputFileMessages,
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

export type AttachmentAdmissionOptions = {
  accept?: string;
  /** 返回值保留全部准入文件，仅把匹配项写入附件 store，供非附件 host 消费其余项。 */
  attachmentFileFilter?: (file: File) => boolean;
  externalFileCount?: number;
  maxFiles?: number;
  maxFileSize?: number;
};

export interface AttachmentsContext {
  files: (PromptInputFilePart & { id: string })[];
  add: (files: File[] | FileList) => void;
  /** 校验与追加共享同一份 fresh filesRef，避免 await 后以陈旧 render 数量越过上限。 */
  addValidated: (
    files: File[] | FileList,
    options: AttachmentAdmissionOptions
  ) => { files: File[]; error?: PromptInputFileError };
  remove: (id: string) => void;
  clear: () => void;
  command: (command: AttachmentCommand) => void;
  openFileDialog: () => void;
  fileInputRef: RefObject<HTMLInputElement | null>;
}

export function usePromptInputFileMessages(): PromptInputFileMessages {
  const accept = useUiText("fileTypeError", "No files match the accepted types.");
  const maxFileSize = useUiText(
    "fileSizeError",
    "All files exceed the maximum size."
  );
  const maxFiles = useUiText(
    "fileCountError",
    "Too many files. Some were not added."
  );
  return useMemo(
    () => ({ accept, max_file_size: maxFileSize, max_files: maxFiles }),
    [accept, maxFileSize, maxFiles]
  );
}

/** Admits against the list's fresh count and appends only the filtered attachments. */
export function admitAttachmentFiles(
  list: Pick<ReturnType<typeof useAttachmentList>, "add" | "filesRef">,
  messages: PromptInputFileMessages,
  files: File[] | FileList,
  options: AttachmentAdmissionOptions
) {
  const selection = selectPromptInputFiles(files, {
    accept: options.accept,
    currentCount: list.filesRef.current.length + (options.externalFileCount ?? 0),
    maxFiles: options.maxFiles,
    maxFileSize: options.maxFileSize,
    messages,
  });
  const attachments = options.attachmentFileFilter
    ? selection.files.filter(options.attachmentFileFilter)
    : selection.files;
  if (attachments.length > 0) list.add(attachments);
  return selection;
}

interface TextInputContext {
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

export const useOptionalPromptInputController = () =>
  useContext(PromptInputController);

export const usePromptInputAttachments = () => {
  const provider = useContext(ProviderAttachmentsContext);
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
  const fileMessages = usePromptInputFileMessages();
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
    (files, options) => admitAttachmentFiles(list, fileMessages, files, options),
    [fileMessages, list]
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
