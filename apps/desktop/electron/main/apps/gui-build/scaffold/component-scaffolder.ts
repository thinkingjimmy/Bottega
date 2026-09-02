/**
 * [INPUT]: Depends on a signed packaged component catalog, exact snapshot bytes, and live App component mirror/origin files
 * [OUTPUT]: Provides transactional deterministic component add/update/remove with content-addressed merge bases, bounded three-way conflict evidence, and origin-blob garbage collection
 * [POS]: gui-build pre-freeze authoring boundary; it may update App-owned source but never compiler output or sealed generations. Removing a component from components.json drops its origins entry and blob only — the .tsx stays as plain author source so the build never breaks
 */

import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { canonicalDigest, canonicalJson, sha256 } from "../metadata";
import {
  componentAuthorMirrorSchema,
  componentCatalogSchema,
  componentOriginsSchema,
  type ComponentCatalog,
  type ComponentOrigins,
  type ComponentScaffoldConflict,
  type ComponentScaffoldResult,
} from "./contracts";

type PlannedWrite = Readonly<{ path: string; bytes: Buffer }>;

export class AppGuiComponentScaffolder {
  constructor(private readonly snapshotRoot: string) {}

  async sync(appRoot: string): Promise<ComponentScaffoldResult> {
    const catalog = await this.catalog();
    const mirror = componentAuthorMirrorSchema.parse(
      JSON.parse(await readFile(join(appRoot, "gui/components.json"), "utf8"))
    );
    const originsPath = join(appRoot, "gui/component-origins.json");
    const origins = componentOriginsSchema.parse(
      JSON.parse(await readFile(originsPath, "utf8"))
    );
    const byId = new Map(catalog.components.map((component) => [component.id, component]));
    const originById = new Map(origins.files.map((origin) => [origin.componentId, origin]));
    const conflicts: ComponentScaffoldConflict[] = [];
    const writes: PlannedWrite[] = [];
    /* 从空开始重建，而不是复制旧清单：镜像里被移除的组件因此自然消失。
       复制旧清单会让每一次 sync 把陈旧条目重新写回，source-validator 从此
       永远报 GUI_BUILD_COMPONENT_ORIGIN_INVALID，作者再也构不出 App。 */
    const nextOrigins = new Map<string, ComponentOrigins["files"][number]>();
    const added: string[] = [];
    const updated: string[] = [];
    const retained: string[] = [];

    for (const componentId of [...new Set(mirror.components)].sort(compareText)) {
      const component = byId.get(componentId);
      if (!component) {
        conflicts.push(conflict(componentId, "unknown-component", null, null, null, "Component is absent from the signed snapshot."));
        continue;
      }
      const upstream = await this.source(component.sourcePath, component.sha256);
      const targetPath = join(appRoot, component.targetPath);
      const current = await regularFile(targetPath);
      const origin = originById.get(componentId);
      if (!origin) {
        if (current) {
          conflicts.push(conflict(componentId, "untracked-target", null, sha256(current), component.sha256, lineDiff(null, current, upstream)));
          continue;
        }
        planInstall(writes, nextOrigins, appRoot, catalog, component, upstream);
        added.push(componentId);
        continue;
      }
      const base = await regularFile(join(appRoot, origin.originBlobPath));
      const baseDigest = base ? sha256(base) : null;
      const currentDigest = current ? sha256(current) : null;
      if (!base || baseDigest !== origin.originFileDigest || !current) {
        conflicts.push(conflict(componentId, "missing-base", baseDigest, currentDigest, component.sha256, lineDiff(base, current, upstream)));
        continue;
      }
      const trusted = origin.originSnapshotDigest === catalog.snapshotDigest ||
        catalog.compatibleOriginSnapshots.includes(origin.originSnapshotDigest);
      if (!trusted) {
        conflicts.push(conflict(componentId, "unknown-origin", baseDigest, currentDigest, component.sha256, lineDiff(base, current, upstream)));
        continue;
      }
      if (currentDigest === component.sha256) {
        planOrigin(nextOrigins, catalog, component);
        retained.push(componentId);
        continue;
      }
      if (origin.originFileDigest === component.sha256) {
        nextOrigins.set(componentId, origin);
        retained.push(componentId);
        continue;
      }
      if (currentDigest === origin.originFileDigest) {
        planInstall(writes, nextOrigins, appRoot, catalog, component, upstream);
        updated.push(componentId);
        continue;
      }
      conflicts.push(conflict(componentId, "concurrent-edits", baseDigest, currentDigest, component.sha256, lineDiff(base, current, upstream)));
    }

    if (conflicts.length) return { status: "conflict", conflicts };
    const next: ComponentOrigins = {
      schemaVersion: 1,
      componentSnapshotDigest: catalog.snapshotDigest,
      files: [...nextOrigins.values()].sort((left, right) => compareText(left.componentId, right.componentId)),
    };
    writes.push({ path: originsPath, bytes: Buffer.from(`${canonicalJson(next)}\n`) });
    for (const write of writes) await atomicWrite(write.path, write.bytes);
    await collectOrphanBlobs(appRoot, next);
    const removed = [...originById.keys()]
      .filter((componentId) => !nextOrigins.has(componentId))
      .sort(compareText);
    return { status: "ready", added, updated, retained, removed };
  }

  private async catalog(): Promise<ComponentCatalog> {
    const catalog = componentCatalogSchema.parse(
      JSON.parse(await readFile(join(this.snapshotRoot, "catalog.json"), "utf8"))
    );
    const { snapshotDigest: _snapshotDigest, ...identity } = catalog;
    if (canonicalDigest(identity) !== catalog.snapshotDigest) {
      throw Object.assign(new Error("Component snapshot digest mismatch"), { code: "GUI_BUILD_COMPONENT_CATALOG_INVALID" });
    }
    const ids = new Set<string>();
    const targets = new Set<string>();
    for (const component of catalog.components) {
      if (ids.has(component.id) || targets.has(component.targetPath)) {
        throw Object.assign(new Error("Component snapshot contains duplicate identities"), { code: "GUI_BUILD_COMPONENT_CATALOG_INVALID" });
      }
      ids.add(component.id);
      targets.add(component.targetPath);
    }
    return catalog;
  }

  private async source(path: string, expected: `sha256:${string}`) {
    const bytes = await regularFile(join(this.snapshotRoot, path));
    if (!bytes || sha256(bytes) !== expected) {
      throw Object.assign(new Error(`Component snapshot source drift: ${path}`), { code: "GUI_BUILD_COMPONENT_CATALOG_INVALID" });
    }
    return bytes;
  }
}

/* 只回收 origin blob，绝不删除 gui/src/components/ui/*.tsx：作者可能仍在 import
   它。镜像里移除一个组件的语义因此是「脱离 scaffold 托管，退回普通作者源码」，
   这条语义永远构得出 App；删源码则会把构建直接打死。 */
async function collectOrphanBlobs(appRoot: string, origins: ComponentOrigins) {
  const blobRoot = join(appRoot, "gui/.bottega/origin-blobs/sha256");
  const referenced = new Set(origins.files.map((origin) => origin.originBlobPath));
  const entries = await readdir(blobRoot, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (referenced.has(`gui/.bottega/origin-blobs/sha256/${entry.name}`)) continue;
    await unlink(join(blobRoot, entry.name)).catch(() => undefined);
  }
}

function planInstall(
  writes: PlannedWrite[],
  origins: Map<string, ComponentOrigins["files"][number]>,
  appRoot: string,
  catalog: ComponentCatalog,
  component: ComponentCatalog["components"][number],
  bytes: Buffer
) {
  writes.push({ path: join(appRoot, component.targetPath), bytes });
  writes.push({ path: join(appRoot, blobPath(component.sha256)), bytes });
  planOrigin(origins, catalog, component);
}

function planOrigin(
  origins: Map<string, ComponentOrigins["files"][number]>,
  catalog: ComponentCatalog,
  component: ComponentCatalog["components"][number]
) {
  origins.set(component.id, {
    componentId: component.id,
    path: component.targetPath,
    originSnapshotDigest: catalog.snapshotDigest,
    originFileDigest: component.sha256,
    originBlobPath: blobPath(component.sha256),
  });
}

function blobPath(digest: `sha256:${string}`) {
  return `gui/.bottega/origin-blobs/sha256/${digest.slice(7)}`;
}

async function regularFile(path: string) {
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.nlink !== 1) return null;
    return await readFile(path);
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw cause;
  }
}

async function atomicWrite(path: string, bytes: Buffer) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, bytes, { mode: 0o600, flag: "wx" });
  await rename(temporary, path);
}

function conflict(
  componentId: string,
  reason: ComponentScaffoldConflict["reason"],
  baseDigest: `sha256:${string}` | null,
  currentDigest: `sha256:${string}` | null,
  upstreamDigest: `sha256:${string}` | null,
  diff: string
): ComponentScaffoldConflict {
  return { componentId, reason, baseDigest, currentDigest, upstreamDigest, diff };
}

function lineDiff(base: Buffer | null, current: Buffer | null, upstream: Buffer) {
  const split = (value: Buffer | null) => value?.toString("utf8").split("\n") ?? [];
  const [baseLines, currentLines, upstreamLines] = [split(base), split(current), split(upstream)];
  const limit = Math.min(Math.max(baseLines.length, currentLines.length, upstreamLines.length), 2_000);
  for (let index = 0; index < limit; index += 1) {
    if (baseLines[index] !== currentLines[index] || baseLines[index] !== upstreamLines[index]) {
      return [
        `@@ line ${index + 1} @@`,
        `- base: ${bounded(baseLines[index])}`,
        `< current: ${bounded(currentLines[index])}`,
        `> upstream: ${bounded(upstreamLines[index])}`,
      ].join("\n");
    }
  }
  return "No textual line difference; file identity differs.";
}

function bounded(value: string | undefined) {
  return (value ?? "<missing>").slice(0, 240);
}

function compareText(left: string, right: string) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}
