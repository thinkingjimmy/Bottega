/**
 * [INPUT]: Account-fenced confirmed cloud Chat heads and authenticated transcript pages.
 * [OUTPUT]: Remote authorization, authenticated recovery references and bounded canonical lookup without caller descriptors.
 * [POS]: Mirror-to-local artifact boundary; downloaded snapshots use the same custody and gateway as native turns.
 */
import { readArtifactFences, type ArtifactFence } from "@ai-chat/cloud-protocol/turns/text/artifact-reference";
import type { ArtifactRef } from "../../../../shared/ipc/apps/artifact-ipc";
import type { CloudChatReader } from "../../cloud/chat/reader";
export class RemoteArtifacts {
  private readonly recovered = new Map<string, { scope: string; fence: ArtifactFence }>();
  rememberRecovery(ref: ArtifactRef, fence: ArtifactFence) {
    this.assert(ref);
    if (fence.id !== ref.artifactId || !fence.sha256 || fence.rejected) throw new Error("artifact-recovery-identity");
    this.recovered.set(JSON.stringify(ref), { scope: this.scope(), fence });
    if (this.recovered.size > 128) this.recovered.delete(this.recovered.keys().next().value!);
  }
  private readonly admitted = new Map<string, string>();
  constructor(private readonly reader: CloudChatReader, private readonly scope: () => string) {}
  key() { return this.scope(); }
  assert(ref: ArtifactRef) {
    if (this.admitted.get(JSON.stringify([ref.chatId, ref.incarnationId])) !== this.scope()) throw new Error("artifact-remote-scope-changed");
  }
  async validate(ref: ArtifactRef) {
    const key = this.scope(), head = await this.reader.head(ref.chatId);
    if (this.scope() !== key || !head || head.chat.incarnationId !== ref.incarnationId) throw new Error("artifact-stale-chat");
    this.admitted.set(JSON.stringify([ref.chatId, ref.incarnationId]), key);
    if (this.admitted.size > 128) this.admitted.delete(this.admitted.keys().next().value!);
    return head;
  }
  async resolve(ref: ArtifactRef): Promise<{ fence: ArtifactFence; messageId: string } | null> {
    const head = await this.validate(ref);
    let beforeSeq: number | null = null;
    for (let count = 0; count < 200; count++) {
      const page = await this.reader.transcript({ chatId: ref.chatId, segment: "native", revision: head.bodyRevision, generationId: null, beforeSeq, limit: 50 });
      this.assert(ref);
      for (const body of page.messages) {
        const texts = [body.message.content];
        if (body.message.role === "assistant") for (const part of body.message.parts ?? []) if (part.type === "text") texts.push(part.text);
        for (const agent of Object.values(body.subagents ?? {})) for (const part of agent.parts) if (part.type === "text") texts.push(part.text);
        const fence = texts.flatMap(readArtifactFences).find(fence => fence.id === ref.artifactId);
        if (fence?.sha256) return { fence, messageId: body.message.id };
        const recovered = this.recovered.get(JSON.stringify(ref));
        if (fence?.rejected && recovered?.scope === this.scope()) return { fence: recovered.fence, messageId: body.message.id };
      }
      if (page.complete || page.cursor === null || page.cursor === beforeSeq) return null;
      beforeSeq = page.cursor;
    }
    throw new Error("artifact-history-budget");
  }
}
