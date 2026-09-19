/**
 * [INPUT]: Depends on App content, source availability and the profile-local catalog through AppStore's sole queue.
 * [OUTPUT]: Stores forward-tolerant app.json separately from installation authority, grants, ciphertext and publication receipts.
 * [POS]: App folder persistence adapter; restored source requires local installation before execution.
 */
import { lstat, readFile, readdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { libraryDirectory, libraryObjectId } from "../../../library/paths";
import { trashLibraryObject } from "../../../library/trash";
import { createHash, randomUUID } from "node:crypto";
import { translate } from "../../../../../shared/i18n/runtime";
import type { AppLocale } from "@ai-chat/ui/lib/locale";
import { durableReplaceFile, isErrnoCode, syncDirectory } from "../../../persistence/durable-json";
import { appRecordSchema, SCHEMA_VERSION, parseStore, storeSchema, type StoreFile } from "../app-store-schema";
import { emptyAppPortableCatalog, appDescriptorSchema } from "../portable/model";
import { canonicalJson, createInstallingAppRecord } from "../../support";
const portableKeys = ["id", "sourceRepoUrl", "publishedRepoUrl", "origin", "presetId", "installedPresetPin", "displayName", "editableSource", "addedAt"] as const;
/* Folder files outlive this build: an unknown version stays readable and unknown keys survive the round
   trip, so a newer build's fields are not destroyed by an older one rewriting the same record. */
const contentSchema = z.object({
  version: z.number().int().min(1), contentRevision: z.number().int().nonnegative(), kind: z.enum(["installed-source", "descriptor"]),
  id: appRecordSchema.shape.id, displayName: appRecordSchema.shape.displayName, sourceRepoUrl: appRecordSchema.shape.sourceRepoUrl,
  publishedRepoUrl: appRecordSchema.shape.publishedRepoUrl, origin: appRecordSchema.shape.origin,
  presetId: appRecordSchema.shape.presetId, installedPresetPin: appRecordSchema.shape.installedPresetPin,
  editableSource: z.boolean(), addedAt: z.number().int().nonnegative(),
  association: z.object({ projectId: z.string(), baseId: z.string(), dataCoverage: z.enum(["base-only", "partial"]) }).nullable(),
}).catchall(z.unknown());
type Content = z.infer<typeof contentSchema>;
const contentKeys = new Set(Object.keys(contentSchema.shape));
const localFields = Object.fromEntries(Object.entries(appRecordSchema.shape).filter(([key]) => !(portableKeys as readonly string[]).includes(key)));
const localRecord = z.object({ ...localFields, id: appRecordSchema.shape.id, contentRevision: z.number().int().nonnegative() }).strict();
type LocalRecord = z.infer<typeof localRecord>;
const contentBinding = z.object({ contentRevision: z.number().int().nonnegative(), hash: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
type ContentBinding = z.infer<typeof contentBinding>;
const localSchema = z.object({ ...storeSchema.shape, apps: z.array(localRecord), contentBindings: z.record(z.string(), contentBinding).default({}) }).strict();
const binding = (content: Content) => ({ contentRevision: content.contentRevision, hash: createHash("sha256").update(canonicalJson(content)).digest("hex") });
const intentSchema = z.object({ version: z.literal(1), operationId: z.string().uuid(), local: localSchema, contents: z.array(contentSchema), removed: z.array(appRecordSchema.shape.id) }).strict();
const empty = () => parseStore({ schemaVersion: SCHEMA_VERSION, apps: [], portable: emptyAppPortableCatalog(), retiredIds: [] });
/** ENOENT, invalid shape and unparsable bytes describe the object; any other errno describes this computer and must abort. */
const unreadableContent = (error: unknown) =>
  isErrnoCode(error, "ENOENT") || typeof (error as { code?: unknown } | null)?.code !== "string";
async function readJson(path: string) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 64 * 1024 * 1024) throw new Error("APP_FOLDER_FILE_INVALID");
  return JSON.parse(await readFile(path, "utf8"));
}
export class AppFolderCatalog {
  readonly path: string;
  private contents = new Map<string, Content>();
  /** Saved authority of objects this build could not read; write() carries it through instead of rebuilding without it. */
  private readonly unreadable = new Map<string, { record?: LocalRecord; binding?: ContentBinding }>();
  constructor(private userData: string, private root: () => string | null,
    private checkpoint?: (phase: "intent" | "content" | "commit") => Promise<void>,
    private locale: () => AppLocale = () => "en") { this.path = join(userData, "apps-local.json"); }
  private requireRoot() {
    const root = this.root(); if (!root) throw new Error("LIBRARY_NOT_CONFIGURED");
    return root;
  }
  /** Reads and probes join without touching the disk; only a write may bring an object directory into existence. */
  private objectPath(id: string) { return join(this.requireRoot(), "apps", libraryObjectId(id), "app.json"); }
  private async contentPath(id: string) { return join(await libraryDirectory(this.requireRoot(), "apps", id), "app.json"); }
  private async readContent(id: string) {
    try { return contentSchema.parse(await readJson(this.objectPath(id))); }
    catch (error) { if (!unreadableContent(error)) throw error; return null; }
  }
  private async local() {
    try { return localSchema.parse(await readJson(this.path)); }
    catch (error) {
      if (isErrnoCode(error, "ENOENT")) return null;
      await rename(this.path, `${this.path}.corrupt-${Date.now()}`);
      const old = (await readdir(this.userData)).filter(name => name.startsWith("apps-local.json.corrupt-")).sort().reverse().slice(3);
      for (const name of old) await rm(join(this.userData, name));
      return null;
    }
  }
  private async recover() {
    const path = `${this.path}.intent`;
    let intent;
    try { intent = intentSchema.parse(await readJson(path)); }
    catch (error) { if (!isErrnoCode(error, "ENOENT")) await rename(path, `${path}.corrupt-${Date.now()}`); return; }
    const pending: Content[] = [];
    for (const content of intent.contents) {
      const current = await this.readContent(content.id);
      // Content past this intent means a later commit already landed; replaying would undo it.
      if (current && current.contentRevision > content.contentRevision) { await rm(path); await syncDirectory(this.userData); return; }
      if (!current || canonicalJson(current) !== canonicalJson(content)) pending.push(content);
    }
    /* The intent carries the field baseline of its own commit, so replaying it forward is the only restart
       that keeps installation authority, grants and publication receipts bound to the content they describe. */
    for (const content of pending) await durableReplaceFile(await this.contentPath(content.id), JSON.stringify(content, null, 2) + "\n");
    for (const id of intent.removed) await trashLibraryObject(this.requireRoot(), "apps", id, intent.operationId);
    await durableReplaceFile(this.path, JSON.stringify(intent.local) + "\n");
    await rm(path); await syncDirectory(this.userData);
  }
  async read(): Promise<StoreFile> {
    if (!this.root()) return empty();
    await this.recover();
    const local = await this.local(), result = empty(); this.contents.clear(); this.unreadable.clear();
    if (local) { result.portable = local.portable; result.retiredIds = local.retiredIds; }
    const root = await libraryDirectory(this.requireRoot(), "apps");
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || !/^[a-z0-9]{10}$/.test(entry.name)) continue;
      try {
        const content = contentSchema.parse(await readJson(this.objectPath(entry.name)));
        if (content.id !== entry.name) throw new Error("APP_FOLDER_IDENTITY_CHANGED");
        const verified = canonicalJson(local?.contentBindings[content.id] ?? null) === canonicalJson(binding(content));
        const saved = verified ? local?.apps.find(item => item.id === content.id) : undefined;
        if (!verified) {
          result.portable.entries = result.portable.entries.filter(item => item.descriptor.appId !== content.id);
          result.portable.admissions = result.portable.admissions.filter(item => item.descriptor.appId !== content.id);
          result.portable.candidates = result.portable.candidates.filter(item => item.appId !== content.id);
          result.portable.publications = result.portable.publications.filter(item => item.operation.appId !== content.id);
          result.portable.deletions = result.portable.deletions.filter(item => item.operation.appId !== content.id);
          result.retiredIds = result.retiredIds.filter(id => id !== content.id);
        }
        const metadata = Object.fromEntries(portableKeys.map(key => [key, content[key]]));
        if (content.kind === "installed-source") {
          const { contentRevision: _revision, ...authority } = saved ?? { contentRevision: 0 };
          result.apps.push(appRecordSchema.parse({ ...createInstallingAppRecord({ id: content.id, repoUrl: content.sourceRepoUrl ?? "", displayName: content.displayName,
            dir: join(root, content.id, "source"), maintenance: null, addedAt: content.addedAt }),
            state: "update-failed", lastError: { phase: "build", message: restoredSourceNotice(this.locale()) },
            ...authority, ...metadata, dir: join(root, content.id, "source") }));
        }
        if (content.association && !result.portable.entries.some(item => item.descriptor.appId === content.id)) {
          result.portable.entries.push({ scope: null, descriptor: appDescriptorSchema.parse({ ...content.association, appId: content.id, name: content.displayName,
            cloudRevision: 0, createdAt: content.addedAt, updatedAt: content.addedAt, packageRevision: null, manifestDigest: null, sourcePackageDigest: null, sourceBlob: null }),
            installation: "not-installed", installedGenerationId: null, installedPackageRevision: null, installedPublication: null, tombstoned: false });
        }
        // Only a fully understood object may join the set write() is allowed to delete from.
        this.contents.set(content.id, content);
      } catch (error) {
        // One EACCES or EMFILE must not rebuild this computer's authority without the object it could not read.
        if (!unreadableContent(error)) throw error;
        this.unreadable.set(entry.name, { record: local?.apps.find(item => item.id === entry.name), binding: local?.contentBindings[entry.name] });
        console.warn("App folder content unavailable", entry.name, error);
      }
    }
    return parseStore(result);
  }
  async write(file: StoreFile) {
    if (!this.root()) { if (file.apps.length || file.portable.entries.length) throw new Error("LIBRARY_NOT_CONFIGURED"); return; }
    const contents: Content[] = [];
    const ids = new Set([...file.apps.map(app => app.id), ...file.portable.entries.filter(entry => !entry.tombstoned).map(entry => entry.descriptor.appId)]);
    for (const id of ids) {
      const app = file.apps.find(item => item.id === id), descriptor = file.portable.entries.find(item => item.descriptor.appId === id)?.descriptor;
      const before = this.contents.get(id), metadata = app ? Object.fromEntries(portableKeys.map(key => [key, app[key]])) : {
        id, displayName: descriptor!.name, sourceRepoUrl: null, publishedRepoUrl: null, origin: "local", editableSource: true, addedAt: descriptor!.createdAt };
      // Fields this build does not know belong to whoever wrote them; they ride along and never bump the revision.
      const carried = before ? Object.fromEntries(Object.entries(before).filter(([key]) => !contentKeys.has(key))) : {};
      const candidate = contentSchema.parse({ ...carried, ...metadata, version: before?.version ?? 1, contentRevision: before?.contentRevision ?? 0,
        kind: app ? "installed-source" : "descriptor", association: descriptor ? { projectId: descriptor.projectId, baseId: descriptor.baseId, dataCoverage: descriptor.dataCoverage } : before?.association ?? null });
      contents.push(before && canonicalJson(before) === canonicalJson(candidate) ? before : { ...candidate, contentRevision: candidate.contentRevision + 1 });
    }
    const local = localSchema.parse({ ...file,
      contentBindings: { ...Object.fromEntries([...this.unreadable].flatMap(([id, saved]) => saved.binding ? [[id, saved.binding]] : [])),
        ...Object.fromEntries(contents.map(content => [content.id, binding(content)])) },
      apps: [...file.apps.map(app => ({ ...Object.fromEntries(Object.entries(app).filter(([key]) => !(portableKeys as readonly string[]).includes(key))),
        id: app.id, contentRevision: contents.find(content => content.id === app.id)!.contentRevision })),
        ...[...this.unreadable.values()].flatMap(saved => saved.record ? [saved.record] : [])] });
    const intent = intentSchema.parse({ version: 1, operationId: randomUUID(), local, contents, removed: [...this.contents.keys()].filter(id => !ids.has(id)) });
    await durableReplaceFile(`${this.path}.intent`, JSON.stringify(intent) + "\n"); await this.checkpoint?.("intent");
    for (const content of contents) if (canonicalJson(this.contents.get(content.id) ?? null) !== canonicalJson(content))
      await durableReplaceFile(await this.contentPath(content.id), JSON.stringify(content, null, 2) + "\n");
    for (const id of intent.removed) await trashLibraryObject(this.requireRoot(), "apps", id, intent.operationId);
    await this.checkpoint?.("content"); await durableReplaceFile(this.path, JSON.stringify(local, null, 2) + "\n"); await this.checkpoint?.("commit");
    await rm(`${this.path}.intent`); await syncDirectory(this.userData); this.contents = new Map(contents.map(content => [content.id, content]));
  }
}

/** Restored source is a state, not a failure of this run; the reader sees it in their own language. */
export const restoredSourceNotice = (locale: AppLocale) => translate(locale, "apps.state.restoredSourceNeedsSetup");
