/**
 * [INPUT]: Depends on confirmed cloud heads, fixed remote ports, existing composer drafts and native route navigation.
 * [OUTPUT]: Provides account and kill-switch selector visibility, the named computer chip (reason in its tooltip, the in-flight destination while switching, failure in its callout), local-first selection, composer guards, idempotent executor switching for existing Chats.
 * [POS]: Native composer sibling; local sending remains owned by the existing strict submission and coordinator adapters.
 */
import { useEffect, useRef, useState } from "react";
import { DeviceSelector, targetReason, type ComputerCallout } from "@ai-chat/chat-ui/remote-selectors";
import { computerFace } from "@ai-chat/chat-ui/remote-status";
import { useRemoteTargets } from "@ai-chat/chat-ui/remote-hooks";
import { remoteCopy } from "@ai-chat/chat-ui/remote-copy";
import type { RemoteCreateInput, RemoteSelectInput } from "@ai-chat/chat-ui/remote-contracts";
import { useCloudChatHead } from "@/lib/cloud/chat/catalog";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import "@ai-chat/chat-ui/remote-styles.css";
export function DesktopDeviceSelector({ chatId, persisted, projectId, backend, onPendingChange }: {
  chatId: string; persisted: boolean; projectId: string | null; backend: RemoteCreateInput["backend"];
  onPendingChange?(pending: boolean): void;
}) {
  const cloud = useCloudChatHead(persisted ? chatId : undefined), sources = cloud.sources, port = sources?.executor.remote;
  const targets = useRemoteTargets(port, persisted ? chatId : null, persisted ? undefined : projectId), { i18n } = useAppTranslation(), copy = remoteCopy(i18n.language);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState<RemoteSelectInput | null>(null), flight = useRef(false), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { onPendingChange?.(busy || Boolean(attempt)); }, [busy, attempt, onPendingChange]);
  useEffect(() => () => onPendingChange?.(false), [onPendingChange]);
  const localId = targets.value?.localDeviceId ?? null, head = cloud.head, current = head?.pendingExecutor?.deviceId ?? head?.executorDeviceId ?? localId;
  const selected = targets.items.find(item => item.deviceId === current && item.online && item.protocolVersion === targets.value?.sourceProtocolVersion)?.deviceId ?? "";
  const available = Boolean(targets.value?.remoteControlEnabled && port && sources && localId);
  if (!persisted || !available || targets.items.length < 2 && current === localId) return null;
  const select = async (deviceId: string) => {
    if (flight.current || deviceId === current || !port || !sources) return;
    const chosen = targets.items.find(item => item.deviceId === deviceId);
    if (!chosen || targetReason(chosen, targets.value!.sourceProtocolVersion, copy, deviceId === localId)) return;
    if (!head) { setError(copy.disconnected); return; }
    flight.current = true; setBusy(true); setError(null);
    try {
      const input = attempt?.targetDeviceId === deviceId ? attempt : {
        chatId, incarnationId: head.chat.incarnationId, expectedEpoch: head.executionEpoch, targetDeviceId: deviceId, operationId: crypto.randomUUID(),
      };
      setAttempt(input);
      if (chosen.projectBound === false && deviceId === localId) { const bound = await sources.bindProject(chatId); if (!bound) { setAttempt(null); return; } }
      await port.select(input);
      if (mounted.current) setAttempt(null);
    } catch { if (mounted.current) setError(copy.switchFailed); }
    finally { flight.current = false; if (mounted.current) setBusy(false); }
  };
  const protocol = targets.value?.sourceProtocolVersion ?? -1;
  /* An in-flight selection names its destination while the head catches up. */
  const shown = busy && attempt ? attempt.targetDeviceId : current;
  const target = targets.items.find(item => item.deviceId === shown);
  /* The native composer already runs locally: an unavailable remote leaves the chip dim with the reason in its tooltip. */
  const face = computerFace(copy, { blocked: available && !targets.error ? null : targets.value && !targets.value.remoteControlEnabled ? copy.disabled : copy.disconnected,
    loading: targets.value === null && available, target, selected: Boolean(selected), protocol, revoked: false,
    attention: Boolean(error), localDeviceId: localId });
  const callout: ComputerCallout | null = error ? { message: error, dismiss: () => setError(null),
    ...(attempt ? { action: { label: copy.retryShort, run: () => void select(attempt.targetDeviceId) } } : {}) } : null;
  return <div className="flex min-w-0 items-center gap-1"><DeviceSelector items={targets.items} currentDeviceId={current} selectedDeviceId={selected} localDeviceId={localId}
    protocol={protocol} copy={copy} sameAgent={!head || backend === head.chat.agent} allowLocalBinding disabled={!available || busy || Boolean(attempt) || targets.error || persisted && !head} onSelect={id => void select(id)}
    face={face} callout={callout} />
  </div>;
}
