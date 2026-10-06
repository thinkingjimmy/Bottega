/**
 * [INPUT]: Electron lifecycle/clipboard, live service admission owners, startup and maintenance flights, task facts, and the root's terminal close operation.
 * [OUTPUT]: Composes safeQuit, stopChatAdmission and the irreversible shutdown gate; background-only cleanup is logged during exit, while task/draft failures retain protection and cancellation recovery uses an inline warning.
 * [POS]: Startup shutdown orchestration; index.ts owns services and terminal feature cleanup, while terminal-owner-sequence.ts owns durable close order.
 */
import { app, clipboard, dialog } from "electron";
import { inspect } from "node:util";
import type { AppLocale } from "@ai-chat/ui/lib/locale";
import type { ConversationCoordinator } from "../../sections/coordinator/conversation-coordinator";
import type { BuiltinMcpBridge } from "../../tools/bridge";
import type { FoundationRuntime } from "../foundation/runtime";
import type { BasesService } from "../../bases/bases-service";
import type { ChatsService } from "../../chats/service/chats-service";
import type { ProjectsService } from "../../projects/projects-service";
import type { MemoryService } from "../../memory/service/memory-service";
import { recoverAfterFailedShutdown, shutdownAllAgents } from "../../agent/bridge/agent-bridge";
import { reopenTitleGenerators, stopTitleGeneratorAdmission } from "../../chats/projection/title-generator";
import { surfaceWindowController } from "../../window/surfaces/surface-window-controller";
import { taskStartFence, type StopOperation } from "../../presence/lifecycle/start-fence";
import { stopChatStoreMaintenance } from "../maintenance/chat-store-maintenance";
import { quitActivity } from "../dialogs/activity";
import { installApplicationQuit } from "./application-quit";
import { settleStartup, type SafeQuitResult } from "./safe-quit";
import { reopenStoppedChatDependencies, ShutdownRecoveryGate } from "./shutdown-recovery";

type QuitOwners = {
  coordinator: Pick<ConversationCoordinator, "stopAdmission" | "reopenAdmission" | "drainDispatches"> | null;
  bridge: Pick<BuiltinMcpBridge, "stopAdmission" | "reopenAdmission"> | null;
  foundation: Pick<FoundationRuntime, "stopAdmission" | "hosts"> | null;
  bases: Pick<BasesService, "stopAdmission" | "reopenAdmission"> | null;
  chats: Pick<ChatsService, "stopAdmission" | "reopenAdmission" | "publishWarning"> | null;
  projects: Pick<ProjectsService, "stopAdmission" | "reopen"> | null;
  memory: Pick<MemoryService, "stopAdmission" | "reopen"> | null;
  maintenance: { drain(): Promise<unknown> } | null;
};

export function composeApplicationQuit(ports: {
  owners(): QuitOwners;
  locale(): AppLocale;
  stopOperations(): readonly StopOperation[];
  startupFlight(): Promise<unknown> | null;
  requestUserQuit(): Promise<SafeQuitResult>;
  closeOwners(): Promise<void>;
}) {
  const shutdownRecovery = new ShutdownRecoveryGate();
  function stopChatAdmission() {
    const { coordinator, bridge, foundation, bases, chats, projects, memory } = ports.owners();
    // Fence admission before flushing so no dispatch can outlive its durable owners.
    stopChatStoreMaintenance();
    coordinator?.stopAdmission();
    bridge?.stopAdmission();
    foundation?.stopAdmission();
    bases?.stopAdmission();
    chats?.stopAdmission();
    projects?.stopAdmission();
    stopTitleGeneratorAdmission();
    memory?.stopAdmission();
    surfaceWindowController.stopAdmission();
  }
  async function reopenChatDependencies() {
    const { memory, projects, chats, bases, bridge } = ports.owners();
    await reopenStoppedChatDependencies(
      [memory],
      reopenTitleGenerators,
      projects,
      [chats, bases, bridge]
    );
  }
  const safeQuit = installApplicationQuit(app, dialog, {
    presentFailure: (failure, canForce) => { const locale = ports.locale(), activity = quitActivity(ports.stopOperations(), ports.owners().foundation?.hosts.custody.entries() ?? []);
      return import("../dialogs/quit").then(({ showQuitFailure }) => showQuitFailure(locale, failure, activity, canForce)); },
    activity: () => quitActivity(ports.stopOperations(), ports.owners().foundation?.hosts.custody.entries() ?? []), copyTechnicalDetails: text => clipboard.writeText(text),
    requestUserQuit: ports.requestUserQuit,
    recoveryWarning: message => { ports.owners().chats?.publishWarning(message); },
    acquireStartHold: () => taskStartFence.acquire(),
    snapshotStopOperations: ports.stopOperations,
    stopAdmission: stopChatAdmission,
    settleWindows: () => surfaceWindowController.settleAll(),
    awaitStartup: () => settleStartup(ports.startupFlight(), 10_000),
    quiesceAgents: async () => {
      const { coordinator, maintenance } = ports.owners();
      await Promise.all([
        shutdownAllAgents({ onBackgroundCleanupFailure: cause => console.warn("[shutdown] background cleanup incomplete; continuing owned shutdown", inspect(cause, { depth: null })) }),
        coordinator?.drainDispatches(), maintenance?.drain(),
      ]);
    },
    closeOwners: ports.closeOwners,
    recover: async (reason) => {
      try { return await shutdownRecovery.recover(
        reopenChatDependencies,
        recoverAfterFailedShutdown,
        () => {
          ports.owners().coordinator?.reopenAdmission();
          surfaceWindowController.reopenAdmission();
        },
        (cause) => console.error(`[shutdown:${reason}] recovery failed`, inspect(cause, { depth: null }))
      ); } finally { surfaceWindowController.resumeDrafts(); }
    },
    /* Shutdown failures nest AggregateErrors three deep; the default depth prints the root cause as "[Array]". */
    report: (reason, phase, cause) =>
      console.error(`[shutdown:${reason}] ${phase} phase failed`, inspect(cause, { depth: null })),
  }, ports.locale);
  return { safeQuit, stopChatAdmission,
    runIrreversible: <T>(task: () => T | Promise<T>) => shutdownRecovery.runIrreversible(task) };
}
