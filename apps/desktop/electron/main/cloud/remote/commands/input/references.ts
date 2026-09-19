/**
 * [INPUT]: Existing native workspace catalog/resolver, fresh filesystem membership proofs and local Library Skill resolution.
 * [OUTPUT]: Relative-path search, bounded text preview and verified native rich-input references for remote commands.
 * [POS]: Target-only reference library; each async boundary retains the original authority and root digest.
 */
import { lstat, realpath } from "node:fs/promises";
import { hashChatContent } from "@ai-chat/cloud-protocol/chats/transcript/body";
import { assertRemoteReferenceTarget, type RemoteReference, type RemoteFileReference, type RemoteWorkspaceResult } from "@ai-chat/cloud-protocol/remote/input/references";
import type { WorkspaceFileCatalog } from "../../../../workspace-files";
import { proveWorkspaceEntry } from "../../../../workspace-file-index";
import type { EffectiveWorkspaceResolver } from "../../../../workspace-resolver";
import type { ManagedSkillsLibraryStore } from "../../../../skills-management/library-store";
import type { SkillsCatalog } from "../../../../skills-catalog";
import type { CanonicalRichInputNode } from "../../../../../../shared/rich-input-projection";
import type { AgentWorkspaceScope } from "../../../../../../shared/agent-ipc";
import type { AgentBackendId } from "../../../../../../shared/agent-ipc";
export type RemoteWorkspacePorts = { files: Pick<WorkspaceFileCatalog, "search" | "resign" | "read">; resolve: EffectiveWorkspaceResolver;
  library: Pick<ManagedSkillsLibraryStore, "entry">; skills: Pick<SkillsCatalog, "resolveSkill"> };
const KNOWN_READ_REASONS = new Set(["workspace-changed", "reference-target-changed", "workspace-file-unavailable"]);
export class RemoteWorkspaceService {
  constructor(private readonly deviceId: string, private readonly ports: RemoteWorkspacePorts) {}
  private async scopedWorkspace(scope: AgentWorkspaceScope, current: () => void) {
    current(); const effective = this.ports.resolve(scope);
    if (effective.kind !== "ready") throw new Error("workspace-file-unavailable");
    const root = await realpath(effective.workspace); current(); const stat = await lstat(root); current();
    const digest = hashChatContent([this.deviceId, root, stat.dev, stat.ino, effective.authorityIdentity]);
    return { scope, effective, root, digest };
  }
  private workspace(chatId: string, current: () => void) { return this.scopedWorkspace({ kind: "conversation", conversationId: chatId }, current); }
  async project(projectId: string, query: string, current: () => void): Promise<RemoteWorkspaceResult> {
    const scope = { kind: "project" as const, projectId }, before = await this.scopedWorkspace(scope, current);
    const result = await this.ports.files.search({ scope, query }); current();
    if (result.kind !== "ready" || (await this.scopedWorkspace(scope, current)).digest !== before.digest) throw new Error("workspace-file-unavailable");
    const entries = []; let bytes = 0;
    for (const entry of result.entries) {
      bytes += Buffer.byteLength(entry.path, "utf8"); if (bytes > 48_000) break;
      entries.push({ path: entry.path, entryKind: entry.entryKind ?? "file" });
    }
    return { kind: "workspace-files", deviceId: this.deviceId, workspaceDigest: before.digest, entries,
      truncated: result.indexTruncated || entries.length < result.entries.length || entries.length === 50 };
  }
  async list(chatId: string, query: string, current: () => void): Promise<RemoteWorkspaceResult> {
    const before = await this.workspace(chatId, current), result = await this.ports.files.search({ scope: before.scope, query, chatId }); current();
    if (result.kind !== "ready") throw new Error("workspace-file-unavailable");
    if ((await this.workspace(chatId, current)).digest !== before.digest) throw new Error("workspace-changed");
    return { kind: "workspace-files", deviceId: this.deviceId, workspaceDigest: before.digest,
      entries: result.entries.map(entry => ({ path: entry.path, entryKind: entry.entryKind ?? "file" })), truncated: result.indexTruncated || result.entries.length === 50 };
  }
  private async file(chatId: string, reference: RemoteFileReference, current: () => void) {
    assertRemoteReferenceTarget([reference], this.deviceId);
    const value = await this.workspace(chatId, current);
    if (reference.workspaceDigest !== value.digest) throw new Error("workspace-changed");
    const proof = await proveWorkspaceEntry(value.root, { path: reference.path, entryKind: reference.entryKind }); current();
    if (!proof) throw new Error("workspace-file-unavailable");
    if ((await this.workspace(chatId, current)).digest !== value.digest) throw new Error("workspace-changed");
    return { ...value, proof };
  }
  async read(chatId: string, reference: RemoteFileReference, current: () => void): Promise<RemoteWorkspaceResult> {
    const value = await this.file(chatId, reference, current);
    if (reference.entryKind !== "file" || value.proof.size > 1024 * 1024) throw new Error("workspace-text-unavailable");
    try {
      const grant = await this.ports.files.resign({ scope: value.scope, path: reference.path, entryKind: "file" }); current();
      const result = await this.ports.files.read({ scope: value.scope, readRef: grant.readRef }); current();
      if (result.kind !== "text" || Buffer.byteLength(result.content, "utf8") > 1024 * 1024) throw new Error("workspace-text-unavailable");
      await this.file(chatId, reference, current);
      return { kind: "workspace-text", reference, content: result.content };
    } catch (cause) { current();
      // A moved workspace or a retargeted reference is actionable on the phone; only unknown failures collapse.
      if (cause instanceof Error && KNOWN_READ_REASONS.has(cause.message)) throw cause;
      throw new Error("workspace-text-unavailable"); }
  }
  async references(chatId: string, references: readonly RemoteReference[], backend: AgentBackendId, planMode: boolean, current: () => void) {
    const nodes: CanonicalRichInputNode[] = [];
    assertRemoteReferenceTarget(references, this.deviceId);
    for (const [index, reference] of references.entries()) {
      if (reference.kind === "file") {
        await this.file(chatId, reference, current);
        nodes.push({ id: `remote-reference-${index}`, type: "workspace-file", path: reference.path, entryKind: reference.entryKind });
      } else {
        const entry = this.ports.library.entry(reference.libraryId);
        if (!entry?.enabled || !entry.activeGenerationId) throw new Error("skill-unavailable");
        const workspace = await this.workspace(chatId, current), ref = `library:${reference.libraryId}`;
        try { await this.ports.skills.resolveSkill(ref, workspace.root, { backend, planMode }, workspace.effective.projectContext); current(); }
        catch { current(); throw new Error("skill-unavailable"); }
        nodes.push({ id: `remote-reference-${index}`, type: "skill", ref, name: entry.name, label: entry.displayName });
      }
    }
    return nodes;
  }
  async revalidate(chatId: string, references: readonly RemoteReference[], current: () => void) {
    assertRemoteReferenceTarget(references, this.deviceId);
    for (const reference of references) {
      if (reference.kind === "file") await this.file(chatId, reference, current);
      else {
        const entry = this.ports.library.entry(reference.libraryId);
        if (!entry?.enabled || !entry.activeGenerationId) throw new Error("skill-unavailable");
      }
      current();
    }
  }
}
