"use client";

/**
 * [INPUT]: Depends on React, nanoid, blob URL lifecycle and controlled typed command owner
 * [OUTPUT]: Provides useAttachmentList, Gallery origin, unchangeable target/CAS command matches the four types of atomic commands
 * [POS]: the core of the hooks' attachment resources; The revoke responsibility of blob URLs follows the actual owner, controlled unloading without touching the external URL
 */

import { nanoid } from "nanoid";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PromptInputFilePart } from "../components/ai-elements/prompt-input-context";

export type GalleryAttachmentOrigin = {
  kind: "gallery";
  logicalKey: string;
  sourceRevision: string;
  selectionToken: string;
  materializationToken: string;
};

export type AttachmentListItem = PromptInputFilePart & {
  id: string;
  origin?: GalleryAttachmentOrigin;
};

export type AttachmentCommandTarget = {
  attachmentId?: string;
  gallery?: Pick<GalleryAttachmentOrigin, "kind" | "logicalKey" | "selectionToken"> &
    Partial<
      Pick<
        GalleryAttachmentOrigin,
        "sourceRevision" | "materializationToken"
      >
    >;
};

export type AttachmentCommand =
  | { type: "user-remove"; targets: AttachmentCommandTarget[] }
  | { type: "capability-suspend"; targets: AttachmentCommandTarget[] }
  | { type: "submit-consume"; targets: AttachmentCommandTarget[] }
  | { type: "source-gone"; targets: AttachmentCommandTarget[] };

export const attachmentCommandTarget = (
  file: AttachmentListItem
): AttachmentCommandTarget => ({
  attachmentId: file.id,
  ...(file.origin?.kind === "gallery" ? { gallery: { ...file.origin } } : {}),
});

export function attachmentMatchesTarget(
  file: AttachmentListItem,
  target: AttachmentCommandTarget
) {
  if (target.attachmentId && file.id !== target.attachmentId) return false;
  if (!target.gallery) return Boolean(target.attachmentId);
  const origin = file.origin;
  return (
    origin?.kind === "gallery" &&
    origin.logicalKey === target.gallery.logicalKey &&
    origin.selectionToken === target.gallery.selectionToken &&
    (target.gallery.sourceRevision === undefined ||
      origin.sourceRevision === target.gallery.sourceRevision) &&
    (target.gallery.materializationToken === undefined ||
      origin.materializationToken === target.gallery.materializationToken)
  );
}

const toAttachmentPart = (file: File): AttachmentListItem => ({
  filename: file.name,
  id: nanoid(),
  mediaType: file.type,
  nativeFile: file,
  type: "file" as const,
  url: URL.createObjectURL(file),
});

const revoke = (files: readonly AttachmentListItem[]) => {
  for (const file of files) {
    if (file.url) URL.revokeObjectURL(file.url);
  }
};

/**
 * 附件列表 + blob URL 生命周期的单一实现：add 创建 objectURL，
 * remove/clear/卸载负责 revoke。文件准入（accept/大小/数量）不在此处——
 * hook 只保证"进来的 URL 一定会被释放"。
 */
export type AttachmentListControl = {
  files: AttachmentListItem[];
  onChange: (files: AttachmentListItem[]) => void;
  onCommand?: (
    command: AttachmentCommand,
    nextFiles: AttachmentListItem[]
  ) => void;
};

export function useAttachmentList(control?: AttachmentListControl) {
  const [internalFiles, setInternalFiles] = useState<AttachmentListItem[]>([]);
  const files = control?.files ?? internalFiles;
  const filesRef = useRef(files);
  useEffect(() => {
    filesRef.current = files;
  }, [files]);
  const commit = useCallback(
    (next: AttachmentListItem[]) => {
      filesRef.current = next;
      if (control) control.onChange(next);
      else setInternalFiles(next);
    },
    [control]
  );

  const add = useCallback((incoming: File[]) => {
    if (incoming.length === 0) return;
    const next = [...filesRef.current, ...incoming.map(toAttachmentPart)];
    commit(next);
  }, [commit]);

  const command = useCallback(
    (action: AttachmentCommand) => {
      const matches = (file: AttachmentListItem) =>
        action.targets.some((target) => attachmentMatchesTarget(file, target));
      const next = filesRef.current.filter((file) => !matches(file));
      if (control?.onCommand) {
        // 受控模式：owner 是唯一真相源，ref 由 files prop 的同步 effect 更新；
        // 提前改 ref 会在 owner 拒绝命令（如提交期 user-remove）时产生状态分叉
        control.onCommand(action, next);
      } else {
        revoke(filesRef.current.filter(matches));
        commit(next);
      }
    },
    [commit, control]
  );

  const remove = useCallback((id: string) => {
    const found = filesRef.current.find((file) => file.id === id);
    if (!found) return;
    command({ type: "user-remove", targets: [attachmentCommandTarget(found)] });
  }, [command]);

  const clear = useCallback(() => {
    command({
      type: "user-remove",
      targets: filesRef.current.map(attachmentCommandTarget),
    });
  }, [command]);

  const replace = useCallback(
    (next: AttachmentListItem[]) => {
      if (!control) {
        const retained = new Set(next.map((file) => file.id));
        revoke(filesRef.current.filter((file) => !retained.has(file.id)));
      }
      commit(next);
    },
    [commit, control]
  );

  useEffect(
    () => () => {
      if (!control) revoke(filesRef.current);
    },
    [control]
  );

  return { files, filesRef, add, remove, clear, replace, command };
}
