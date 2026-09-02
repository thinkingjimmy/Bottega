/**
 * [INPUT]: Depends on shared Project/Chat/i18n contracts, durable Memory rebind expectations, the Project rebind journal, and the Project resource cleanup coordinator
 * [OUTPUT]: Provides the complete dependency-port contract consumed by ProjectsService, including authoritative App-directory reveal, App Pin eligibility, Base existence, and cleanup ports
 * [POS]: Projects module composition boundary; keeps cross-domain ports out of the Project lifecycle implementation
 */

import type { AppChatRole, ChatSummary } from "../../../shared/chats-ipc";
import type { AppLocale } from "../../../shared/i18n/locale";
import type { ProjectLocalDetachReason } from "../../../shared/projects-ipc";
import type { ProjectResourceCleanupCoordinator } from "./resource-cleanup/coordinator";
import type {
  ProjectRebindCapsule,
  ProjectRebindExpectation,
  ProjectRebindJournal,
} from "./rebind/rebind-journal";

export type ProjectsServiceOptions = {
  locale?: () => AppLocale;
  resolveApp: (appId: string) => { dir: string; name: string } | undefined;
  resolveAppForBinding?: (appId: string) =>
    { dir: string; name: string } | undefined;
  resolveAppDirectory?: (appId: string) => string | undefined;
  isAppProjectAvailable: (appId: string) => boolean;
  canPinApp?: (appId: string) => boolean;
  listProjectRefs: () => Map<string, { latestUpdatedAt: number }>;
  removeChatsByProject: (
    projectId: string,
    projectLifecycle?: "held"
  ) => Promise<void>;
  removeBaseForProject?: (projectId: string) => Promise<void>;
  hasBaseForProject?: (projectId: string) => boolean;
  cancelTurnsByProject: (projectId: string) => Promise<void>;
  hasActiveTurnsByProject: (projectId: string) => boolean;
  getChatBinding: (chatId: string) =>
    { projectId: string | null; incarnationId: string } | undefined;
  assignProjectToChat: (
    chatId: string,
    projectId: string
  ) => Promise<ChatSummary>;
  moveChatProject?: (
    chatId: string,
    expectedSource: string | null,
    target: string | null,
    appRole?: AppChatRole | null
  ) => Promise<ChatSummary>;
  publishChatUpserted: (summary: ChatSummary) => void;
  listChatsByProject: (projectId: string) => string[];
  hasPendingProjectCreation?: (projectId: string) => boolean;
  localDetachReasons?: (projectId: string) => ProjectLocalDetachReason[];
  releaseChatProject: (chatId: string) => Promise<ChatSummary>;
  /** userData plus every App directory; Project directories come from the store. */
  listManagedRoots: () => string[];
  /** Archive lifecycle projection; every mutation rechecks inside the queue. */
  isProjectOpen?: (projectId: string) => boolean;
  /** App conversion acquires the fixed-order gate before entering the queue. */
  admitAppConversion?: <T>(
    projectId: string,
    work: () => Promise<T>
  ) => Promise<T>;
  snapshotMemoryRebind?: (
    projectId: string
  ) => Promise<ProjectRebindExpectation | null>;
  prepareMemoryRebind?: (
    projectId: string,
    operationId: string,
    expectation: ProjectRebindExpectation & { mode: "retain" | "new" }
  ) => Promise<{ applied: boolean }>;
  /** A durable deletion intent rejects later workspace rebinds. */
  hasDeletionFenceForProject?: (projectId: string) => boolean;
  /** Production composition supplies this; isolated tests may omit Memory. */
  rebindJournal?: ProjectRebindJournal;
  onWorkspaceRebound?: (evidence: Pick<
    ProjectRebindCapsule,
    "operationId" | "projectId" | "sourceBinding" | "targetBinding"
  >) => Promise<void>;
  /** Mandatory single boundary for every Project record removal path. */
  resourceCleanup: ProjectResourceCleanupCoordinator;
};
