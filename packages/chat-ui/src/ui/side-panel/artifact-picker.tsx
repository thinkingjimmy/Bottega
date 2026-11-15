/**
 * [INPUT]: Scoped transcript pages, localized panel copy and the active Artifact host.
 * [OUTPUT]: Saved transcript Artifact extraction and a cancellable picker with one entry per tab identity and existing preview actions.
 * [POS]: Shared third-column entry for native and cloud Chats.
 */
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { FileIcon, LoaderCircleIcon } from "lucide-react";
import { Button } from "@ai-chat/ui/components/ui/button";
import { Dialog } from "@ai-chat/ui/components/ui/dialog";
import { AppDialogContent, AppDialogHeader } from "@ai-chat/ui/components/ui/app-dialog";
import { ARTIFACT_FENCE, readArtifactFences, type ArtifactFence } from "@ai-chat/cloud-protocol/turns/text/artifact-reference";
import { useArtifactHost } from "../../artifacts/context";
import { artifactCopy } from "../../artifacts/copy";
import { artifactTabId } from "../../artifacts/presentation/tabs";
import type { SidePanelCopy } from "../../i18n/side-panel";

type ArtifactPart = { type: "text"; text: string } | { type: "subagent"; agentThreadId: string } | { type: "tool" };
type ArtifactMessage = { role: string; content: string; parts?: readonly ArtifactPart[]; segment?: "imported" };
export type ReadArtifactPages = (signal: AbortSignal) => AsyncIterable<readonly ArtifactFence[]>;

export function savedMessageArtifacts(message: ArtifactMessage, subagents?: Record<string, { parts: readonly ArtifactPart[] }>) {
  if (message.role !== "assistant" || message.segment === "imported") return [];
  const fences: ArtifactFence[] = [];
  const seen = new Set<string>();
  const read = (text: string) => {
    if (text.includes(ARTIFACT_FENCE)) fences.push(...readArtifactFences(text).reverse());
  };
  const visit = (parts: readonly ArtifactPart[]) => {
    for (const part of [...parts].reverse()) {
      if (part.type === "text") read(part.text);
      if (part.type === "subagent" && !seen.has(part.agentThreadId)) {
        seen.add(part.agentThreadId);
        visit(subagents?.[part.agentThreadId]?.parts ?? []);
      }
    }
  };
  read(message.content);
  visit(message.parts ?? []);
  return fences;
}

export function ArtifactPicker({ copy, trigger, read, close }: {
  copy: SidePanelCopy; trigger: HTMLButtonElement; read: ReadArtifactPages; close(): void;
}) {
  const host = useArtifactHost();
  const [items, setItems] = useState<ArtifactFence[]>([]);
  const [reading, setReading] = useState(true);
  const [readFailed, setReadFailed] = useState(false);
  const [opening, setOpening] = useState(false);
  const [openFailed, setOpenFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const lifetime = useRef<AbortController>(null);
  const readCurrent = useEffectEvent((signal: AbortSignal) => read(signal));

  useEffect(() => {
    const controller = new AbortController(), { signal } = controller;
    lifetime.current = controller;
    const found = new Map<string, ArtifactFence>();
    void (async () => {
      try {
        for await (const page of readCurrent(signal)) {
          if (signal.aborted) return;
          const count = found.size;
          for (const fence of page) {
            const id = artifactTabId(fence);
            if (!found.has(id)) found.set(id, fence);
          }
          if (count !== found.size) setItems([...found.values()]);
        }
      } catch {
        if (!signal.aborted) setReadFailed(true);
      } finally {
        if (!signal.aborted) setReading(false);
      }
    })();
    return () => controller.abort();
  }, [attempt]);

  const open = async (fence: ArtifactFence) => {
    if (!host || opening) return;
    const signal = lifetime.current?.signal;
    setOpenFailed(false);
    setOpening(true);
    try {
      await host.open(fence, host.followUp);
      if (!signal?.aborted) close();
    } catch {
      if (!signal?.aborted) {
        setOpenFailed(true);
        setOpening(false);
      }
    }
  };

  return (
    <Dialog open onOpenChange={isOpen => { if (!isOpen) close(); }}>
      <AppDialogContent
        size="lg"
        showCloseButton
        aria-describedby={undefined}
        className="gap-3"
        onCloseAutoFocus={event => {
          event.preventDefault();
          if (trigger.isConnected && document.activeElement === document.body) trigger.focus();
        }}
      >
        <AppDialogHeader title={copy.catalog.artifact.label}/>
        <div className="max-h-96 overflow-y-auto">
          {items.length > 0 && (
            <ul className="space-y-0.5">
              {items.map(fence => (
                <li key={artifactTabId(fence)}>
                  <Button variant="ghost" className="min-h-11 w-full justify-start gap-3 px-2.5 text-xs hover:bg-accent"
                    type="button" disabled={opening || !host} title={fence.title} onClick={() => void open(fence)}>
                    <FileIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="truncate">{fence.title}</span>
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {reading && <div role="status" aria-label={copy.artifactPicker.loading} className="grid min-h-12 place-items-center">
            <LoaderCircleIcon aria-hidden className="size-4 animate-spin text-muted-foreground" />
          </div>}
          {!reading && !readFailed && items.length === 0 && <p className="px-2.5 py-3 text-muted-foreground" role="status">{copy.artifactPicker.empty}</p>}
          {readFailed && <div className="flex items-center justify-between gap-2 px-2.5 py-2">
            <p role="alert">{copy.artifactPicker.failed}</p>
            <Button variant="ghost" size="sm" onClick={() => {
              setItems([]); setReading(true); setReadFailed(false); setAttempt(value => value + 1);
            }}>{copy.retry}</Button>
          </div>}
          {openFailed && <p role="alert" className="px-2.5 py-2">{artifactCopy(host?.locale ?? "en").failed}</p>}
        </div>
      </AppDialogContent>
    </Dialog>
  );
}
