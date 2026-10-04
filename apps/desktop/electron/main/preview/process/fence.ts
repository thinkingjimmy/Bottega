/**
 * [INPUT]: Main-owned turn filesystem facts, permission mode and a minimal environment allowlist.
 * [OUTPUT]: FrozenPreviewFence and freezePreviewFence; no renderer or tool may widen these facts.
 * [POS]: Preview process authorization snapshot, retained independently of the finished Agent turn.
 */
import type { AgentPermissionMode, TurnFilesystemAccess } from "../../../../shared/ipc/agent/agent-ipc";
export type FrozenPreviewFence = Readonly<{
  workspace: string; readOnlyRoots: readonly string[]; controlRoot: string;
  permissionMode: AgentPermissionMode; env: Readonly<Record<string, string>>;
  authorityIdentity?: string;
}>;
export function freezePreviewFence(access: (TurnFilesystemAccess & { controlRoot: string }) | undefined,
  permissionMode: AgentPermissionMode, plan: boolean): FrozenPreviewFence | undefined {
  if (!access || plan || access.mode === "read-only" || access.network === "off") return undefined;
  const env: Record<string, string> = {};
  for (const key of ["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL", "TZ"]) if (process.env[key]) env[key] = process.env[key]!;
  return Object.freeze({ workspace: access.workspace, readOnlyRoots: Object.freeze([...access.readOnlyRoots]),
    controlRoot: access.controlRoot, permissionMode, env: Object.freeze(env) });
}
