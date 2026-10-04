/**
 * [INPUT]: Frozen native composer input, explicit local File custody and draft-owned target-bound reference provenance.
 * [OUTPUT]: Target-checked remote input and native-submit rejection for foreign workspace references without transmitting local filesystem grants,
 *           and remoteDraftLocks (the text locks with the turn controls while a create attempt is retained; F-40).
 * [POS]: Native draft transport adapter; unsupported native-only references remain in the editor on rejection.
 */
import type { PromptInputMessage } from "@ai-chat/ui/components/ai-elements/prompt-input";
import type { RemoteReference } from "@ai-chat/cloud-protocol/remote/input/references";
import { assertRemoteReferenceTarget } from "@ai-chat/cloud-protocol/remote/input/references";
import type {PluginSource} from "@bottega/contracts/plugins/surface/source";
import { readComposer } from "@/lib/chat/state/composer/chat-composer-store";
export function assertLocalDraftReferences(message: PromptInputMessage, known: readonly RemoteReference[], localDeviceId: string | null | undefined) {
  const paths = new Set(message.input.kind === "rich" ? message.input.value.filter(node => node.type === "workspace-file").map(node => node.path) : []);
  if (known.some(reference => reference.kind === "file" && paths.has(reference.path) && reference.deviceId !== localDeviceId)) {
    throw new Error("reference-target-mismatch");
  }
}
export async function remoteDraftInput(chatId: string, target: string, message: PromptInputMessage, known: readonly RemoteReference[]) {
  const references: RemoteReference[] = [], files: File[] = [], pluginSources = new Map<File,PluginSource>();
  const value = message.input.kind === "rich" ? message.input.value : [];
  for (const node of value) {
    if (node.type === "text") continue;
    if (node.type === "file") {
      const file = readComposer(chatId).fileResources.get(node.id)?.file;
      if (!file) throw new Error("attachment-unavailable");
      files.push(file); continue;
    }
    if (node.type === "skill" && node.ref.startsWith("library:")) { references.push({ kind: "skill", libraryId: node.ref.slice(8) }); continue; }
    if (node.type === "workspace-file") {
      const reference = known.find(item => item.kind === "file" && item.path === node.path);
      if (!reference) throw new Error("reference-target-mismatch");
      references.push(reference); continue;
    }
    throw new Error("input-unsupported");
  }
  assertRemoteReferenceTarget(references, target);
  for (const part of message.files) {
    if (part.nativeFile) { files.push(part.nativeFile); const source = readComposer(chatId).sketch.pluginSources?.get((part as {id?:string}).id??""); if(source)pluginSources.set(part.nativeFile,source); continue; }
    if (!part.url.startsWith("blob:") && !part.url.startsWith("data:")) throw new Error("attachment-unavailable");
    const response = await fetch(part.url);
    files.push(new File([await response.blob()], part.filename ?? "image", { type: part.mediaType }));
  }
  const text = message.input.kind === "rich" ? value.filter(node => node.type === "text").map(node => node.value).join("") : message.input.displayText;
  return { text, files, references, pluginSources };
}

/**
 * F-40: while a create attempt is retained (its reply may have been lost), Retry must send exactly what was frozen — an edit
 * would be silently ignored, and a fresh attempt could create a second Chat. So the text locks with the turn controls, as
 * the Web create page does; a definitive refusal or success clears the attempt and unlocks it.
 */
export const remoteDraftLocks = (busy: boolean, retainedAttempt: boolean) =>
  ({ inputDisabled: busy || retainedAttempt, turnControlsDisabled: busy || retainedAttempt });
