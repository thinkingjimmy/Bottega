/**
 * [INPUT]: Complete draft state, target capabilities, the existing remote upload port and the remote feedback toast.
 * [OUTPUT]: Shared Files, Sketch, Plan and permission controls plus drop/paste admission; every unsupported input flags its own control (file, Plan chip, permission chip), images show processing/rejected/reselect states, and a rejected add becomes a toast.; with `textOnly` (U06-c) no Files or Sketch and a dropped or pasted file refused with the rule
 * [POS]: Remote input presentation; send and account lifecycle remain with the parent.
 */
import { useMemo, useRef, useState, type ClipboardEvent, type DragEvent } from "react";
import type { RemoteComposerCapabilities, RemotePermissionMode } from "@ai-chat/cloud-protocol/remote/input/model";
import type { RemoteCommandPort } from "../../../platform/remote/contracts";
import type { ComposerDraft, DraftFile, RemoteDraftStore } from "../../../platform/remote/input/draft";
import { ComposerAddMenu } from "../../composer/controls/add";
import { useComposerTranslation } from "../../composer/controls/copy/translation";
import { ChatPermissionSelector } from "../../composer/controls/permission";
import { ChatPlanChip } from "../../composer/controls/plan-chip";
import { backendName, type RemoteCopy } from "../../../i18n/messages/remote";
import { RemoteDraftFiles, draftFileFailure, draftFileProblem } from "./input/files";
import type { RemoteFileState } from "./input/editor";
import type {PluginComposerEntry} from "../../../plugins/host/contracts";
import { useRemoteSketch } from "./input/sketch";
import { remoteInputCopy } from "./copy";
import type { useRemoteFeedback } from "./feedback";
const EMPTY_PLUGINS:readonly PluginComposerEntry[]=[];
export function useRemoteComposerControls(input: { store: RemoteDraftStore; draft: ComposerDraft; port?: RemoteCommandPort; chatId?: string;
  capabilities?: RemoteComposerCapabilities; permissionMode: RemotePermissionMode; locale: string; backend: string; disabled: boolean;
  plugins?:readonly PluginComposerEntry[]; ownerDeviceId?:string; incarnationId?:string; draftKey?:string;
  copy: RemoteCopy; feedback: ReturnType<typeof useRemoteFeedback>;
  /** U06-c: the rule when this message takes no files (an App's first Edit message); files and sketch are then not offered and a dropped or pasted file is refused with it. */
  textOnly?: string }) {
  const { store, draft, port, chatId, capabilities, permissionMode, locale, disabled, copy, feedback } = input;
  const composerText = useComposerTranslation(locale);
  const scope=useMemo(()=>({chatId:chatId??input.draftKey??"new:root",incarnationId:input.incarnationId??"",ownerDeviceId:input.ownerDeviceId??""}),[chatId,input.draftKey,input.incarnationId,input.ownerDeviceId]);
  const picker = useRef<HTMLInputElement>(null), sketch = useRemoteSketch(store, locale, port?.lifetime,{entries:input.plugins??EMPTY_PLUGINS,scope}), text = remoteInputCopy(locale);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const agent = backendName(input.backend);
  const add = (files: File[]) => {
    if (disabled) return;
    if (input.textOnly) { feedback.notify({ title: copy.filesRejected, description: input.textOnly }); return; }
    try { store.add(files); } catch { feedback.notify({ title: copy.filesRejected, description: text.limits }); }
  };
  const accept = (file: DraftFile) => file.image ? capabilities?.imageInput : capabilities?.fileInput;
  const unsupportedFile = (file: DraftFile) => capabilities && !accept(file) ? copy.unsupportedFile.replace("{agent}", agent) : null;
  const planUnavailable = draft.planMode && capabilities && !capabilities.planMode ? copy.planUnavailable.replace("{agent}", agent) : undefined;
  const permissionUnavailable = capabilities && !capabilities.permissionModes.includes(permissionMode) ? copy.permissionUnavailable.replace("{agent}", agent) : undefined;
  const unsupported = draft.files.some(file => unsupportedFile(file) !== null) || Boolean(planUnavailable) || Boolean(permissionUnavailable);
  const events = {
    onDragOver: (event: DragEvent) => { if (event.dataTransfer.types.includes("Files")) { event.preventDefault(); event.dataTransfer.dropEffect = disabled ? "none" : "copy"; } },
    onDrop: (event: DragEvent) => { if (event.dataTransfer.files.length) { event.preventDefault(); add(Array.from(event.dataTransfer.files)); } },
    onPaste: (event: ClipboardEvent) => { if (event.clipboardData.files.length) { event.preventDefault(); add(Array.from(event.clipboardData.files)); } },
  };
  const reselect = (file: DraftFile) => { if (disabled) return; store.remove(file.id); picker.current?.click(); };
  const retry = (file: DraftFile) => { if (chatId && port?.attachments) void store.stage(file, chatId, port.attachments, port.lifetime ?? new AbortController().signal).catch(() => {}); };
  const fileStates: Record<string, RemoteFileState> = {};
  for (const file of draft.files) {
    const reason = unsupportedFile(file), problem = draftFileProblem(file, text);
    if (problem) fileStates[file.id] = { kind: "bad", title: problem };
    else if (file.state === "processing") fileStates[file.id] = { kind: "busy", title: text.processing };
    else if (file.state === "failed") fileStates[file.id] = { kind: "bad", title: draftFileFailure(file, text) };
    else if (reason) fileStates[file.id] = { kind: "bad", title: reason };
    else if (file.state === "uploading") fileStates[file.id] = { kind: "busy", title: text.uploading };
  }
  return { events, unsupported, editing: sketch.active, fileStates,
    /* A failed chip is its own retry button, a chip lost on reload reopens the picker, one still processing or rejected has nothing to preview. */
    openFile: (id: string) => { const file = draft.files.find(file => file.id === id); if (!file) return; if (file.state === "failed") retry(file);
      else if (file.state === "reselect") reselect(file); else if (file.state !== "processing" && file.state !== "rejected") setPreviewId(id); },
    tools: <>{!input.textOnly && <input ref={picker} type="file" multiple className="sr-only" tabIndex={-1} aria-hidden="true" onChange={event => { add(Array.from(event.target.files ?? [])); event.target.value = ""; }} />}
      <ComposerAddMenu locale={locale} disabled={disabled} files={port?.attachments && !input.textOnly ? { disabled: draft.files.length >= 8 || !capabilities?.fileInput && !capabilities?.imageInput, run: () => picker.current?.click() } : undefined}
        plugins={port?.attachments && !input.textOnly ? (input.plugins??[]).filter(entry=>entry.enabled&&!entry.records).map(entry=>({id:entry.id,name:entry.id==='sketch'?composerText('sketch.title'):entry.composer.title,icon:entry.composer.icon,
          disabled:!sketch.available||!entry.enabled||!entry.generationId||draft.files.length>=8||!capabilities?.imageInput,
          reason:(!entry.generationId?entry.error:undefined)??(!entry.enabled?composerText('sketch.readOnly'):draft.files.length>=8?composerText('sketch.attachmentLimit'):undefined),run:anchor=>sketch.open(entry,anchor)})) : []}
        plan={{ active: draft.planMode, disabled: !capabilities?.planMode, run: () => store.update({ planMode: !draft.planMode }) }} preload={sketch.preload} />
      <ChatPermissionSelector locale={locale} value={permissionMode} disabled={disabled || !capabilities} allowedModes={capabilities?.permissionModes} backendDisplayName={agent}
        unavailableTitle={permissionUnavailable} deferConfirmation onChange={async permissionMode => store.update({ permissionMode, consent: null })} />
      {draft.planMode && <ChatPlanChip locale={locale} unavailableTitle={planUnavailable} onClose={() => { if (!disabled) store.update({ planMode: false }); }} />}</>,
    files: <RemoteDraftFiles draft={draft} locale={locale} disabled={disabled} unsupported={unsupportedFile} remove={id => store.remove(id)} previewId={previewId} onPreview={setPreviewId}
      edit={sketch.edit} editable={sketch.editable} retry={retry} reselect={reselect} />,
    dialogs: sketch.dialog,
  };
}
