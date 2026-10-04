/**
 * [INPUT]: Depends on verified folder transcript boundaries and private durable files.
 * [OUTPUT]: Retains per-incarnation recovery candidates and hashes of actual sent prompt blocks without persisting injected plaintext.
 * [POS]: Rebuild-derived session candidate registry; completion never becomes portable execution authority.
 */
import { readFile, rename, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { durableReplaceFile, isErrnoCode } from "../../persistence/durable-json";
import { libraryObjectId } from "../paths";
import { nativeSessionHintSchema, sessionBoundarySchema, sessionBoundary, sessionTextHash, type NativeSessionHint } from "./boundary";
const schema = z.object({ version: z.literal(1), incarnationId: z.string().min(1).max(128), pending: z.boolean(),
  headSeq: z.number().int().nonnegative(), messageId: z.string().nullable(), boundary: sessionBoundarySchema,
  hints: z.array(nativeSessionHintSchema).max(4), sent: z.object({ sessionId: z.string(), backend: nativeSessionHintSchema.shape.backend, userMessageId: z.string(), userTurns: z.number().int().positive(), userHashes: z.array(z.string()).min(1).max(2) }).optional() }).strict();
export class RestoredSessionStore {
  private readonly directory: string;
  constructor(userData: string) { this.directory = join(userData, "library-sessions"); }
  private path(chatId: string) { return join(this.directory, libraryObjectId(chatId) + ".json"); }
  async read(chatId: string) {
    const path = this.path(chatId); let bytes: string;
    try { bytes = await readFile(path, "utf8"); }
    catch (error) { if (isErrnoCode(error, "ENOENT")) return null; throw error; }
    try { if (Buffer.byteLength(bytes) > 32 * 1024) throw new Error("SESSION_HINT_TOO_LARGE"); return schema.parse(JSON.parse(bytes)); }
    catch {
      await rename(path, `${path}.quarantine-${Date.now()}`);
      const files = (await readdir(this.directory)).filter(name => name.startsWith(chatId + ".json.quarantine-")).sort().reverse();
      for (const file of files.slice(3)) await rm(join(this.directory, file));
      return null;
    }
  }
  async pending(chatId: string, incarnationId: string) { const saved = await this.read(chatId); return Boolean(saved?.pending && saved.incarnationId === incarnationId); }
  async remember(input: { id: string; incarnationId: string; headSeq: number; messageId: string | null;
    boundary: z.infer<typeof sessionBoundarySchema>; hints: NativeSessionHint[] }) {
    const saved = await this.read(input.id);
    if (saved?.incarnationId === input.incarnationId && saved.headSeq >= input.headSeq) return;
    const { id, ...value } = input;
    await durableReplaceFile(this.path(id), JSON.stringify(schema.parse({ ...value, version: 1, pending: true })) + "\n");
  }
  async recordPrompt(input: { chatId: string; incarnationId: string; userMessageId: string; backend: NativeSessionHint["backend"]; sessionId: string; texts: string[] }) {
    const previous = await this.read(input.chatId), saved = previous?.incarnationId === input.incarnationId ? previous : null;
    const prior = saved?.sent?.sessionId === input.sessionId ? saved.sent : null;
    const hints = saved?.hints.find(hint => hint.sessionId === input.sessionId && hint.backend === input.backend);
    const userTurns = prior?.userMessageId === input.userMessageId ? prior.userTurns : (prior?.userTurns ?? hints?.sentBoundary?.userTurns ?? 0) + 1;
    const sent = { sessionId: input.sessionId, backend: input.backend, userMessageId: input.userMessageId, userTurns,
      userHashes: [...new Set([input.texts.join(""), input.texts.join("\n\n")].map(sessionTextHash))] };
    const value = schema.parse({ ...(saved ?? { version: 1, incarnationId: input.incarnationId, pending: false, headSeq: 0, messageId: null,
      boundary: sessionBoundary([]), hints: [] }), sent });
    await durableReplaceFile(this.path(input.chatId), JSON.stringify(value) + "\n");
  }
  async complete(chatId: string, incarnationId: string) {
    const saved = await this.read(chatId); if (!saved || saved.incarnationId !== incarnationId) return;
    await durableReplaceFile(this.path(chatId), JSON.stringify({ ...saved, pending: false }) + "\n");
  }
}
