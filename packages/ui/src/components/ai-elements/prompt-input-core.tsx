"use client";

/**
 * [INPUT]: Depends on React, PromptInput context and its shared admission helpers, typed attachment commands, host-injected UI text, and abort-aware submission gates
 * [OUTPUT]: Provides the PromptInput form transaction, fresh-count attachment admission shared by provider and local paths, and PromptInputBody
 * [POS]: The submission and attachment-admission core of ai-elements PromptInput; provider and local paths share the same pure selection rules
 */

import { InputGroup } from "@ai-chat/ui/components/ui/input-group";
import { useUiText } from "@ai-chat/ui/lib/ui-text";
import {
  awaitSubmissionStep,
  PromptInputSubmissionGate,
  throwIfSubmissionAborted,
} from "@ai-chat/ui/lib/prompt-input-submission";
import { cn } from "@ai-chat/ui/lib/utils";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEventHandler,
  type ClipboardEventHandler,
  type FormEvent,
  type FormEventHandler,
  type HTMLAttributes,
} from "react";
import {
  admitAttachmentFiles,
  LocalAttachmentsContext,
  useOptionalPromptInputController,
  usePromptInputFileMessages,
  type AttachmentsContext,
  type PromptInputAdapter,
  type PromptInputFilePart,
  type PromptInputSnapshot,
} from "./prompt-input-context";
import {
  attachmentCommandTarget,
  useAttachmentList,
} from "../../hooks/use-attachment-list";

async function convertBlobUrlToDataUrl(
  url: string,
  signal: AbortSignal
): Promise<string | null> {
  try {
    const response = await fetch(url, { signal });
    throwIfSubmissionAborted(signal);
    const blob = await response.blob();
    throwIfSubmissionAborted(signal);
    return new Promise((resolve) => {
      const reader = new FileReader();
      const onAbort = () => reader.abort();
      signal.addEventListener("abort", onAbort, { once: true });
      const finish = (value: string | null) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      };
      // oxlint-disable-next-line eslint-plugin-unicorn(prefer-add-event-listener)
      reader.onloadend = () => finish(reader.result as string);
      // oxlint-disable-next-line eslint-plugin-unicorn(prefer-add-event-listener)
      reader.onerror = () => finish(null);
      reader.readAsDataURL(blob);
      if (signal.aborted) onAbort();
    });
  } catch {
    throwIfSubmissionAborted(signal);
    return null;
  }
}

function filesFromClipboard(clipboard: DataTransfer | null): File[] {
  if (!clipboard) return [];
  const files = [...clipboard.items]
    .filter((item) => item.kind === "file")
    .map((item) => item.getAsFile())
    .filter((file): file is File => Boolean(file));
  return files.length > 0 ? files : [...clipboard.files];
}

export interface PromptInputMessage {
  input: PromptInputSnapshot;
  files: PromptInputFilePart[];
  /** 宿主在首个 await 前冻结的严格 sidecar；UI 只透传，不解释业务语义。 */
  submissionData?: unknown;
}

export type PromptInputSubmitContext = { signal: AbortSignal };

export type PromptInputProps = Omit<
  HTMLAttributes<HTMLFormElement>,
  "onSubmit" | "onError"
> & {
  accept?: string;
  multiple?: boolean;
  globalDrop?: boolean;
  syncHiddenInput?: boolean;
  maxFiles?: number;
  maxFileSize?: number;
  /** RichInput/file nodes 占用同一附件上限时传入其当前数量 */
  externalFileCount?: number;
  /** 返回 true 的文件进入 attachment context；其余由 onFilesAccepted 接管 */
  attachmentFileFilter?: (file: File) => boolean;
  /** 禁止文件对话框与拖放准入；文本提交状态由消费方独立控制 */
  attachmentsDisabled?: boolean;
  /** 从快照到异步图片转换、发送与清理结束期间投影 true */
  onSubmissionPendingChange?: (pending: boolean) => void;
  /** 可选受控清空：提交期间用户继续编辑时只消费原快照，不清新输入。 */
  clearIfUnchanged?: boolean;
  /** desktop 将 signal custody 转交事务后，组件卸载不再取消提交。 */
  preserveSubmissionOnUnmount?: boolean;
  onFilesAccepted?: (files: File[]) => void;
  inputAdapter?: PromptInputAdapter;
  /** 提交 gate 内、任何异步附件转换前恰好调用一次。 */
  prepareSubmission?: (message: PromptInputMessage) => PromptInputMessage;
  onError?: (error: {
    code: "max_files" | "max_file_size" | "accept" | "submit";
    message: string;
    /** submit 分支的原始抛出物：消费方据此辨认失败是否已被别处解释过 */
    cause?: unknown;
  }) => void;
  onSubmit: (
    message: PromptInputMessage,
    event: FormEvent<HTMLFormElement>,
    context: PromptInputSubmitContext
  ) => void | Promise<void>;
};

export const PromptInput = ({
  className,
  accept,
  multiple,
  globalDrop,
  syncHiddenInput,
  maxFiles,
  maxFileSize,
  externalFileCount = 0,
  attachmentFileFilter,
  attachmentsDisabled = false,
  onSubmissionPendingChange,
  clearIfUnchanged = false,
  preserveSubmissionOnUnmount = false,
  onFilesAccepted,
  inputAdapter,
  prepareSubmission,
  onError,
  onPasteCapture,
  onSubmit,
  children,
  ...props
}: PromptInputProps) => {
  const uploadFilesLabel = useUiText("uploadFiles", "Upload files");
  const submissionFailed = useUiText(
    "submissionFailed",
    "Submission failed. Please try again."
  );
  const fileMessages = usePromptInputFileMessages();
  const controller = useOptionalPromptInputController();
  const usingProvider = !!controller;
  const inputRef = useRef<HTMLInputElement | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);
  const submissionGateRef = useRef(new PromptInputSubmissionGate());
  const submissionLifecycleRef = useRef(new AbortController());
  const submissionPendingChangeRef = useRef(onSubmissionPendingChange);
  const [submissionPending, setSubmissionPending] = useState(false);
  // 非 Provider 路径的附件列表；blob URL 生命周期统一在 useAttachmentList
  const local = useAttachmentList();
  const files = usingProvider ? controller.attachments.files : local.files;

  /* 附件入口（对话框/拖放/粘贴）在禁用或提交进行中一律关闭；
     custody 已移交的提交不再算「进行中」。 */
  const admissionBlocked = useCallback(
    () =>
      attachmentsDisabled ||
      (!preserveSubmissionOnUnmount && submissionGateRef.current.isActive()),
    [attachmentsDisabled, preserveSubmissionOnUnmount]
  );
  const addValidated = useCallback<AttachmentsContext["addValidated"]>(
    (fileList, options) =>
      usingProvider
        ? controller.attachments.addValidated(fileList, options)
        : admitAttachmentFiles(local, fileMessages, fileList, options),
    [controller, fileMessages, local, usingProvider]
  );
  const add = useCallback(
    (fileList: File[] | FileList) => {
      if (admissionBlocked()) return;
      const selection = addValidated(fileList, {
        accept,
        attachmentFileFilter,
        externalFileCount,
        maxFiles,
        maxFileSize,
      });
      if (selection.error) onError?.(selection.error);
      if (selection.files.length === 0) return;
      onFilesAccepted?.(selection.files);
    },
    [
      accept,
      addValidated,
      admissionBlocked,
      attachmentFileFilter,
      externalFileCount,
      maxFileSize,
      maxFiles,
      onError,
      onFilesAccepted,
    ]
  );
  const clearAttachments = useCallback(() => {
    if (usingProvider) controller.attachments.clear();
    else local.clear();
  }, [controller, local, usingProvider]);
  const remove = usingProvider ? controller.attachments.remove : local.remove;
  const openFileDialog = useCallback(() => {
    if (admissionBlocked()) return;
    if (usingProvider) controller.attachments.openFileDialog();
    else inputRef.current?.click();
  }, [admissionBlocked, controller, usingProvider]);
  const handlePasteCapture: ClipboardEventHandler<HTMLFormElement> =
    useCallback(
      (event) => {
        onPasteCapture?.(event);
        if (event.defaultPrevented || admissionBlocked()) return;
        const pastedFiles = filesFromClipboard(event.clipboardData);
        if (pastedFiles.length === 0) return;
        event.preventDefault();
        event.stopPropagation();
        add(pastedFiles);
      },
      [add, admissionBlocked, onPasteCapture]
    );
  const consumeAfterSubmit = useCallback((consumedFiles: PromptInputFilePart[]) => {
    const targets = consumedFiles.map((file) =>
      attachmentCommandTarget(file as Parameters<typeof attachmentCommandTarget>[0])
    );
    if (usingProvider) {
      controller.attachments.command({
        type: "submit-consume",
        targets,
      });
    } else {
      local.command({ type: "submit-consume", targets });
    }
  }, [controller, local, usingProvider]);

  useEffect(() => {
    submissionPendingChangeRef.current = onSubmissionPendingChange;
  }, [onSubmissionPendingChange]);

  useEffect(() => {
    if (submissionLifecycleRef.current.signal.aborted) {
      submissionLifecycleRef.current = new AbortController();
    }
    const lifecycle = submissionLifecycleRef.current;
    const submissionGate = submissionGateRef.current;
    return () => {
      if (!preserveSubmissionOnUnmount) lifecycle.abort();
      if (submissionGate.isActive()) {
        submissionGate.leave();
        submissionPendingChangeRef.current?.(false);
      }
    };
  }, [preserveSubmissionOnUnmount]);

  useEffect(() => {
    if (!usingProvider) return;
    controller.__registerFileInput(inputRef, () => inputRef.current?.click());
  }, [controller, usingProvider]);
  useEffect(() => {
    if (syncHiddenInput && inputRef.current && files.length === 0) {
      inputRef.current.value = "";
    }
  }, [files, syncHiddenInput]);
  useEffect(() => {
    const target: GlobalEventHandlers | null = globalDrop
      ? document
      : formRef.current;
    if (!target) return;
    const onDragOver = (event: DragEvent) => {
      if (event.dataTransfer?.types?.includes("Files")) event.preventDefault();
    };
    const onDrop = (event: DragEvent) => {
      if (event.dataTransfer?.types?.includes("Files")) event.preventDefault();
      if (event.dataTransfer?.files?.length) add(event.dataTransfer.files);
    };
    target.addEventListener("dragover", onDragOver);
    target.addEventListener("drop", onDrop);
    return () => {
      target.removeEventListener("dragover", onDragOver);
      target.removeEventListener("drop", onDrop);
    };
  }, [add, globalDrop]);
  const handleChange: ChangeEventHandler<HTMLInputElement> = useCallback(
    (event) => {
      if (event.currentTarget.files) add(event.currentTarget.files);
      event.currentTarget.value = "";
    },
    [add]
  );
  const attachmentsContext = useMemo<AttachmentsContext>(
    () => ({
      add,
      addValidated,
      clear: clearAttachments,
      command: usingProvider ? controller.attachments.command : local.command,
      fileInputRef: inputRef,
      files,
      openFileDialog,
      remove,
    }),
    [
      add,
      addValidated,
      clearAttachments,
      controller,
      files,
      local.command,
      openFileDialog,
      remove,
      usingProvider,
    ]
  );
  const handleSubmit: FormEventHandler<HTMLFormElement> = useCallback(
    async (event) => {
      event.preventDefault();
      const submissionGate = submissionGateRef.current;
      if (!submissionGate.tryEnter()) return;
      const signal = submissionLifecycleRef.current.signal;
      const form = event.currentTarget;
      let restoreTextOnError: (() => void) | undefined;
      try {
        throwIfSubmissionAborted(signal);
        setSubmissionPending(true);
        onSubmissionPendingChange?.(true);
        const plainText = usingProvider
          ? controller.textInput.value
          : String(new FormData(form).get("message") || "");
        const input = inputAdapter?.snapshot() ?? {
          kind: "plain" as const,
          displayText: plainText,
        };
        const submittedInput = JSON.stringify(input);
        if (!usingProvider && !inputAdapter) form.reset();
        restoreTextOnError = () => {
          if (usingProvider || inputAdapter) return;
          const field = form.elements.namedItem("message");
          if (field instanceof HTMLTextAreaElement && field.value === "") {
            field.value = plainText;
          }
        };
        const prepared = prepareSubmission?.({ files, input }) ?? {
          files,
          input,
        };
        const convertedFiles = await awaitSubmissionStep(signal, () =>
          Promise.all(
            prepared.files.map(async (item) => {
              if (!item.url?.startsWith("blob:")) return item;
              const dataUrl = await convertBlobUrlToDataUrl(item.url, signal);
              return { ...item, url: dataUrl ?? item.url };
            })
          )
        );
        await awaitSubmissionStep(signal, () =>
          onSubmit(
            { ...prepared, files: convertedFiles },
            event,
            { signal }
          )
        );
        throwIfSubmissionAborted(signal);
        consumeAfterSubmit(prepared.files);
        const unchanged = inputAdapter
          ? JSON.stringify(inputAdapter.snapshot()) === submittedInput
          : usingProvider
            ? controller.textInput.value === plainText
            : true;
        if (!clearIfUnchanged || unchanged) {
          if (inputAdapter) inputAdapter.clear();
          else if (usingProvider) controller.textInput.clear();
        }
      } catch (cause) {
        // prepareSubmission（冻结/校验）抛错必须浮出：静默吞掉等于「点了没反应」
        if (!signal.aborted) {
          restoreTextOnError?.();
          onError?.({
            code: "submit",
            message:
              cause instanceof Error ? cause.message : submissionFailed,
            cause,
          });
        }
      } finally {
        submissionGate.leave();
        if (!signal.aborted) {
          setSubmissionPending(false);
          onSubmissionPendingChange?.(false);
        }
      }
    },
    [
      clearIfUnchanged,
      consumeAfterSubmit,
      controller,
      files,
      inputAdapter,
      onError,
      onSubmissionPendingChange,
      onSubmit,
      prepareSubmission,
      submissionFailed,
      usingProvider,
    ]
  );

  return (
    <LocalAttachmentsContext.Provider value={attachmentsContext}>
      <input
        accept={accept}
        aria-label={uploadFilesLabel}
        className="hidden"
        disabled={attachmentsDisabled || submissionPending}
        multiple={multiple}
        onChange={handleChange}
        ref={inputRef}
        title={uploadFilesLabel}
        type="file"
      />
      <form
        aria-busy={submissionPending}
        className={cn("w-full", className)}
        inert={submissionPending}
        onPasteCapture={handlePasteCapture}
        onSubmit={handleSubmit}
        ref={formRef}
        {...props}
      >
        <InputGroup className="overflow-hidden">{children}</InputGroup>
      </form>
    </LocalAttachmentsContext.Provider>
  );
};

export type PromptInputBodyProps = HTMLAttributes<HTMLDivElement>;
export const PromptInputBody = ({
  className,
  ...props
}: PromptInputBodyProps) => (
  <div className={cn("contents", className)} {...props} />
);
