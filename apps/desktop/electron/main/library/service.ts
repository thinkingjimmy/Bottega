/**
 * [INPUT]: Depends on settings, shared safety/open admission, this computer's machine key, private last-location recording, typed LibraryError codes and content mounts.
 * [OUTPUT]: Owns one selected folder per profile, admits a configured root only when it is still present, admissible (never home, a volume root or a standard user folder) and published by no other computer, adopts its identity once, keeps the path and identity of a folder that disappeared so it can be located and adopted, and reports a folderless profile as unconfigured so onboarding is reached.
 * [POS]: Main-process folder lifetime; stores remain the sole writers of their own content.
 */
import { realpath } from "node:fs/promises";
import type { SettingsStore } from "../settings/settings-store";
import { isErrnoCode } from "../persistence/durable-json";
import { SerialQueue } from "../persistence/serial-queue";
import { LibraryError } from "./errors";
import type { LibraryIdentity } from "./identity";
import { acquireLibraryLock } from "./lock";
import { acquireLibraryAccess } from "./safety/open";
import { rememberLibraryLocation } from "./recovery/location";

export class LibraryService {
  private readonly queue = new SerialQueue();
  private lock: Awaited<ReturnType<typeof acquireLibraryLock>> | null = null;
  private identity: LibraryIdentity | null = null;
  private location: string | null = null;
  private mount: (() => Promise<void>) | null = null;
  /** Without a machine key there is no computer to compare a folder's marker against, so ownership is simply not enforced. */
  constructor(private settings: SettingsStore, private installationId: string, private machineIdHash?: () => Promise<string | null>,
    /** This profile's userData; lets the lock retire an owner from this same profile after a crash. */
    private userData?: string) {}
  get root() { this.lock?.assertOwned(); return this.location; }
  requireRoot() { const root = this.root; if (!root) throw new Error("LIBRARY_NOT_CONFIGURED"); return root; }
  setMount(mount: () => Promise<void>) { this.mount = mount; }
  async initialize() {
    const root = this.settings.get().libraryRoot;
    /* A folder that is gone keeps its path and identity. Renaming or moving it in Finder looks exactly
       like deleting it, so forgetting would make the moved folder unrecognizable and strand every Chat
       Home inside it; startup recovery searches by identity before offering manual selection. */
    if (root) return this.acquire(root, "configured");
    /* A profile written before the folder became the store records chatHomeState
       "ready" while owning no folder at all. Onboarding admission keys on that one
       value, so leaving it alone opens a workspace whose attachments, Apps, Bases
       and Projects have nowhere to read from. Correcting it here is what routes the
       person to the folder step instead of into a hollow app. */
    if (this.settings.get().chatHomeState !== "unconfigured") await this.settings.setTrusted({ chatHomeState: "unconfigured" });
  }
  /* A configured folder is evidence, never a target: recreating a deleted or unmounted
     root would mint a second identity and lock this profile out of its own data at every
     later launch. Only the first selection may bring a folder into existence. */
  private async acquire(root: string, mode: "configured" | "select") {
    const canonical = await realpath(root).catch(error => { if (isErrnoCode(error, "ENOENT")) return root; throw error; });
    if (this.location === canonical && this.lock) { this.lock.assertOwned(); return; }
    if (this.location) throw new LibraryError("already-configured");
    const access = await acquireLibraryAccess({ root, installationId:this.installationId, userData:this.userData,
      expectedId:this.settings.get().libraryId, machineIdHash:this.machineIdHash, create:mode === "select" });
    const { identity } = access;
    this.lock = access.lock; this.location = access.root; this.identity = identity;
    /* A folder adopted through startup recovery carries no recorded identity yet;
       recording it here is what lets the next launch still notice a swapped folder. */
    if (mode === "configured" && !this.settings.get().libraryId) await this.settings.setTrusted({ libraryId: identity.libraryId });
    if (this.userData) await rememberLibraryLocation(this.userData, canonical, identity.libraryId);
  }
  openLibrary(root: string) {
    return this.queue.enqueue(async () => {
      const configured = this.settings.get().libraryRoot;
      const canonical = await realpath(root).catch(error => { if (isErrnoCode(error, "ENOENT")) return root; throw error; });
      if (configured && canonical !== configured) throw new LibraryError("root-changed");
      await this.acquire(root, configured ? "configured" : "select");
      await this.settings.setTrusted({ libraryRoot: this.location, libraryId: this.identity!.libraryId, chatHomesRoot: this.location, chatHomeState: "unconfigured" });
      await this.mount?.();
      await this.settings.setTrusted({ chatHomeState: "ready" });
    });
  }
  async markMounted() { if (this.root) await this.settings.setTrusted({ chatHomeState: "ready" }); }
  async close() { this.queue.close(); await this.queue.flush(); await this.lock?.close(); this.lock = null; }
}
