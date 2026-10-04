/**
 * [INPUT]: Depends on the composition root's already-fenced terminal owner ports, irreversible-boundary callback and the E2E fault seam (a named owner can be made to fail)
 * [OUTPUT]: Closes the quota service and every desktop durable/runtime owner in the single canonical shutdown order, each in isolation, then reports every failure together
 * [POS]: Terminal shutdown ordering authority; admission fencing, recovery, UI notification, and Electron quit remain outside this module
 */

import { artifactRuntime, configureArtifactRuntime } from "../../artifacts/runtime";
import { interruptionPoint } from "../boot/composition-hooks";

type Maybe<T> = T | null | undefined;
type Shutdown = { shutdown(): Promise<unknown> | unknown };
type CloseAndFlush = { closeAndFlush(): Promise<unknown> | unknown };
type Close = { close(): Promise<unknown> | unknown };

export type TerminalOwnerSequence = {
  irreversible(): Promise<unknown>;
  memory: Maybe<Shutdown & CloseAndFlush>;
  skillsTurnCustody: Maybe<Shutdown>;
  unifiedSkills: Maybe<Shutdown>;
  projects: Maybe<CloseAndFlush>;
  historyImport: Maybe<CloseAndFlush>;
  shutdownTitles(): Promise<unknown>;
  chats: Maybe<{ awaitTitleJobs(): Promise<unknown> | unknown }>;
  browser: Maybe<Shutdown>;
  bases: Maybe<CloseAndFlush>;
  relay: Maybe<CloseAndFlush>;
  archive: Maybe<CloseAndFlush>;
  lifecycleIntents: Maybe<CloseAndFlush>;
  chatStore: Maybe<CloseAndFlush>;
  chatMirrors?: Maybe<Close>;
  library?: Maybe<Close>;
  profileRecovery?: Maybe<Close & { stop(): Promise<unknown> }>;
  chatHome: Maybe<CloseAndFlush>;
  projectStore: Maybe<CloseAndFlush>;
  settings: Maybe<CloseAndFlush>;
  usage: Maybe<Shutdown>;
  usageLimits?: Maybe<Shutdown>;
  setup: Shutdown;
  apps: Maybe<Shutdown>;
  /** 常驻 Agent 连接：必须先于内置 bridge 收口，CLI 才不会对着已关的 socket 重连。 */
  turnCustodyJournal: Maybe<CloseAndFlush>;
  builtinBridge: Maybe<Close>;
  update: Maybe<{ stop(): unknown }>;
};

export async function closeTerminalOwnerSequence(owners: TerminalOwnerSequence) {
  await owners.irreversible();
  /* Past the irreversible boundary every owner is closed in order even when one fails: a failure used to skip
     every later flush and `library.close`, which then left the folder lock behind (F-27, F-01). */
  const failures: unknown[] = [];
  const step = async (name: string, close: () => unknown) => {
    try { interruptionPoint("terminal-owner", name); await close(); } catch (cause) { failures.push(cause); }
  };
  await step("profileRecovery.stop", () => owners.profileRecovery?.stop());
  await step("memory.shutdown", () => owners.memory?.shutdown());
  await step("skillsTurnCustody", () => owners.skillsTurnCustody?.shutdown());
  await step("unifiedSkills", () => owners.unifiedSkills?.shutdown());
  await step("projects", () => owners.projects?.closeAndFlush());
  await step("historyImport", () => owners.historyImport?.closeAndFlush());
  await step("titles", () => owners.shutdownTitles());
  await step("chats.awaitTitleJobs", () => owners.chats?.awaitTitleJobs());
  await step("browser", () => owners.browser?.shutdown());
  await step("bases", () => owners.bases?.closeAndFlush());
  await step("relay", () => owners.relay?.closeAndFlush());
  await step("memory.closeAndFlush", () => owners.memory?.closeAndFlush());
  await step("archive", () => owners.archive?.closeAndFlush());
  await step("lifecycleIntents", () => owners.lifecycleIntents?.closeAndFlush());
  await step("artifacts", () => artifactRuntime()?.close());
  await step("artifact-runtime", () => { configureArtifactRuntime(undefined); });
  await step("chatMirrors", () => owners.chatMirrors?.close());
  await step("chatStore", () => owners.chatStore?.closeAndFlush());
  await step("chatHome", () => owners.chatHome?.closeAndFlush());
  await step("projectStore", () => owners.projectStore?.closeAndFlush());
  await step("settings", () => owners.settings?.closeAndFlush());
  await step("usageLimits", () => owners.usageLimits?.shutdown());
  await step("usage", () => owners.usage?.shutdown());
  await step("setup", () => owners.setup.shutdown());
  await step("apps", () => owners.apps?.shutdown());
  await step("turnCustodyJournal", () => owners.turnCustodyJournal?.closeAndFlush());
  await step("builtinBridge", () => owners.builtinBridge?.close());
  await step("library", () => owners.library?.close());
  await step("profileRecovery.close", () => owners.profileRecovery?.close());
  await step("update", () => { owners.update?.stop(); });
  if (failures.length) throw new AggregateError(failures, "Terminal owner shutdown failed");
}
