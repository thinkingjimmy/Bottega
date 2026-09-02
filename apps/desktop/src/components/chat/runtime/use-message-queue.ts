/**
 * [INPUT]: Depends on React effects, app i18n, composer external store, message-queue state modules, and assembly/admit/steer/outcome/ack ports
 * [OUTPUT]: Provides a per-chat queue controller with localized structured model errors, workspace-file Steer, durable/manual custody, outcome settlement, and edit swap
 * [POS]: The root of the renderer queue of chat/runtime; The state is stored, attached/admission/steer rules are narrowed down to modules
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from "react";
import type { PromptInputMessage } from "@ai-chat/ui/components/ai-elements/prompt-input";
import type {
  SteerAdmission,
  SteerDecision,
  SteerIpcReceipt,
  SteerOutboxProjection,
} from "../../../../shared/agent-ipc";
import type {
  AdmissionResult,
  ManualTurnSubmission,
} from "../../../../shared/sections-ipc";
import type {
  SubmissionAck,
  SubmissionOutcome,
} from "../../../../shared/submission";
import {
  flushPendingComposerAcks,
  globalQueuedBytes,
  readComposer,
  registerPendingComposerAck,
  replaceDraftFiles,
  retainComposerResources,
  updateComposer,
  useComposerState,
} from "@/lib/chat-composer-store";
import { readGalleryState } from "@/lib/gallery/store";
import {
  claimItem,
  claimNext,
  canSteerQueueItem,
  createQueueItem,
  editableItem,
  enqueue as enqueueItem,
  markAmbiguous,
  markManualCustody,
  moveItem,
  promote,
  queuedPrompt,
  registerOwner,
  releaseOwner,
  removeItem,
  resetIdentity,
  setQueueError,
  setQueuePaused,
  setReorderLock,
  settleItem,
  swapWithInput,
  tryFreeze,
  type MessageQueue,
  type QueueError,
  type QueueItem,
} from "@/lib/message-queue-model";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import {
  settleAdmission,
} from "./message-queue/admission";
import {
  draftPrompt,
  materializePrompt,
  promptFiles,
} from "./message-queue/attachment";
import { reconcileManualCustody } from "./message-queue/manual-custody";
import {
  failLocalSteerAssembly,
  markSteerTransportAmbiguous,
  reconcileSteerIntents,
  settleSteerReceipt,
} from "./message-queue/steer";

export type MessageQueuePorts = {
  assemble(
    message: PromptInputMessage
  ): Promise<ManualTurnSubmission>;
  admit(envelope: ManualTurnSubmission): Promise<AdmissionResult>;
  assembleSteer(
    message: PromptInputMessage,
    identity: {
      requestId: string;
      outboxRef: string;
      createdAt: number;
    }
  ): Promise<SteerAdmission>;
  steer(input: SteerAdmission): Promise<SteerIpcReceipt>;
  decideSteer(input: SteerDecision): Promise<SteerIpcReceipt>;
  ackManual(intentIds: string[]): Promise<void>;
  ackSteer(outboxRefs: string[]): Promise<void>;
  notice(message: string): void;
  outcome?(intentId: string): Promise<SubmissionOutcome>;
  ackOutcome?(ack: SubmissionAck): Promise<void>;
  subscribeOutcome?(
    listener: (outcome: SubmissionOutcome) => void
  ): () => void;
};

export function useMessageQueue({
  chatId,
  canDrain,
  isTurnRunning,
  steeringSupported,
  requestId,
  steerIntents,
  ports,
}: {
  chatId: string;
  canDrain: boolean;
  isTurnRunning: boolean;
  /* 后端 initialize 报没报 steering 能力位。不支持不是「点了以后降级」而是
     「这个动作根本不存在」——按钮不渲染，于是 fallback 分支无从被触达，也
     就不必存在。要把某条排到最前，队列本来就有重排。 */
  steeringSupported: boolean;
  requestId?: string;
  steerIntents: readonly SteerOutboxProjection[];
  ports: MessageQueuePorts;
}) {
  const { t } = useAppTranslation();
  const errorText = useCallback(
    (error: QueueError) =>
      typeof error === "string"
        ? error
        : t(error.copyKey, { ...(error.values ?? {}) }),
    [t]
  );
  const state = useComposerState(chatId);
  const ownerRef = useRef(`queue_${crypto.randomUUID()}`);
  const drainingRef = useRef(new Set<string>());
  const activeChatRef = useRef(chatId);
  activeChatRef.current = chatId;
  const noticeCurrent = useCallback(
    (message: string) => {
      if (activeChatRef.current === chatId) ports.notice(message);
    },
    [chatId, ports]
  );

  useEffect(() => {
    const owner = ownerRef.current;
    updateComposer(chatId, (current) => ({
      ...current,
      queue: registerOwner(current.queue, owner),
    }));
    return () => {
      if (activeChatRef.current === chatId) activeChatRef.current = "";
      updateComposer(chatId, (current) => ({
        ...current,
        queue: releaseOwner(current.queue, owner),
      }));
    };
  }, [chatId]);

  const failEditable = useCallback((id: string, message: string) => {
    updateComposer(chatId, (current) => ({
      ...current,
      queue: setQueueError(resetIdentity(current.queue, id), message),
    }));
  }, [chatId]);

  useEffect(() => {
    if (!canDrain || state.queue.paused || drainingRef.current.has(chatId)) return;
    const owner = ownerRef.current;
    let selectedId: string | undefined;
    updateComposer(chatId, (current) => {
      const claim = claimNext(current.queue, owner);
      selectedId = claim.item?.id;
      return claim.queue === current.queue
        ? current
        : { ...current, queue: claim.queue };
    });
    if (!selectedId) return;
    const id = selectedId;
    drainingRef.current.add(chatId);
    void (async () => {
      let frozen: ManualTurnSubmission;
      try {
        const item = readComposer(chatId).queue.items.find((entry) => entry.id === id);
        if (!item) return;
        frozen = await ports.assemble(await materializePrompt(item.prompt));
        if (item.content) frozen = { ...frozen, content: item.content };
      } catch (cause) {
        failEditable(id, cause instanceof Error ? cause.message : String(cause));
        return;
      }
      let accepted = false;
      updateComposer(chatId, (current) => {
        const result = tryFreeze(
          current.queue,
          id,
          owner,
          frozen,
          globalQueuedBytes()
        );
        accepted = result.accepted;
        return { ...current, queue: result.queue };
      });
      if (!accepted) return;
      const result = await ports.admit(frozen);
      updateComposer(chatId, (current) => {
        const queue = settleAdmission(current.queue, id, owner, result);
        if (result.kind === "accepted") {
          registerPendingComposerAck({
            kind: "manual",
            id: frozen!.intentId,
            chatId,
          });
        }
        return { ...current, queue };
      });
      void flushPendingComposerAcks({
        manual: ports.ackManual,
        steer: ports.ackSteer,
      });
      if (result.kind === "accepted" && ports.outcome && ports.ackOutcome) {
        void ports
          .outcome(frozen.intentId)
          .then((outcome) =>
            outcome.kind === "notFound"
              ? undefined
              : ports.ackOutcome!({
                  intentId: frozen.intentId,
                  outcomeRevision: outcome.revision,
                  kind: "admission",
                })
          )
          .catch(() => undefined);
      }
      retainComposerResources(chatId);
    })().finally(() => {
      drainingRef.current.delete(chatId);
      updateComposer(chatId, (current) => ({
        ...current,
        queue: { ...current.queue, revision: current.queue.revision + 1 },
      }));
      const activeChatId = activeChatRef.current;
      if (activeChatId !== chatId) {
        updateComposer(activeChatId, (current) => ({
          ...current,
          queue: { ...current.queue, revision: current.queue.revision + 1 },
        }));
      }
    });
  }, [
    canDrain,
    chatId,
    failEditable,
    ports,
    state.queue.items.length,
    state.queue.paused,
    state.queue.revision,
  ]);

  const reconcileManualOutcome = useCallback(
    (outcome: SubmissionOutcome) => {
      let ack: ReturnType<typeof reconcileManualCustody>["outcomeAck"];
      let steerAck: string | undefined;
      updateComposer(chatId, (current) => {
        const reconciled = reconcileManualCustody(current.queue, outcome);
        ack = reconciled.outcomeAck;
        steerAck = reconciled.steerAck;
        return reconciled.queue === current.queue
          ? current
          : { ...current, queue: reconciled.queue };
      });
      if (ack) void ports.ackOutcome?.(ack).catch(() => undefined);
      if (steerAck) {
        registerPendingComposerAck({
          kind: "steer",
          id: steerAck,
          chatId,
        });
        void flushPendingComposerAcks({
          manual: ports.ackManual,
          steer: ports.ackSteer,
        });
      }
    },
    [chatId, ports]
  );

  const outcomePortsRef = useRef(ports);
  outcomePortsRef.current = ports;
  const reconcileRef = useRef(reconcileManualOutcome);
  reconcileRef.current = reconcileManualOutcome;
  const ambiguousIntentIds = state.queue.items
    .filter((item) => item.state === "ambiguous" && item.custodyIntentId)
    .map((item) => item.custodyIntentId!)
    .sort()
    .join(",");
  useEffect(() => {
    // ports/reconcile 经 ref 取最新引用：订阅只随 ambiguous 集合变化
    // 重建，流式 render 不再每帧退订/重订 + 全量轮询。
    const unsubscribe = outcomePortsRef.current.subscribeOutcome?.(
      (outcome) => reconcileRef.current(outcome)
    );
    for (const intentId of ambiguousIntentIds.split(",").filter(Boolean)) {
      void outcomePortsRef.current
        .outcome?.(intentId)
        .then((outcome) => reconcileRef.current(outcome))
        .catch(() => undefined);
    }
    return unsubscribe;
  }, [ambiguousIntentIds]);

  useEffect(() => {
    if (!steerIntents.length) {
      updateComposer(chatId, (current) =>
        current.handledSteerIntents.size
          ? { ...current, handledSteerIntents: new Set() }
          : current
      );
      void flushPendingComposerAcks({
        manual: ports.ackManual,
        steer: ports.ackSteer,
      });
      return;
    }
    updateComposer(chatId, (current) => {
      const projected = new Set(
        steerIntents.map((intent) => intent.outboxRef)
      );
      const handled = new Set(
        [...current.handledSteerIntents].filter((outboxRef) =>
          projected.has(outboxRef)
        )
      );
      const pending = steerIntents.filter(
        (intent) => !handled.has(intent.outboxRef)
      );
      const reconciled = reconcileSteerIntents(
        current.queue,
        pending,
        globalQueuedBytes(),
        {
          notice: noticeCurrent,
        }
      );
      for (const outboxRef of reconciled.acknowledgements) {
        registerPendingComposerAck({
          kind: "steer",
          id: outboxRef,
          chatId,
        });
        handled.add(outboxRef);
      }
      const handledChanged =
        handled.size !== current.handledSteerIntents.size ||
        [...handled].some(
          (outboxRef) => !current.handledSteerIntents.has(outboxRef)
        );
      return reconciled.queue === current.queue && !handledChanged
        ? current
        : {
            ...current,
            queue: reconciled.queue,
            handledSteerIntents: handled,
          };
    });
    void flushPendingComposerAcks({
      manual: ports.ackManual,
      steer: ports.ackSteer,
    });
    retainComposerResources(chatId);
  }, [chatId, noticeCurrent, ports, steerIntents]);

  const enqueue = useCallback((message: PromptInputMessage) => {
    let reason: QueueError | undefined;
    updateComposer(chatId, (current) => {
      const result = enqueueItem(
        current.queue,
        createQueueItem(queuedPrompt(message)),
        globalQueuedBytes()
      );
      reason = result.reason;
      return result.queue === current.queue
        ? {
            ...current,
            queue: setQueueError(
              current.queue,
              reason ?? { copyKey: "chat.queue.enqueueFailed" }
            ),
          }
        : { ...current, queue: result.queue };
    });
    if (reason) throw new Error(errorText(reason));
  }, [chatId, errorText]);

  const edit = useCallback((id: string) => {
    const current = readComposer(chatId);
    const input = current.draft.richValue.length || current.draft.files.length
      ? draftPrompt(current.draft.richValue, current.draft.files)
      : undefined;
    const swapped = swapWithInput(current.queue, id, input);
    if (!swapped.prompt) return false;
    // 画廊附件的 selection 可能已被此前提交消费：恢复陈旧附件会得到永远过不了
    // token CAS 的死草稿，这里只还原仍持有效 selection 的画廊文件
    const liveSelections = readGalleryState(chatId).selections;
    const restorable = {
      ...swapped.prompt,
      attachments: swapped.prompt.attachments.filter((attachment) => {
        if (attachment.origin?.kind !== "gallery") return true;
        const selection = liveSelections.get(attachment.origin.logicalKey);
        return (
          selection?.selectionToken === attachment.origin.selectionToken &&
          selection.attachmentId === attachment.id
        );
      }),
    };
    replaceDraftFiles(chatId, promptFiles(restorable));
    updateComposer(chatId, (latest) => ({
      ...latest,
      queue: swapped.queue,
      draft: { ...latest.draft, richValue: swapped.prompt!.richValue },
    }));
    retainComposerResources(chatId);
    return true;
  }, [chatId]);

  const steer = useCallback((id: string) => {
    const candidate = readComposer(chatId).queue.items.find(
      (item) => item.id === id
    );
    if (!candidate || !canSteerQueueItem(candidate, isTurnRunning)) return;
    if (!requestId) {
      noticeCurrent(t("chat.runtime.queue.turnEnded"));
      return;
    }
    const owner = ownerRef.current;
    const outboxRef = `steer_${crypto.randomUUID().replaceAll("-", "")}`;
    let item: ReturnType<typeof readComposer>["queue"]["items"][number] | undefined;
    updateComposer(chatId, (current) => {
      const claim = claimItem(current.queue, id, owner, outboxRef);
      item = claim.item;
      return claim.queue === current.queue
        ? current
        : { ...current, queue: claim.queue };
    });
    if (!item) return;
    const claimedItem = item;
    void (async () => {
      let admission: SteerAdmission;
      try {
        const materialized = await materializePrompt(claimedItem.prompt);
        if (activeChatRef.current !== chatId) {
          throw new Error(t("chat.runtime.queue.viewChangedSteerCancelled"));
        }
        admission = await ports.assembleSteer(materialized, {
          requestId,
          outboxRef,
          createdAt: claimedItem.createdAt,
        });
        if (activeChatRef.current !== chatId) {
          throw new Error(t("chat.runtime.queue.viewChangedSteerCancelled"));
        }
      } catch (cause) {
        updateComposer(chatId, (current) => ({
          ...current,
          queue: failLocalSteerAssembly(current.queue, id, owner, cause),
        }));
        return;
      }
      const currentClaim = readComposer(chatId).queue.items.find(
        (candidate) => candidate.id === id
      );
      if (
        currentClaim?.state !== "steering" ||
        currentClaim.owner !== owner ||
        currentClaim.outboxRef !== outboxRef ||
        currentClaim.workspaceInvalidated
      ) {
        let discarded = false;
        updateComposer(chatId, (current) => {
          const candidate = current.queue.items.find((item) => item.id === id);
          if (
            !candidate?.workspaceInvalidated ||
            candidate.outboxRef !== outboxRef
          ) return current;
          discarded = true;
          return { ...current, queue: settleItem(current.queue, id) };
        });
        if (discarded) retainComposerResources(chatId);
        return;
      }
      let result: SteerIpcReceipt;
      try {
        result = await ports.steer(admission);
      } catch (cause) {
        updateComposer(chatId, (current) => ({
          ...current,
          queue: markSteerTransportAmbiguous(
            current.queue,
            id,
            outboxRef,
            cause
          ),
        }));
        return;
      }
      updateComposer(chatId, (current) => {
        const settled = settleSteerReceipt(
          current.queue,
          id,
          owner,
          outboxRef,
          result
        );
        if (settled.ack) {
          registerPendingComposerAck({
            kind: "steer",
            id: outboxRef,
            chatId,
          });
        }
        if (settled.notice) noticeCurrent(settled.notice);
        return { ...current, queue: settled.queue };
      });
      void flushPendingComposerAcks({
        manual: ports.ackManual,
        steer: ports.ackSteer,
      });
      retainComposerResources(chatId);
    })();
  }, [
    chatId,
    isTurnRunning,
    noticeCurrent,
    ports,
    requestId,
    t,
  ]);

  const decideAmbiguous = useCallback(
    (id: string, action: SteerDecision["action"]) => {
      const item = readComposer(chatId).queue.items.find(
        (candidate) => candidate.id === id
      );
      if (item?.state !== "ambiguous") return;
      if (
        item.workspaceInvalidated &&
        action === "resend" &&
        (item.custodyIntentId || !item.outboxRef)
      ) {
        const message = t("chat.runtime.queue.workspaceChangedNoResend");
        updateComposer(chatId, (current) => ({
          ...current,
          queue: setQueueError(current.queue, message),
        }));
        noticeCurrent(message);
        return;
      }
      if (item.custodyIntentId || !item.outboxRef) {
        const custodyIntentId = item.custodyIntentId;
        if (!custodyIntentId || !ports.outcome) {
          noticeCurrent(t("chat.runtime.queue.durableOutcomeUnavailable"));
          return;
        }
        void ports
          .outcome(custodyIntentId)
          .then((outcome) => {
            const failed =
              (outcome.kind === "live" && outcome.phase === "failed") ||
              (outcome.kind === "tombstone" &&
                outcome.outcome === "failed");
            const persisted =
              (outcome.kind === "live" &&
                outcome.custody === "chat-persisted") ||
              (outcome.kind === "tombstone" &&
                outcome.outcome === "persisted");
            if (action === "dismiss") {
              if (!failed) {
                reconcileManualOutcome(outcome);
                if (!persisted) {
                  noticeCurrent(t("chat.runtime.queue.mainCustodyPending"));
                }
                return;
              }
              updateComposer(chatId, (current) => ({
                ...current,
                queue: settleItem(current.queue, id),
              }));
              void ports.ackOutcome?.({
                intentId: outcome.intentId,
                outcomeRevision: outcome.revision,
                kind: "admission",
              });
              if (item.outboxRef) {
                registerPendingComposerAck({
                  kind: "steer",
                  id: item.outboxRef,
                  chatId,
                });
                void flushPendingComposerAcks({
                  manual: ports.ackManual,
                  steer: ports.ackSteer,
                });
              }
              retainComposerResources(chatId);
              return;
            }
            const recoverable =
              outcome.kind === "live" &&
              outcome.phase === "failed" &&
              outcome.retry === "recoverable";
            // reservation fence 的安全负证明：absent = intent 从未抵达
            // main，可安全以原内容重新入队；inFlight/unknown 继续拒绝。
            const provenNeverArrived =
              outcome.kind === "notFound" &&
              outcome.reservation === "absent";
            if (recoverable || provenNeverArrived) {
              updateComposer(chatId, (current) => ({
                ...current,
                queue: setQueueError(resetIdentity(current.queue, id), null),
              }));
              if (recoverable) {
                void ports.ackOutcome?.({
                  intentId: outcome.intentId,
                  outcomeRevision: outcome.revision,
                  kind: "recovery-installed",
                });
                if (item.outboxRef) {
                  registerPendingComposerAck({
                    kind: "steer",
                    id: item.outboxRef,
                    chatId,
                  });
                  void flushPendingComposerAcks({
                    manual: ports.ackManual,
                    steer: ports.ackSteer,
                  });
                }
              }
              return;
            }
            reconcileManualOutcome(outcome);
            noticeCurrent(
              outcome.kind === "notFound"
                ? t("chat.runtime.queue.noSafeNegativeProof")
                : t("chat.runtime.queue.ordinaryResendUnavailable")
            );
          })
          .catch((cause) =>
            noticeCurrent(
              cause instanceof Error ? cause.message : String(cause)
            )
          );
        return;
      }
      void ports
        .decideSteer({ outboxRef: item.outboxRef, action })
        .then((result) => {
          updateComposer(chatId, (current) => {
            const settled =
              result.outcome === "dismissed" ||
              result.outcome === "injected";
            const queue =
              result.outcome === "unconsumed"
                ? markManualCustody(
                    current.queue,
                    id,
                    result.derivedIntentId
                  )
                : settled
                  ? settleItem(current.queue, id)
                  : setQueueError(
                      markAmbiguous(current.queue, id, item.outboxRef),
                      result.reason
                    );
            const terminal =
              result.outcome === "dismissed" ||
              (result.outcome === "injected" &&
                result.persistState === "persisted");
            if (terminal) {
              registerPendingComposerAck({
                kind: "steer",
                id: item.outboxRef!,
                chatId,
              });
            }
            return { ...current, queue };
          });
          void flushPendingComposerAcks({
            manual: ports.ackManual,
            steer: ports.ackSteer,
          });
          retainComposerResources(chatId);
        })
        .catch((cause) => {
          updateComposer(chatId, (current) => ({
            ...current,
            queue: setQueueError(
              markAmbiguous(current.queue, id, item.outboxRef),
              cause instanceof Error ? cause.message : String(cause)
            ),
          }));
        });
    },
    [chatId, noticeCurrent, ports, reconcileManualOutcome, t]
  );

  const mutate = useCallback(
    (updater: (queue: MessageQueue) => MessageQueue) =>
      updateComposer(chatId, (current) => ({
        ...current,
        queue: updater(current.queue),
      })),
    [chatId]
  );

  return useMemo(() => ({
    items: state.queue.items,
    paused: state.queue.paused,
    error: state.queue.error ? errorText(state.queue.error) : null,
    enqueue,
    remove: (id: string) => {
      mutate((queue) => removeItem(queue, id));
      retainComposerResources(chatId);
    },
    move: (from: number, to: number) => mutate((queue) => moveItem(queue, from, to)),
    promote: (id: string) => mutate((queue) => promote(queue, id)),
    steer,
    edit,
    pause: () => mutate((queue) => setQueuePaused(queue, true)),
    resume: () => mutate((queue) => setQueuePaused(setQueueError(queue, null), false)),
    dismissError: () => mutate((queue) => setQueueError(queue, null)),
    setReorderLock: (locked: boolean) => mutate((queue) => setReorderLock(queue, locked)),
    /* 两问正交：能力决定这个动作**在不在**，时机决定它**能不能点**。
       混成一个布尔就只能二选一——要么不支持的后端露出一个永远点不动的
       按钮，要么支持的后端在 turn 间隙把按钮整个抽走。 */
    steerSupported: steeringSupported,
    canSteer: (item: QueueItem) =>
      canSteerQueueItem(item, isTurnRunning),
    resendAmbiguous: (id: string) => decideAmbiguous(id, "resend"),
    removeAmbiguous: (id: string) => decideAmbiguous(id, "dismiss"),
    editable: editableItem,
  }), [
    chatId,
    decideAmbiguous,
    edit,
    enqueue,
    errorText,
    isTurnRunning,
    mutate,
    steeringSupported,
    state.queue.error,
    state.queue.items,
    state.queue.paused,
    steer,
  ]);
}
