/**
 * [INPUT]: Exact retained native input, owner checkpoint conflicts, shared localized native/Chat status copy and an explicit CAS recovery callback.
 * [OUTPUT]: NativeInputRecovery shows both drafts and serializes a choice against the displayed owner version only after source loading finishes, including readable pending comment-save and original-Chat handoff summaries.
 * [POS]: Trusted review conflict UI; it never sends a model request or changes document source.
 */
import { useRef, useState } from "react";
import { nativeCopy } from "./copy";
import { nativeChatCopy } from "./review/chat-copy";
import type { NativeInput } from "@ai-chat/cloud-protocol/artifacts/design/native/comments";
import type { WorkspaceRead } from "@ai-chat/cloud-protocol/artifacts/design/model";
const texts = {
  en: ["Input changed in another view. Both drafts are kept.", "Saved input", "This input", "Use saved input", "Keep this input", "Retained input", "Use this input"],
  zh: ["另一视图已修改输入。两份草稿均已保留。", "已保存的输入", "本次输入", "使用已保存的输入", "保留本次输入", "保留的输入", "使用此输入"],
  ja: ["別の画面で入力が変更されました。両方の下書きを保持しました。", "保存済みの入力", "この入力", "保存済みの入力を使用", "この入力を保持", "保持された入力", "この入力を使用"],
  fr: ["La saisie a changé dans une autre vue. Les deux brouillons sont conservés.", "Saisie enregistrée", "Cette saisie", "Utiliser la saisie enregistrée", "Conserver cette saisie", "Saisie conservée", "Utiliser cette saisie"],
  es: ["La entrada cambió en otra vista. Se conservan ambos borradores.", "Entrada guardada", "Esta entrada", "Usar entrada guardada", "Conservar esta entrada", "Entrada conservada", "Usar esta entrada"],
};
export function NativeInputRecovery({ locale, input, conflict, recover, blocked = false }: { locale?: string; input: NativeInput; conflict: WorkspaceRead; recover(value: NativeInput): Promise<void>; blocked?: boolean }) {
  const [pending, setPending] = useState(false), running = useRef(false);
  const choose = (value: NativeInput) => {
    if (blocked || running.current) return;
    running.current = true; setPending(true);
    void recover(value).catch(() => {}).finally(() => { running.current = false; setPending(false); });
  };
  const copy = texts[locale?.split("-")[0] as keyof typeof texts] ?? texts.en;
  const retained = conflict.checkpointConflicts?.flatMap(value => value.native ? [value.native] : []) ?? [];
  const saved = conflict.checkpoint?.native ?? { instruction: "" }, summary = (value: NativeInput) => [value.instruction, value.compose?.text, value.reply?.text, value.pending || value.commentSave ? nativeCopy(locale ?? "en").pending : undefined, value.handoff ? nativeChatCopy(locale ?? "en").pending : undefined].filter(Boolean).join("\n\n");
  const button = "min-h-[44px] rounded-md border px-3 text-sm hover:bg-muted disabled:opacity-50";
  return <section data-native-input-recovery="" data-native-input-revision={conflict.revision} className="pointer-events-auto absolute left-3 bottom-20 z-50 max-h-[70%] w-[min(420px,calc(100%_-_24px))] space-y-3 overflow-auto rounded-md border bg-background p-3 text-sm shadow-lg">
    <p role="alert">{copy[0]}</p>
    <div><p className="font-medium">{copy[1]}</p><pre className="max-h-28 overflow-auto whitespace-pre-wrap break-words">{summary(saved)}</pre><button type="button" className={button} disabled={blocked || pending} onClick={() => choose(saved)}>{copy[3]}</button></div>
    <div><p className="font-medium">{copy[2]}</p><pre className="max-h-28 overflow-auto whitespace-pre-wrap break-words">{summary(input)}</pre><button type="button" className={button} disabled={blocked || pending} onClick={() => choose(input)}>{copy[4]}</button></div>
    {retained.map((value, index) => <div key={index}><p className="font-medium">{copy[5]} {index + 1}</p><pre className="max-h-28 overflow-auto whitespace-pre-wrap break-words">{summary(value)}</pre><button type="button" className={button} disabled={blocked || pending} onClick={() => choose(value)}>{copy[6]}</button></div>)}
  </section>;
}
