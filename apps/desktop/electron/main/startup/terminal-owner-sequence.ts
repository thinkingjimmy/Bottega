/**
 * [INPUT]: Depends on the composition root's already-fenced terminal owner ports and irreversible-boundary callback
 * [OUTPUT]: Closes every desktop durable/runtime owner in the single canonical shutdown order
 * [POS]: Terminal shutdown ordering authority; admission fencing, recovery, UI notification, and Electron quit remain outside this module
 */

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
  chatHome: Maybe<CloseAndFlush>;
  projectStore: Maybe<CloseAndFlush>;
  settings: Maybe<CloseAndFlush>;
  usage: Maybe<Shutdown>;
  setup: Shutdown;
  apps: Maybe<Shutdown>;
  turnCustody: Maybe<Close>;
  turnCustodyJournal: Maybe<CloseAndFlush>;
  builtinBridge: Maybe<Close>;
  update: Maybe<{ stop(): unknown }>;
};

export async function closeTerminalOwnerSequence(owners: TerminalOwnerSequence) {
  await owners.irreversible();
  await owners.memory?.shutdown();
  await owners.skillsTurnCustody?.shutdown();
  await owners.unifiedSkills?.shutdown();
  await owners.projects?.closeAndFlush();
  await owners.historyImport?.closeAndFlush();
  await owners.shutdownTitles();
  await owners.chats?.awaitTitleJobs();
  await owners.browser?.shutdown();
  await owners.bases?.closeAndFlush();
  await owners.relay?.closeAndFlush();
  await owners.memory?.closeAndFlush();
  await owners.archive?.closeAndFlush();
  await owners.lifecycleIntents?.closeAndFlush();
  await owners.chatStore?.closeAndFlush();
  await owners.chatHome?.closeAndFlush();
  await owners.projectStore?.closeAndFlush();
  await owners.settings?.closeAndFlush();
  await owners.usage?.shutdown();
  await owners.setup.shutdown();
  await owners.apps?.shutdown();
  await owners.turnCustody?.close();
  await owners.turnCustodyJournal?.closeAndFlush();
  await owners.builtinBridge?.close();
  owners.update?.stop();
}
