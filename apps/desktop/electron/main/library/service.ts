/**
 * [INPUT]: Depends on settings, folder identity, the folder ownership marker, this computer's machine key, the process lock, typed LibraryError codes and explicitly registered content mounts.
 * [OUTPUT]: Owns one selected folder per profile, admits a configured root only when it is still present and published by no other computer, adopts its identity once, and reports a folderless profile as unconfigured so onboarding is reached.
 * [POS]: Main-process folder lifetime; stores remain the sole writers of their own content.
 */
import { mkdir, lstat, realpath, stat } from "node:fs/promises";
import { join } from "node:path";
import type { SettingsStore } from "../settings-store";
import { isErrnoCode } from "../persistence/durable-json";
import { SerialQueue } from "../persistence/serial-queue";
import { LibraryError } from "./errors";
import { openLibraryIdentity, type LibraryIdentity } from "./identity";
import { readPublisher } from "./publisher";
import { acquireLibraryLock } from "./lock";

export class LibraryService {
  private readonly queue = new SerialQueue();
  private lock: Awaited<ReturnType<typeof acquireLibraryLock>> | null = null;
  private identity: LibraryIdentity | null = null;
  private location: string | null = null;
  private mount: (() => Promise<void>) | null = null;
  /** Without a machine key there is no computer to compare a folder's marker against, so ownership is simply not enforced. */
  constructor(private settings: SettingsStore, private installationId: string, private machineIdHash?: () => Promise<string | null>) {}
  get root() { this.lock?.assertOwned(); return this.location; }
  requireRoot() { const root = this.root; if (!root) throw new Error("LIBRARY_NOT_CONFIGURED"); return root; }
  setMount(mount: () => Promise<void>) { this.mount = mount; }
  async initialize() {
    const root = this.settings.get().libraryRoot;
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
    if (mode === "select") await mkdir(root, { recursive: true, mode: 0o700 });
    else {
      const present = await stat(root).catch(error => { if (isErrnoCode(error, "ENOENT")) return null; throw error; });
      if (!present?.isDirectory()) throw new LibraryError("missing", `LIBRARY_MISSING: ${root}`);
    }
    const canonical = await realpath(root);
    if (this.location === canonical && this.lock) { this.lock.assertOwned(); return; }
    if (this.location) throw new LibraryError("already-configured");
    const control = join(canonical, ".bottega");
    await mkdir(control, { mode: 0o700 }).catch(error => { if (error.code !== "EEXIST") throw error; });
    const info = await lstat(control);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new LibraryError("control-invalid");
    await this.assertPublisher(canonical);
    const lock = await acquireLibraryLock(control, this.installationId);
    let identity: LibraryIdentity;
    try {
      identity = await openLibraryIdentity(control);
      const known = this.settings.get().libraryId;
      if (known && known !== identity.libraryId) throw new LibraryError("identity-changed");
    } catch (error) { await lock.close(); throw error; }
    this.lock = lock; this.location = canonical; this.identity = identity;
    /* A folder adopted through startup recovery carries no recorded identity yet;
       recording it here is what lets the next launch still notice a swapped folder. */
    if (mode === "configured" && !this.settings.get().libraryId) await this.settings.setTrusted({ libraryId: identity.libraryId });
  }
  /* A folder that has been published belongs to the computer that published it. Refusing before the lock keeps a
     folder this installation may not use untouched, and the copy names the computer that can open it. */
  private async assertPublisher(root: string) {
    const machine = await this.machineIdHash?.() ?? null;
    if (!machine) return;
    const publisher = await readPublisher(root);
    if (publisher && publisher.machineIdHash !== machine) throw new LibraryError("owned-elsewhere", `LIBRARY_OWNED_ELSEWHERE: ${publisher.host}`, publisher.host);
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
