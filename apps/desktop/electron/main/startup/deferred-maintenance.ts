/**
 * [INPUT]: Depends on ACP trace rotation, the artifact runtime, Gallery/App/Chat/Project/History/Archive services, committed folder settings, the relay ledger and folder trash retention.
 * [OUTPUT]: Provides startDeferredMaintenance: ordered post-window GC/sweep/reconciliation with Design factory provisioning deferred until folder mounting completes. Admission-closed sweeps stay in index.ts.
 * [POS]: The post-window half of the composition root; it owns no lifetime and only names work index.ts used to run before the first frame.
 */

import { recoverOrDefer } from "../persistence/recovery-policy";
import type { AppsService } from "../apps/apps-service";
import { artifactRuntime } from "../artifacts/runtime";
import type { ArchiveService } from "../archive/archive-service";
import { rotateAcpTracesAsync } from "../backends/acp/trace";
import type { ChatStore } from "../chats/chat-store";
import type { ChatsService } from "../chats/chats-service";
import type { GalleryRuntime } from "../gallery/bootstrap";
import type { HistoryImportService } from "../history-import/service";
import { libraryTrashCustody, purgeExpiredTrash } from "../library/trash-retention";
import type { ProjectsService } from "../projects/projects-service";
import type { RelayLedger } from "../sections/coordinator/relay-ledger";
import type { SettingsStore } from "../settings-store";
import { runPostWindowTasks, type PostWindowTask } from "./post-window-tasks";

export type DeferredMaintenanceDependencies = Readonly<{
  traceDirectory: string;
  /** Null while no folder is mounted; the trash pass is skipped rather than guessed. */
  libraryRoot: () => string | null;
  settings: Pick<SettingsStore, "get" | "onChanged">;
  apps: AppsService;
  archive: ArchiveService;
  chats: ChatsService;
  chatStore: ChatStore;
  gallery: GalleryRuntime;
  historyImport: HistoryImportService;
  projects: ProjectsService;
  relayLedger: RelayLedger;
  /* Custody kept these turns quarantined, so their third-party MCP plans stay held. */
  quarantinedTurnRequestIds: ReadonlySet<string> | (() => ReadonlySet<string>);
  cancelled(): boolean;
}>;

/* The renderer's first IPC burst (settings, setup, chats, projects, apps) lands right
   after ready-to-show; maintenance starting at that instant competes with it for the
   main thread and measurably delays the product shell. Nothing here is urgent. */
const POST_WINDOW_SETTLE_MS = 1_500;

/**
 * Every entry here used to sit between `whenReady` and `new BrowserWindow`. They are
 * kept in their original relative order because the ordering contracts that survive
 * the move (custody before App/Extension generation GC, continuation reconciliation
 * before external history sync) are all satisfied by work that stays pre-window.
 *
 * Pending-Skill recovery and the App staging sweep deliberately stayed behind: the sweep
 * treats every staging directory no pending intent references as an orphan, which is only
 * true while Coordinator admission is still closed, and both cost 2-6 ms.
 */
export function startDeferredMaintenance(
  dependencies: DeferredMaintenanceDependencies
) {
  const timer = setTimeout(() => {
    void recoverOrDefer(async () => { await runPostWindowTasks(maintenanceTasks(dependencies), { cancelled: dependencies.cancelled }); });
  }, POST_WINDOW_SETTLE_MS);
  timer.unref();
}

function maintenanceTasks(
  dependencies: DeferredMaintenanceDependencies
): readonly PostWindowTask[] {
  const {
    apps,
    archive,
    cancelled,
    chats,
    chatStore,
    gallery,
    historyImport,
    libraryRoot,
    projects,
    relayLedger,
    quarantinedTurnRequestIds,
    traceDirectory,
  } = dependencies;
  return [
    { name: "acp-trace-rotate", run: () => rotateAcpTracesAsync(traceDirectory) },
    {
      name: "artifacts-reconcile",
      run: async () => void (await artifactRuntime()?.reconcileAll()),
    },
    { name: "gallery-collect-garbage", run: () => gallery.collectGarbage() },
    {
      name: "history-memory-gc",
      run: async () => void (await historyImport.snapshots.gcMemoryOrphans()),
    },
    { name: "gallery-reconcile", run: () => gallery.reconcileIngestion() },
    {
      name: "history-adoption-gc",
      run: async () => {
        const [chatReferences, custodyReferences] = await Promise.all([
          chatStore.adoptionReferenceProjection(),
          relayLedger.adoptionReferenceProjection(),
        ]);
        await historyImport.snapshots.gcAdoptionOrphans({
          complete: chatReferences.complete && custodyReferences.complete,
          refs: new Set([...chatReferences.refs, ...custodyReferences.refs]),
        });
      },
    },
    {
      name: "app-mcp-plan-reconcile",
      run: () => apps.reconcileThirdPartyMcpPlans(new Set(typeof quarantinedTurnRequestIds === "function" ? quarantinedTurnRequestIds() : quarantinedTurnRequestIds)),
    },
    {
      name: "history-background-sync",
      run: async () => historyImport.startBackgroundSync(),
    },
    { name: "archive-purge-recovery", run: () => archive.recoverPurge() },
    {
      /* Every Project runtime handler and retained-resource participant is rebuilt by the
         time the window is up, so the deletion checkpoints resume here instead of waiting
         for the renderer to ask for the same deletion again. */
      name: "project-base-custody-cleanup",
      run: async () => {
        for (const failure of await projects.cleanupEmptyBaseCustody()) {
          console.error(
            `[projects] empty Base custody cleanup (${failure.projectId}) failed: ${failure.message}`
          );
        }
      },
    },
    {
      name: "project-resource-cleanup",
      run: async () => {
        for (const failure of await projects.recoverResourceCleanup()) {
          console.error(
            `[projects] cleanup ${failure.operation}(${failure.projectId}) startup recovery failed: ${failure.message}`
          );
        }
      },
    },
    {
      name: "design-factory",
      run: () => provisionDesignFactoryWhenReady(dependencies),
    },
    {
      name: "chat-attachment-sweep",
      run: async () => {
        const sweep = await chats.sweepAttachments();
        if (sweep.warning) chatStore.pushWarning(sweep.warning);
      },
    },
    {
      /* `.trash/` is the undo behind every deleted Project, App, Skill and Chat Home
         and nothing had ever emptied it. Ageing it out is the last maintenance step:
         the purge and deletion journals it consults are settled by the tasks above. */
      name: "library-trash-purge",
      run: async () => {
        const root = libraryRoot();
        if (!root) return;
        const report = await purgeExpiredTrash({
          root,
          /* `apps.userData` is this profile's directory; the two journals that still
             own trashed content live next to each other in it. */
          custody: await libraryTrashCustody(apps.userData),
          cancelled,
        });
        if (report.removed || report.deferred) {
          console.info(
            `[library] trash purge removed ${report.removed} expired entries, held ${report.held} under custody, deferred ${report.deferred} to the next launch`
          );
        }
      },
    },
  ];
}

async function provisionDesignFactoryWhenReady(dependencies: DeferredMaintenanceDependencies) {
  const ready = () => {
    const { libraryRoot, chatHomeState } = dependencies.settings.get();
    return Boolean(libraryRoot) && chatHomeState === "ready";
  };
  const task: PostWindowTask = {
    name: "design-factory",
    run: async () => void (await dependencies.apps.ensureDesignFactory()),
  };
  if (ready()) { await task.run(); return; }
  /* Selecting a folder first records its path, then mounts the stores. Source installation
     may start only after that final ready commit, without holding up other maintenance. */
  const unsubscribe = dependencies.settings.onChanged(() => {
    if (dependencies.cancelled()) { unsubscribe(); return; }
    if (!ready()) return;
    unsubscribe();
    void recoverOrDefer(async () => {
      await runPostWindowTasks([task], { cancelled: dependencies.cancelled });
    });
  });
}
