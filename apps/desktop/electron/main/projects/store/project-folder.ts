/**
 * [INPUT]: Depends on validated Project content, the selected folder and the ProjectStore single-writer queue.
 * [OUTPUT]: Splits forward-tolerant project.json files from profile-local authority and replays revision-bound durable intents.
 * [POS]: Project persistence adapter; opening content never restores directory grants or invents a synchronization baseline.
 */
import { lstat, readFile, readdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { z } from "zod";
import { canonicalJson, portableProjectSchema } from "@ai-chat/cloud-protocol";
import { durableReplaceFile, isErrnoCode, syncDirectory } from "../../persistence/durable-json";
import { libraryDirectory, libraryObjectId } from "../../library/paths";
import { trashLibraryObject } from "../../library/trash";
import { projectFileSchema, storedProjectSchema, type ProjectFile, type StoredProject } from "./project-store-schema";
import { exportProject } from "./portable/queue";

const { cloudRevision: _cloud, sourceDeviceId: _device, ...portableFields } = portableProjectSchema.shape;
/* Folder files are read by every future build: an unknown version stays readable and unknown keys survive
   the round trip, so a newer build's fields are not destroyed by an older one writing the same record.
   `portableKind` is the only record of what a folderless Project meant, because `workspaceBinding` lives
   in profile-local authority: without it a restored grouping Project and a restored workspace Project
   are byte-identical, and one of the two would get the wrong binding. */
const contentSchema = z.object({ ...portableFields, portableKind: z.enum(["user", "grouping", "app", "base-custody"]).optional(), version: z.number().int().min(1), contentRevision: z.number().int().nonnegative() }).catchall(z.unknown());
type Content = z.infer<typeof contentSchema>;
const contentKeys = new Set(Object.keys(contentSchema.shape));
const { name: _name, sortIndex: _sort, appearance: _appearance, archivedAt: _archive, createdAt: _created,
  updatedAt: _updated, role: _role, gitRemote: _remote, ...localFields } = storedProjectSchema.shape;
const localRowSchema = z.object({ ...localFields, contentRevision: z.number().int().nonnegative(), contentHash: z.string().regex(/^[a-f0-9]{64}$/).optional() }).strict();
type LocalRow = z.infer<typeof localRowSchema>;
const localSchema = z.object({ ...projectFileSchema.shape, projects: z.array(localRowSchema) }).strict();
type Local = z.infer<typeof localSchema>;
const intentSchema = z.object({ version: z.literal(1), target: localSchema, contents: z.array(contentSchema), removed: z.array(z.string()) }).strict();
type Intent = z.infer<typeof intentSchema>;
const contentHash = (value: Content) => createHash("sha256").update(canonicalJson(value)).digest("hex");
/** ENOENT, invalid shape and unparsable bytes describe the object; any other errno describes this computer and must abort. */
const unreadableContent = (error: unknown) =>
  isErrnoCode(error, "ENOENT") || typeof (error as { code?: unknown } | null)?.code !== "string";

/** A workspace Project restored without its local row owns no folder on this computer yet; it must
    ask for one rather than inherit the Chat Home that grouping and custody Projects legitimately use. */
function restoredBinding(content: Content) {
  if (content.appId) return { kind: "app" as const, appId: content.appId };
  return content.role === "base-custody" || content.portableKind === "grouping"
    ? { kind: "none" as const }
    : { kind: "unbound" as const };
}

async function readJson(path: string) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 32 * 1024 * 1024) throw new Error("PROJECT_FOLDER_FILE_INVALID");
  return JSON.parse(await readFile(path, "utf8"));
}
export class ProjectFolder {
  readonly path: string;
  private readonly intentPath: string;
  private contents = new Map<string, Content>();
  /** Saved authority of objects this build could not read; write() carries it through instead of rebuilding without it. */
  private readonly unreadable = new Map<string, LocalRow>();
  constructor(private userData: string, private root: () => string | null,
    private checkpoint?: (phase: "intent" | "content" | "commit") => Promise<void>) {
    this.path = join(userData, "projects-local.json"); this.intentPath = `${this.path}.intent`;
  }
  private async local() {
    for (const path of [this.path, `${this.path}.bak`]) {
      try { return localSchema.parse(await readJson(path)); }
      catch (error) {
        if (isErrnoCode(error, "ENOENT")) continue;
        await rename(path, `${path}.corrupt-${Date.now()}`);
        const versions = (await readdir(this.userData)).filter(name => name.startsWith(path.slice(this.userData.length + 1) + ".corrupt-")).sort().reverse();
        for (const old of versions.slice(3)) await rm(join(this.userData, old));
      }
    }
    return undefined;
  }
  private async publishLocal(target: Local) {
    const text = JSON.stringify(target, null, 2) + "\n";
    await durableReplaceFile(`${this.path}.bak`, text); await durableReplaceFile(this.path, text);
  }
  private requireRoot() {
    const root = this.root(); if (!root) throw new Error("LIBRARY_NOT_CONFIGURED");
    return root;
  }
  /** Reads and probes join without touching the disk; only a write may bring an object directory into existence. */
  private objectPath(id: string) { return join(this.requireRoot(), "projects", libraryObjectId(id), "project.json"); }
  private async contentPath(id: string) {
    return join(await libraryDirectory(this.requireRoot(), "projects", id), "project.json");
  }
  private async readContent(id: string) {
    try { return contentSchema.parse(await readJson(this.objectPath(id))); }
    catch (error) { if (!unreadableContent(error)) throw error; return null; }
  }
  private async recover() {
    let intent: Intent;
    try { intent = intentSchema.parse(await readJson(this.intentPath)); }
    catch (error) {
      if (isErrnoCode(error, "ENOENT")) return;
      // Corrupt synchronization state is preserved; it cannot authorize content writes.
      await rename(this.intentPath, `${this.intentPath}.corrupt-${Date.now()}`); return;
    }
    const pending: Content[] = [];
    for (const content of intent.contents) {
      const current = await this.readContent(content.id);
      // Content past this intent means a later commit already landed; replaying would undo it.
      if (current && current.contentRevision > content.contentRevision) { await this.discardIntent(); return; }
      if (!current || canonicalJson(current) !== canonicalJson(content)) pending.push(content);
    }
    /* The intent carries the field baseline of its own commit, so replaying it forward is the only restart
       that keeps a queued cloud association. Discarding it would silently drop `sync` from every project. */
    for (const content of pending) await durableReplaceFile(await this.contentPath(content.id), JSON.stringify(content, null, 2) + "\n");
    for (const id of intent.removed) await trashLibraryObject(this.requireRoot(), "projects", id, String(intent.target.commitGeneration));
    await this.publishLocal(intent.target);
    await this.discardIntent();
  }
  private async discardIntent() { await rm(this.intentPath); await syncDirectory(this.userData); }
  async read(empty: ProjectFile): Promise<ProjectFile> {
    if (!this.root()) return empty;
    await this.recover();
    const local = await this.local(), root = await libraryDirectory(this.requireRoot(), "projects");
    this.contents.clear(); this.unreadable.clear();
    const projects: StoredProject[] = [];
    let lifecycleSequence = local?.lifecycleSequence ?? 0;
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      try {
        const content = contentSchema.parse(await readJson(this.objectPath(entry.name)));
        if (content.id !== entry.name) throw new Error("PROJECT_FOLDER_IDENTITY_CHANGED");
        const { appId } = content;
        // Fields this build does not know stay in the file; they must not reach the strict local record.
        const metadata = Object.fromEntries(Object.entries(content).filter(([key]) =>
          contentKeys.has(key) && key !== "version" && key !== "contentRevision" && key !== "portableKind" && key !== "appId"));
        const saved = local?.projects.find(item => item.id === content.id);
        const { contentRevision: localRevision, contentHash: localHash, ...authority } = saved ?? { contentRevision: 0, contentHash: undefined };
        // A restored content file cannot reuse a baseline belonging to a different revision.
        if (localRevision !== content.contentRevision || localHash !== contentHash(content)) { if ("sync" in authority) delete authority.sync; }
        const project = storedProjectSchema.parse({ dir: "", workspaceBinding: restoredBinding(content),
          nameSource: appId ? "app" : "user", appPlacements: [], grants: [], grantRevision: 0, membershipRevision: 0,
          projectLifecycleRevision: ++lifecycleSequence, resourceAdmissions: [], ...authority, ...metadata });
        projects.push(project); this.contents.set(content.id, content);
      } catch (error) {
        // One EACCES or EMFILE must not rebuild this computer's authority without the object it could not read.
        if (!unreadableContent(error)) throw error;
        const row = local?.projects.find(item => item.id === entry.name);
        if (row) this.unreadable.set(entry.name, row);
        console.warn("Project folder content unavailable", entry.name, error);
      }
    }
    const next = { ...empty, ...local, projects, lifecycleSequence };
    // A portable record removed outside the app does not authorize a local deletion receipt.
    next.deletionReceipts = next.deletionReceipts.filter(receipt => !projects.some(project => project.id === receipt.projectId));
    return projectFileSchema.parse(next);
  }
  async write(file: ProjectFile) {
    if (!this.root()) { if (file.projects.length) throw new Error("LIBRARY_NOT_CONFIGURED"); return; }
    const contents = file.projects.map(project => {
      const { cloudRevision: _revision, sourceDeviceId: _source, ...metadata } = exportProject(project);
      const before = this.contents.get(project.id);
      // Fields this build does not know belong to whoever wrote them; they ride along and never bump the revision.
      const carried = before ? Object.fromEntries(Object.entries(before).filter(([key]) => !contentKeys.has(key))) : {};
      const candidate = contentSchema.parse({ ...carried, ...metadata,
        portableKind: metadata.appId ? "app" : metadata.role === "base-custody" ? "base-custody"
          : project.workspaceBinding.kind === "none" ? "grouping" : "user",
        version: before?.version ?? 1, contentRevision: before?.contentRevision ?? 0 });
      if (before && canonicalJson(before) === canonicalJson(candidate)) return before;
      return { ...candidate, contentRevision: (before?.contentRevision ?? 0) + 1 };
    });
    const local = localSchema.parse({ ...file, projects: [...file.projects.map(project => {
      const { name: _n, sortIndex: _s, appearance: _a, archivedAt: _r, createdAt: _c, updatedAt: _u, role: _role, gitRemote: _remote, ...authority } = project;
      const content = contents.find(content => content.id === project.id)!;
      return { ...authority, contentRevision: content.contentRevision, contentHash: contentHash(content) };
    }), ...this.unreadable.values()] });
    const intent = intentSchema.parse({ version: 1, target: local, contents,
      removed: [...this.contents.keys()].filter(id => !file.projects.some(project => project.id === id)) });
    await durableReplaceFile(this.intentPath, JSON.stringify(intent) + "\n"); await this.checkpoint?.("intent");
    for (const content of contents) {
      if (canonicalJson(this.contents.get(content.id) ?? null) !== canonicalJson(content))
        await durableReplaceFile(await this.contentPath(content.id), JSON.stringify(content, null, 2) + "\n");
    }
    for (const id of intent.removed) await trashLibraryObject(this.requireRoot(), "projects", id, String(file.commitGeneration));
    await this.checkpoint?.("content"); await this.publishLocal(local); await this.checkpoint?.("commit");
    await this.discardIntent();
    this.contents = new Map(contents.map(content => [content.id, content]));
  }
}
