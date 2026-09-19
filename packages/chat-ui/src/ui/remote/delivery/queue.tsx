/**
 * [INPUT]: Complete awaiting identities, accepted head queue and immutable encrypted command receipts.
 * [OUTPUT]: One native queue surface with exact-revision withdrawal/reordering and explicit conflict feedback.
 * [POS]: The delivery surface's queue beside receipts.tsx; the shared panel owns gestures, coordinator/server ports own effects.
 */
import { useEffect, useRef, useState } from "react";
import type { CloudChatHead } from "@ai-chat/cloud-protocol/chats/model";
import { remoteReasonSchema } from "@ai-chat/cloud-protocol/remote/model";
import type { AwaitingQueue } from "@ai-chat/cloud-protocol/remote/queue";
import type { RemoteCommandSession, RemoteEntry } from "../../../platform/remote/commands/session";
import type { RemoteCommandPort, RemoteCommandInput } from "../../../platform/remote/contracts";
import { awaitRemoteResult } from "../../../platform/remote/commands/result";
import { awaitQueueAdmission } from "../../../platform/remote/queue/settle";
import { queueMove } from "../../composer/queue/model";
import { MessageQueuePanel } from "../../composer/queue/message-queue-panel";
import { useComposerTranslation } from "../../composer/controls/copy/translation";
import { remoteCopy } from "../../../i18n/remote";
import { reasonCopy } from "./receipts";
export function RemoteQueue({ head, port, session, entries, locale, disabled }: { head: CloudChatHead; port: RemoteCommandPort;
  session: RemoteCommandSession; entries: RemoteEntry[]; locale: string; disabled: boolean }) {
  const [snapshot, setSnapshot] = useState<{ port: RemoteCommandPort; chatId: string; value: AwaitingQueue } | null>(null);
  const waiting = snapshot?.port === port && snapshot.chatId === head.chat.id ? snapshot.value : null;
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const lifecycle = useRef(new AbortController());
  const mounted = useRef(true), flight = useRef(false), t = useComposerTranslation(locale), copy = remoteCopy(locale);
  useEffect(() => { mounted.current = true; lifecycle.current = new AbortController(); return () => { mounted.current = false; lifecycle.current.abort(); }; }, []);
  useEffect(() => {
    if (!port.queue) return;
    let active = true;
    const stop = port.queue.watch(head.chat.id, value => { if (active) setSnapshot({ port, chatId: head.chat.id, value }); }, () => { if (active) setError(copy.requestFailed); });
    return () => { active = false; stop(); };
  }, [port, head.chat.id, copy.requestFailed]);
  const published = waiting?.accepted ?? head.queue;
  const accepted = published?.deviceId === head.executorDeviceId && published.executionEpoch === head.executionEpoch ? published : null;
  const known = new Set(accepted?.items.map(item => item.intentId));
  const rows = [...(accepted?.items ?? []).map(item => ({ ...item, kind: "accepted" as const })),
    ...(waiting?.items ?? []).filter(item => !known.has(item.intentId)).map(item => ({ ...item, kind: "awaiting" as const }))];
  const rowKey = rows.map(item => item.intentId).join("/");
  useEffect(() => {
    for (const row of rows) if (row.sourceDeviceId) void session.load(row.intentId).catch(() => {});
  }, [session, rowKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const items = rows.map(row => {
    const payload = entries.find(entry => entry.input.commandId === row.intentId)?.input.payload;
    return { id: row.intentId, prompt: { displayText: payload && "text" in payload ? payload.text || copy.draft : copy.draft },
      state: busy || disabled ? "submitting" as const : "queued" as const, readOnlyEdit: true };
  });
  const control = async (payload: Extract<RemoteCommandInput["payload"], { kind: "withdraw-queued" | "reorder-queue" }>) => {
    if (!head.executorDeviceId) throw new Error("executor-changed");
    const result = await awaitRemoteResult(session, { commandId: crypto.randomUUID(), chatId: head.chat.id, incarnationId: head.chat.incarnationId,
      executionEpoch: head.executionEpoch, targetDeviceId: head.executorDeviceId, payload }, port.lifetime);
    if (result.state !== "done") throw new Error(result.reason ?? "queue-changed");
  };
  // A refused withdrawal or reorder names its reason — already dispatched, queue changed — instead of one opaque failure.
  const failure = (error: unknown) => {
    const reason = remoteReasonSchema.safeParse(error && typeof error === "object" && "data" in error ? error.data : error instanceof Error ? error.message : error);
    return reason.success ? reasonCopy(reason.data, copy) : copy.requestFailed;
  };
  const run = (effect: () => Promise<unknown>) => {
    if (flight.current || disabled) return;
    flight.current = true; setBusy(true); setError(null);
    void effect().catch(error => { if (mounted.current) setError(failure(error)); }).finally(() => {
      flight.current = false; if (mounted.current) setBusy(false);
    });
  };
  const remove = (id: string) => run(async () => {
    const row = rows.find(item => item.intentId === id); if (!row) return;
    if (row.kind === "accepted" && accepted) return control({ kind: "withdraw-queued", intentId: id, expectedRevision: accepted.revision });
    const receipt = await session.withdraw(id);
    if (receipt?.state !== "cancelled") throw new Error(receipt?.reason ?? "already-dispatched");
  });
  const move = (from: number, to: number) => run(async () => {
    const { kind, intentIds } = queueMove(rows, from, to);
    if (kind === "combined") {
      if (!waiting || !accepted || !head.executorDeviceId) throw new Error("queue-changed");
      const settled = await awaitQueueAdmission(port, head.chat.id, { ...waiting, accepted },
        { deviceId: head.executorDeviceId, executionEpoch: head.executionEpoch }, lifecycle.current.signal);
      return control({ kind: "reorder-queue", expectedRevision: settled.revision, intentIds });
    }
    if (kind === "accepted" && accepted) return control({ kind: "reorder-queue", expectedRevision: accepted.revision, intentIds });
    if (!waiting || !port.queue) throw new Error("queue-changed");
    return port.queue.reorder({ chatId: head.chat.id, incarnationId: head.chat.incarnationId, expectedRevision: waiting.revision, intentIds });
  });
  return <MessageQueuePanel t={t} items={items} paused={false} steerSupported={false} canSteer={() => false} queueError={error}
    onRemove={remove} onMove={move} onEdit={() => {}} onSteer={() => {}} onResume={() => {}} onDismissError={() => setError(null)}
    onResendAmbiguous={() => {}} onRemoveAmbiguous={remove} onReorderLock={() => {}} />;
}
