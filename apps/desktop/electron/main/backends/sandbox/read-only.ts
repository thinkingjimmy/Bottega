/**
 * [INPUT]: Depends on sbpl.ts canonical path and overlap semantics
 * [OUTPUT]: Provides ReadOnlyWorkspaceError and assertReadOnlyWorkspace, the binding admission for a read-only interactive turn
 * [POS]: Shared by seatbelt.ts (Codex, Kimi, OpenCode) and the Claude native-sandbox settings; a read-only workspace is only honest when no write root the fence must keep overlaps it
 */
import { canonicalPath, overlaps } from "./sbpl";

export type ReadOnlyWorkspaceRefusal = "workspace-in-write-root" | "write-root-in-workspace" | "full-access";

/** Typed so a binding can tell "this role cannot be enforced here" from a crash; nothing is spawned when it is thrown. */
export class ReadOnlyWorkspaceError extends Error {
  readonly code = "read-only-workspace-not-enforceable";
  constructor(readonly reason: ReadOnlyWorkspaceRefusal, readonly workspace: string, readonly root?: string) {
    super(`read-only workspace cannot be enforced (${reason}): ${workspace}${root ? ` overlaps write root ${root}` : ""}`);
    this.name = "ReadOnlyWorkspaceError";
  }
}

/**
 * The fence keeps some roots writable whatever the workspace mode is (TMPDIR, the Provider's own state root, an artifact
 * directory). If one of them contains the workspace, or sits inside it, the workspace is writable through that root.
 */
export function assertReadOnlyWorkspace(workspace: string, writeRoots: readonly string[]) {
  const target = canonicalPath(workspace, "workspace");
  for (const root of writeRoots) {
    const canonical = canonicalPath(root, "write root");
    if (!overlaps(target, canonical)) continue;
    throw new ReadOnlyWorkspaceError(target.startsWith(`${canonical}/`) || target === canonical ? "workspace-in-write-root" : "write-root-in-workspace",
      target, canonical);
  }
}
