/**
 * [INPUT]: Main-owned workspace resolution, bounded read grants, Node path/file proofs and native shell actions.
 * [OUTPUT]: Resolves explicit local text-file links, including ignored output, and revalidates native actions.
 * [POS]: Message-file adapter beside the indexed workspace catalog; explicit links do not change file search rules.
 */
import { lstat, realpath } from "node:fs/promises";
import { dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { WORKSPACE_FILE_PATH_BYTE_LIMIT, type WorkspaceFileLinkResult } from "../../../../shared/ipc/workspace/workspace-files-ipc";
import { validWorkspaceRelativePath } from "./workspace-file-index";
import { WorkspaceFileReadAuthority } from "./workspace-file-read";
import { assertWorkspaceScope, type EffectiveWorkspaceResolver } from "./workspace-resolver";

const fields = { scope: z.unknown().transform(assertWorkspaceScope), href: z.string().min(1).max(WORKSPACE_FILE_PATH_BYTE_LIMIT) };
const linkSchema = z.object(fields).strict();
const actionSchema = z.object({ ...fields, workspaceIdentity: z.string().min(1).max(1024), action: z.enum(["open", "reveal"]) }).strict();
const fail = (code: string): never => { throw new Error(`WORKSPACE_FILE_LINK_${code}`); };

async function linkPath(workspace: string, declaredWorkspace: string, href: string) {
  let path: string;
  try {
    if (/^file:/i.test(href)) {
      const url = new URL(href);
      if (url.hostname && url.hostname !== "localhost" || url.search) return fail("OUTSIDE");
      url.hash = "";
      path = fileURLToPath(url);
    } else {
      if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#|\?)/i.test(href)) return fail("OUTSIDE");
      path = decodeURIComponent(href.split("#")[0]!);
    }
  } catch { return fail("INVALID"); }
  path = path.replace(/:\d+(?::\d+)?$/, "");
  if (![".txt", ".md", ".markdown", ".json"].includes(extname(path).toLowerCase())) return fail("UNSUPPORTED");
  // A platform alias such as /var -> /private/var is valid only for the known root.
  let name = [workspace, resolve(declaredWorkspace)].map(root => relative(root, resolve(root, path)).split(sep).join("/"))
    .find(validWorkspaceRelativePath);
  // macOS may canonicalize /var to /private/var before saving the workspace.
  // Accept an alias of the whole authorized root; symlinks below it still fail admission.
  if (!name && isAbsolute(path)) {
    let directory = dirname(path);
    for (let depth = 0; depth < 64; depth += 1) {
      if (await realpath(directory).catch(() => null) === workspace) {
        const candidate = relative(directory, path).split(sep).join("/");
        if (validWorkspaceRelativePath(candidate)) name = candidate;
        break;
      }
      const parent = dirname(directory);
      if (parent === directory) break;
      directory = parent;
    }
  }
  if (!name) return fail("OUTSIDE");
  return name;
}

export class WorkspaceFileLinks {
  private active = 0;
  constructor(private readonly workspace: EffectiveWorkspaceResolver, private readonly reads: WorkspaceFileReadAuthority) {}

  async resolve(value: unknown, expectedIdentity?: string): Promise<WorkspaceFileLinkResult> {
    const input = linkSchema.parse(value);
    if (this.active >= 4) return fail("BUSY");
    this.active += 1;
    try {
      const effective = this.workspace(input.scope);
      if (effective.kind !== "ready" || effective.owner.kind === "default") return fail("UNAVAILABLE");
      if (expectedIdentity && effective.identity !== expectedIdentity) return fail("CHANGED");
      const root = await realpath(effective.workspace);
      const path = await linkPath(root, effective.workspace, input.href);
      const target = resolve(root, path);
      const metadata = await lstat(target).catch(() => null);
      if (!metadata) return fail("MISSING");
      if (!metadata.isFile() || metadata.isSymbolicLink() || await realpath(target) !== target) return fail("OUTSIDE");
      const readRef = await this.reads.issue({ effective, workspace: root, entry: { path, entryKind: "file" }, metadata: {
        kind: "file", dev: Number(metadata.dev), ino: Number(metadata.ino), size: metadata.size, mtimeMs: metadata.mtimeMs,
      } });
      const current = this.workspace(input.scope);
      if (current.kind !== "ready" || current.identity !== effective.identity || await realpath(current.workspace) !== root) return fail("CHANGED");
      return { path, readRef, workspaceIdentity: effective.identity };
    } finally { this.active -= 1; }
  }

  async action(value: unknown) {
    const { workspaceIdentity, action, ...input } = actionSchema.parse(value);
    const { shell } = await import("electron");
    const target = await this.resolve(input, workspaceIdentity);
    await this.reads.withPath({ scope: input.scope, readRef: target.readRef }, async path => {
      if (action === "reveal") shell.showItemInFolder(path);
      else if (await shell.openPath(path)) fail("ACTION_FAILED");
    });
  }
}
