/**
 * [INPUT]: Depends on Node fs/crypto/path and zod; The main-private-only absolute Skill path is disabled
 * [OUTPUT]: Provides CodexSkillsRuleStore, stable config digest and freeze synchronized with createTurn `skills.config` Rules
 * [POS]: The only durable source of truth that is discontinued within Codex products; Not read and write user config.toml, not carrying native global enabled status
 */

import { createHash } from "node:crypto";
import { chmod, mkdir, open, readFile, rename, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { z } from "zod";

const SCHEMA_VERSION = 1;
const MAX_FILE_BYTES = 256 * 1024;
const fileSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  revision: z.number().int().nonnegative(),
  disabledPaths: z.array(z.string()).max(2_048),
}).strict();

type RuleFile = z.infer<typeof fileSchema>;
export type CodexSkillConfigRule = Readonly<{ path: string; enabled: false }>;

const EMPTY: RuleFile = { schemaVersion: SCHEMA_VERSION, revision: 0, disabledPaths: [] };
const bytes = (value: string) => Buffer.byteLength(value, "utf8");

export class CodexSkillsRuleStore {
  readonly filePath: string;
  private state: RuleFile = structuredClone(EMPTY);
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly userData: string) {
    this.filePath = join(userData, "codex-skills.json");
  }

  async initialize() {
    try {
      const raw = await readFile(this.filePath, "utf8");
      if (bytes(raw) > MAX_FILE_BYTES) throw new Error("配置文件超过总字节预算");
      this.state = fileSchema.parse(JSON.parse(raw));
      this.assertPaths(this.state.disabledPaths);
      await chmod(this.filePath, 0o600);
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== "ENOENT") {
        throw new Error("codex-skills.json 损坏或不受支持", { cause });
      }
      await this.persist(this.state);
    }
  }

  digest(): `sha256:${string}` {
    const canonical = JSON.stringify([...this.state.disabledPaths].sort());
    return `sha256:${createHash("sha256").update(canonical).digest("hex")}`;
  }

  isEnabled(path: string) {
    return !this.state.disabledPaths.includes(path);
  }

  rules(): readonly CodexSkillConfigRule[] {
    return this.state.disabledPaths.map((path) => ({ path, enabled: false }));
  }

  setEnabled(path: string, enabled: boolean) {
    return this.mutate(async () => {
      this.assertPaths([path]);
      const disabled = new Set(this.state.disabledPaths);
      if (enabled) disabled.delete(path);
      else disabled.add(path);
      const nextPaths = [...disabled].sort();
      if (nextPaths.join("\0") === this.state.disabledPaths.join("\0")) return;
      const next: RuleFile = {
        schemaVersion: SCHEMA_VERSION,
        revision: this.state.revision + 1,
        disabledPaths: nextPaths,
      };
      await this.persist(next);
      this.state = next;
    });
  }

  closeAndFlush() {
    return this.queue;
  }

  private mutate(operation: () => Promise<void>) {
    const result = this.queue.then(operation);
    this.queue = result.catch(() => undefined);
    return result;
  }

  private assertPaths(paths: readonly string[]) {
    for (const path of paths) {
      if (!isAbsolute(path) || !path.endsWith("/SKILL.md") || bytes(path) > 8 * 1024) {
        throw new Error("Codex Skill path 无效");
      }
    }
    if (new Set(paths).size !== paths.length) throw new Error("Codex Skill path 重复");
  }

  private async persist(state: RuleFile) {
    await mkdir(this.userData, { recursive: true });
    const serialized = `${JSON.stringify(state, null, 2)}\n`;
    if (bytes(serialized) > MAX_FILE_BYTES) throw new Error("Codex Skill 配置超过总字节预算");
    const temporary = `${this.filePath}.tmp`;
    await writeFile(temporary, serialized, { mode: 0o600 });
    const file = await open(temporary, "r");
    await file.sync();
    await file.close();
    await rename(temporary, this.filePath);
    await chmod(this.filePath, 0o600);
    const directory = await open(this.userData, "r");
    await directory.sync();
    await directory.close();
  }
}
