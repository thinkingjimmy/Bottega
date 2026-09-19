/**
 * [INPUT]: Complete draft state, target capabilities, the existing remote upload port and the remote feedback toast.
 * [OUTPUT]: Shared Files, Sketch, Plan and permission controls plus drop/paste admission; every unsupported input flags its own control (file, Plan chip, permission chip) and a rejected add becomes a toast.
 * [POS]: Remote input presentation; send and account lifecycle remain with the parent.
 */
import { useRef, useState, type ClipboardEvent, type DragEvent } from "react";
import type { RemoteComposerCapabilities, RemotePermissionMode } from "@ai-chat/cloud-protocol/remote/input/model";
import type { RemoteCommandPort } from "../../../platform/remote/contracts";
import type { ComposerDraft, DraftFile, RemoteDraftStore } from "../../../platform/remote/input/draft";
import { ComposerAddMenu } from "../../composer/controls/add";
import { ChatPermissionSelector } from "../../composer/controls/permission";
import { ChatPlanChip } from "../../composer/controls/plan-chip";
import { backendName, type RemoteCopy } from "../../../i18n/remote";
import { RemoteDraftFiles } from "./input/files";
import type { RemoteFileState } from "./input/editor";
import { useRemoteSketch } from "./input/sketch";
import { remoteInputCopy } from "./copy";
import type { useRemoteFeedback } from "./feedback";
export function useRemoteComposerControls(input: { store: RemoteDraftStore; draft: ComposerDraft; port?: RemoteCommandPort; chatId?: string;
  capabilities?: RemoteComposerCapabilities; permissionMode: RemotePermissionMode; locale: string; backend: string; disabled: boolean;
  copy: RemoteCopy; feedback: ReturnType<typeof useRemoteFeedback> }) {
  const { store, draft, port, chatId, capabilities, permissionMode, locale, disabled, copy, feedback } = input;
  const picker = useRef<HTMLInputElement>(null), sketch = useRemoteSketch(store, locale, port?.lifetime), text = remoteInputCopy(locale);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const agent = backendName(input.backend);
  const add = (files: File[]) => { if (disabled) return; try { store.add(files); } catch { feedback.notify({ title: copy.filesRejected, description: text.limits }); } };
  const accept = (file: File) => file.type.startsWith("image/") ? capabilities?.imageInput : capabilities?.fileInput;
  const unsupportedFile = (file: DraftFile) => capabilities && !accept(file.file) ? copy.unsupportedFile.replace("{agent}", agent) : null;
  const planUnavailable = draft.planMode && capabilities && !capabilities.planMode ? copy.planUnavailable.replace("{agent}", agent) : undefined;
  const permissionUnavailable = capabilities && !capabilities.permissionModes.includes(permissionMode) ? copy.permissionUnavailable.replace("{agent}", agent) : undefined;
  const unsupported = draft.files.some(file => unsupportedFile(file) !== null) || Boolean(planUnavailable) || Boolean(permissionUnavailable);
  const events = {
    onDragOver: (event: DragEvent) => { if (event.dataTransfer.types.includes("Files")) { event.preventDefault(); event.dataTransfer.dropEffect = disabled ? "none" : "copy"; } },
    onDrop: (event: DragEvent) => { if (event.dataTransfer.files.length) { event.preventDefault(); add(Array.from(event.dataTransfer.files)); } },
    onPaste: (event: ClipboardEvent) => { if (event.clipboardData.files.length) { event.preventDefault(); add(Array.from(event.clipboardData.files)); } },
  };
  const retry = (file: DraftFile) => { if (chatId && port?.attachments) void store.stage(file, chatId, port.attachments, port.lifetime ?? new AbortController().signal).catch(() => {}); };
  const fileStates: Record<string, RemoteFileState> = {};
  for (const file of draft.files) {
    const reason = unsupportedFile(file);
    if (file.state === "failed") fileStates[file.id] = { kind: "bad", title: text.failed };
    else if (reason) fileStates[file.id] = { kind: "bad", title: reason };
    else if (file.state === "uploading") fileStates[file.id] = { kind: "busy", title: text.uploading };
  }
  return { events, unsupported, editing: sketch.active, fileStates,
    /* A failed chip is its own retry button; any other chip opens the preview. */
    openFile: (id: string) => { const file = draft.files.find(file => file.id === id); if (!file) return; if (file.state === "failed") retry(file); else setPreviewId(id); },
    tools: <><input ref={picker} type="file" multiple className="sr-only" tabIndex={-1} aria-hidden="true" onChange={event => { add(Array.from(event.target.files ?? [])); event.target.value = ""; }} />
      <ComposerAddMenu locale={locale} disabled={disabled} files={port?.attachments ? { disabled: draft.files.length >= 8 || !capabilities?.fileInput && !capabilities?.imageInput, run: () => picker.current?.click() } : undefined}
        sketch={port?.attachments ? { disabled: draft.files.length >= 8 || !capabilities?.imageInput, run: sketch.open } : undefined}
        plan={{ active: draft.planMode, disabled: !capabilities?.planMode, run: () => store.update({ planMode: !draft.planMode }) }} preload={sketch.preload} />
      <ChatPermissionSelector locale={locale} value={permissionMode} disabled={disabled || !capabilities} allowedModes={capabilities?.permissionModes} backendDisplayName={agent}
        unavailableTitle={permissionUnavailable} deferConfirmation onChange={async permissionMode => store.update({ permissionMode, consent: null })} />
      {draft.planMode && <ChatPlanChip locale={locale} unavailableTitle={planUnavailable} onClose={() => { if (!disabled) store.update({ planMode: false }); }} />}</>,
    files: <RemoteDraftFiles draft={draft} locale={locale} disabled={disabled} unsupported={unsupportedFile} remove={id => store.remove(id)} previewId={previewId} onPreview={setPreviewId}
      edit={sketch.open} retry={retry} />,
    dialogs: sketch.dialog,
  };
}
