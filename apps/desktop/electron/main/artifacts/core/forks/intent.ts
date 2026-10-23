/**
 * [INPUT]: Main-frozen source/child incarnations and the exact retained Artifact identities.
 * [OUTPUT]: Durable Fork retention intents that pin source custody until child retention completes.
 * [POS]: Artifact Fork recovery journal; missing source metadata never means successful retention.
 */
import { z } from "zod";
import { join } from "node:path";
import { DurableJson } from "../../../persistence/durable-json";
const intent = z.object({ sourceChatId: z.string(), sourceIncarnationId: z.string(), childChatId: z.string(), childIncarnationId: z.string(),
  artifactIds: z.array(z.string()).max(10000), complete: z.boolean() }).strict();
const schema = z.object({ intents: z.array(intent) }).strict();
export class ArtifactForkIntents {
  private readonly file: DurableJson<z.infer<typeof schema>>;
  constructor(root: string) { this.file = new DurableJson(join(root, "fork-intents.json"), schema, () => ({ intents: [] })); }
  initialize() { return this.file.initialize(); }
  read(childChatId: string) { return this.file.read(value => value.intents.find(row => row.childChatId === childChatId)); }
  prepare(value: z.infer<typeof intent>) {
    return this.file.mutate(state => {
      const current = state.intents.find(row => row.childChatId === value.childChatId);
      if (current && JSON.stringify({ ...current, complete: false }) !== JSON.stringify({ ...value, complete: false })) throw new Error("artifact-fork-intent-conflict");
      if (!current) state.intents.push(value);
    });
  }
  cancel(childChatId: string, childIncarnationId: string) { return this.file.mutate(state => { state.intents = state.intents.filter(row => row.childChatId !== childChatId || row.childIncarnationId !== childIncarnationId || row.complete); }); }
  complete(childChatId: string) { return this.file.mutate(state => { const current = state.intents.find(row => row.childChatId === childChatId); if (current) current.complete = true; }); }
  held(chatId: string, incarnationId: string) { return this.file.read(value => value.intents.some(row => !row.complete && row.sourceChatId === chatId && row.sourceIncarnationId === incarnationId)); }
  close() { return this.file.closeAndFlush(); }
}
