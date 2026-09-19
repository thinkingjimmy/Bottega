/**
 * [INPUT]: Depends on the shared RichInput editor, the draft's text and staged files, and remote input copy.
 * [OUTPUT]: Provides RemoteEditor — the desktop editor on the Web: non-image files are chips inside the text, text stays the draft's plain text, Enter submits the form.
 * [POS]: Remote composer text surface; chip positions live here, the draft store keeps only text and files.
 */
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { RichInput, type RichInputHandle, type RichInputProps } from "@ai-chat/ui/components/ai-elements/rich-input";
import type { RichNode, RichValue } from "@ai-chat/ui/components/ai-elements/prompt-input";
import type { DraftFile, DraftReference } from "../../../../platform/remote/input/draft";
export type RemoteEditorHandle = { focus(): void };
export const isImageFile = (file: DraftFile) => file.file.type.startsWith("image/");
const textOf = (value: RichValue) => value.filter(node => node.type === "text").map(node => node.value).join("");
const fileNode = (file: DraftFile): RichNode => ({ id: `file:${file.id}`, type: "file", ref: file.id, name: file.file.name, mediaType: file.file.type });
const withTrailingText = (value: RichValue): RichValue => value.at(-1)?.type === "text" ? value : [...value, { id: crypto.randomUUID(), type: "text", value: "" }];
/* The store owns text and files; the editor owns where the chips sit. Reconcile only what changed outside the editor:
   files that left the draft lose their chip, files that joined get one appended, and a text that changed elsewhere
   (cleared after a send, an artifact follow-up) replaces the text nodes after the chips. */
const referenceNode = (reference: DraftReference): RichNode => reference.value.kind === "file"
  ? { id: reference.id, type: "workspace-file", path: reference.value.path, entryKind: reference.value.entryKind }
  : { id: reference.id, type: "skill", ref: `library:${reference.value.libraryId}`, name: reference.label, label: reference.label };
const referenceKey = (node: RichNode) => node.type === "workspace-file" ? `file:${node.path}` : node.type === "skill" ? node.ref : null;
function reconcile(value: RichValue, text: string, files: readonly DraftFile[], references: readonly DraftReference[]): RichValue {
  const present = new Set(files.map(file => file.id));
  const keys = new Set(references.map(reference => referenceKey(referenceNode(reference))));
  let next: RichValue = value.filter(node => (node.type !== "file" || present.has(node.ref)) && (referenceKey(node) === null || keys.has(referenceKey(node))));
  const existing = new Set(next.map(referenceKey));
  next.push(...references.map(referenceNode).filter(node => !existing.has(referenceKey(node))));
  const known = new Set(next.filter(node => node.type === "file").map(node => node.ref));
  const missing = files.filter(file => !known.has(file.id)).map(fileNode);
  if (missing.length) { const last = next.at(-1); next = last?.type === "text" && last.value === "" ? [...next.slice(0, -1), ...missing, last] : [...next, ...missing]; }
  if (textOf(next) !== text) next = [...next.filter(node => node.type !== "text"), { id: crypto.randomUUID(), type: "text", value: text }];
  return withTrailingText(next);
}
export type RemoteFileState = { kind: "busy" | "bad"; title?: string };
export const RemoteEditor = forwardRef<RemoteEditorHandle, {
  references?: readonly DraftReference[]; removeReference?(key: string): void; suggestions?: Pick<RichInputProps, "suggestions" | "onQueryChange" | "onSuggestionSelect" | "suggestionCopy">;
  onWorkspaceFileClick?: RichInputProps["onWorkspaceFileClick"];
  text: string; change(text: string): void; files: readonly DraftFile[]; remove(id: string): void; disabled?: boolean; placeholder: string;
  label: string; previewTitle: string; onFileClick(id: string): void; fileStates?: Readonly<Record<string, RemoteFileState>>;
}>(function RemoteEditor({ references = [], removeReference, suggestions, onWorkspaceFileClick, text, change, files, remove, disabled, placeholder, label, previewTitle, onFileClick, fileStates }, ref) {
  const chips = files.filter(file => !isImageFile(file));
  const [value, setValue] = useState<RichValue>(() => reconcile([], text, chips, references));
  const editor = useRef<RichInputHandle>(null);
  useImperativeHandle(ref, () => ({ focus: () => editor.current?.focus() }), []);
  const chipKey = chips.map(file => file.id).join("\u0000");
  useEffect(() => { setValue(current => { const next = reconcile(current, text, chips, references); return next === current || sameValue(next, current) ? current : next; }); }, [text, chipKey, references]); // eslint-disable-line react-hooks/exhaustive-deps
  const onChange = useCallback((next: RichValue) => { setValue(withTrailingText(next)); const typed = textOf(next); if (typed !== text) change(typed); }, [change, text]);
  return <div className="chat-remote-editor" aria-label={label} role="group">
    <RichInput ref={editor} value={value} onChange={onChange} placeholder={placeholder} disabled={disabled} queries={Boolean(suggestions)} {...suggestions} onWorkspaceFileClick={onWorkspaceFileClick} fileClickTitle={previewTitle} fileStates={fileStates}
      onNodeDiscarded={node => { if (node.type === "file") remove(node.ref); else if (referenceKey(node)) removeReference?.(referenceKey(node)!); }} onFileClick={node => onFileClick(node.ref)} className="chat-remote-text" />
  </div>;
});
function sameValue(a: RichValue, b: RichValue) {
  return a.length === b.length && a.every((node, index) => { const other = b[index]!; return node.type === other.type && node.id === other.id && (node.type !== "text" || node.value === (other as typeof node).value); });
}
