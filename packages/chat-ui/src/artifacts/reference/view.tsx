/**
 * [INPUT]: Strict frozen native-reference fences and the current owner Artifact host.
 * [OUTPUT]: Readable original instructions and keyboard-accessible exact-target navigation.
 * [POS]: Lazy sent-message reference card shared by desktop and Web; no model or source mutation.
 */
import { useMemo, useState } from "react";
import { CornerUpRight } from "lucide-react";
import { decodeDesignReferenceMessage } from "@ai-chat/cloud-protocol/artifacts/design/reference/message";
import { useArtifactHost } from "../context";
import { nativeChatCopy } from "../native/review/chat-copy";
import { openSentDesignReference, referenceFailureCopy } from "../native/review/reveal";
export function SentDesignReference({ code }: { code: string }) {
  const host = useArtifactHost(), [busy, setBusy] = useState(false), [failed, setFailed] = useState(false);
  const value = useMemo(() => { try { return decodeDesignReferenceMessage(code); } catch { return null; } }, [code]);
  if (!value) return <p role="status">{referenceFailureCopy(host?.locale ?? "en")}</p>;
  const native = value.reference.native!, copy = nativeChatCopy(host?.locale ?? "en");
  const open = async () => {
    if (!host || busy) return; setBusy(true); setFailed(false);
    try { await openSentDesignReference(host, value.reference); } catch { setFailed(true); } finally { setBusy(false); }
  };
  return <div data-sent-design-reference={native.kind === "native-comment" ? native.commentId : native.anchor} className="my-2 min-w-0 rounded-xl border border-border/70 bg-background/60 px-3 py-2 text-sm">
    <button type="button" disabled={busy || !host?.workspace} aria-label={copy.openTarget + ": " + value.name} onClick={() => void open()} className="inline-flex min-h-9 max-w-full items-center gap-2 rounded-md text-left font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"><CornerUpRight className="size-4 shrink-0" /><span className="truncate">{value.name}</span></button>
    <span className="ml-2 text-xs text-muted-foreground">v{value.reference.revision}</span>
    <p className="whitespace-pre-wrap break-words">{native.text}</p>
    {failed && <p role="alert" className="mt-2 text-xs text-destructive">{copy.referenceFailed}</p>}
  </div>;
}
