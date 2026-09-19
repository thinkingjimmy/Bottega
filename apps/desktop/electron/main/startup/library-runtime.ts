/**
 * [INPUT]: Receives the selected folder, content stores, the current locale and cloud-known Base identities from the composition root.
 * [OUTPUT]: Mounts Project content before Chat references, then Base families after all owners are available; a small unknown set is opened after the window (finishLibraryMount), a large one behind a progress window before it.
 * [POS]: Folder startup and first-selection coordinator; each domain remains its sole durable writer.
 */
import type { AppLocale } from "@ai-chat/ui/lib/locale";
import type { LibraryService } from "../library/service";
import type { ChatMirrorService, MirrorPlan } from "../library/mirrors/service";
import type { ChatStore } from "../chats/chat-store";
import type { ProjectStore } from "../projects/store/project-store";
import type { BaseStore, BaseIdentity } from "../bases/base-store";
import type { AppStore } from "../apps/store/app-store";
import type { BasesService } from "../bases/bases-service";
import { errorMessage } from "../errors";

/* Where "wait for the folder" stops being better than "show the app and keep opening". Both numbers
   describe the same cost from two directions: how many transcripts have to be parsed, and how many
   bytes have to be read. Fifty conversations or 32 MiB is roughly a second of work on a warm disk —
   below that the window would only flash a progress bar it does not need. */
export const LIBRARY_DEFERRED_CHAT_LIMIT = 50;
export const LIBRARY_DEFERRED_BYTE_LIMIT = 32 * 1024 * 1024;
/** Below both limits the window comes first and the unknown copies open behind it. */
export const deferLibraryOpening = (plan: MirrorPlan) =>
  plan.unknown.length < LIBRARY_DEFERRED_CHAT_LIMIT && plan.bytes < LIBRARY_DEFERRED_BYTE_LIMIT;

type LibraryMount = {
  library: LibraryService; mirrors: ChatMirrorService; chats: ChatStore; remountSkills?: () => Promise<void> | undefined;
  projects: ProjectStore; bases: BaseStore; apps: AppStore; baseIdentities: Promise<ReadonlyMap<string, BaseIdentity>>;
  locale?: () => AppLocale;
};

function baseOwners(input: Pick<LibraryMount, "chats" | "projects" | "baseIdentities">) {
  return input.baseIdentities.then(cloud => ({
    identities: new Map([...cloud, ...input.chats.listBaseIdentities().map(identity => [identity.chatId, identity] as const)]),
    projectIds: new Set(input.projects.list().map(project => project.id)),
  }));
}

export async function mountLibraryContent(input: LibraryMount) {
  const mount = async (reselected: boolean) => {
    if (reselected) {
      await input.projects.initialize();
      await input.apps.load();
      await input.remountSkills?.();
      /* A folder chosen while the app is running has a window already: there is nothing to defer
         to and nothing to show a second window for. Progress reaches Settings as it always did. */
      await input.mirrors.reconcile();
    } else await mountAtStartup(input);
    const owners = await baseOwners(input);
    await input.bases.initialize(owners.identities, owners.projectIds);
  };
  input.library.setMount(() => mount(true));
  await mount(false);
  await input.library.markMounted();
}

async function mountAtStartup(input: LibraryMount) {
  const plan = await input.mirrors.plan();
  if (deferLibraryOpening(plan)) {
    await input.mirrors.reconcile({ defer: "unknown" });
    return;
  }
  const splash = await openSplash(input.locale?.() ?? "en", plan.unknown.length);
  const detach = splash ? input.mirrors.onProgress(value => { if (value.phase === "opening") splash.update(value.completed, value.total); }) : null;
  try { await input.mirrors.reconcile(); }
  finally { detach?.(); splash?.close(); }
}

/* The window is decoration around work that has to happen either way, so it is loaded only when
   one is wanted and a failure to build it costs nothing but the progress bar. */
async function openSplash(locale: AppLocale, total: number) {
  try { return await (await import("./library-splash")).openLibrarySplash({ locale, total }); }
  catch (cause) { console.warn(`[library] opening window unavailable: ${errorMessage(cause)}`); return null; }
}

/**
 * The half a window-first mount left behind. Base owners are re-read only when that pass actually
 * produced Chats: a Chat that exists only now is exactly what an absent-owner failure was waiting
 * for, and an unchanged identity set has nothing for the reload to find.
 */
export async function continueLibraryMount(input: Pick<LibraryMount, "chats" | "mirrors" | "projects" | "bases" | "baseIdentities">) {
  if (!(await input.mirrors.reconcileDeferred())) return [];
  const owners = await baseOwners(input);
  return input.bases.reloadIncompleteOwners(owners.identities, owners.projectIds);
}

/**
 * The post-window half, fired and forgotten by the composition root. A Base whose owner only exists
 * after the deferred pass is published without a delta: the renderer contract reads a payload-less
 * change as "refetch", which is exactly what an owner the workbench has never seen needs.
 */
export function finishLibraryMount(input: Parameters<typeof continueLibraryMount>[0] & {
  settled(): void; publish(event: Parameters<BasesService["publishEvent"]>[0]): void;
}) {
  void continueLibraryMount(input).then(recovered => {
    input.settled();
    for (const { ownerKey, snapshot } of recovered) {
      input.publish({ type: "base-changed", ownerKey, ownerInstanceId: snapshot.meta.ownerInstanceId, revision: snapshot.meta.revision });
    }
  }).catch(cause => console.warn(`[library] deferred opening failed: ${errorMessage(cause)}`));
}
