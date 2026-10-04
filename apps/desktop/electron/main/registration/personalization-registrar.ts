/**
 * [INPUT]: Depends on Electron shell, renderer IPC, Node guarded fs/crypto/path, the provider catalog's instructions facts and the descriptor path resolver (launch HOME), durableReplaceFile, SerialQueue and shared Personalization agreement
 * [OUTPUT]: Provides PersonalizationService, which directs target analysis and register Personalization; Four read→CAS→durable write shared a queue and retained a symlink/mode, reveal only receives the backend itself and then deals it to the system file manager; personalizationHandlers answer a malformed or unknown Provider id with a ProviderIpcRefusal before any path
 * [POS]: apps/desktop/electron/main/registration; The main global Agent instructIOn file is the only IO boundary; renderer only see ~ shorten paths, soft links, other authentic items), content, digest and stable error codes
 */

import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, relative } from "node:path";
import { shell } from "electron";
import { AGENT_BACKEND_ORDER, type AgentBackendId } from "../../../shared/ipc/agent/agent-ipc";
import {
  PERSONALIZATION_BYTE_LIMIT,
  PERSONALIZATION_CHANNEL,
  saveInstructionsInputSchema,
  type AgentInstructionsErrorCode,
  type AgentInstructionsFile,
  type SaveInstructionsInput,
  type SaveInstructionsResult,
} from "../../../shared/ipc/settings/personalization-ipc";
import { rendererIpc } from "./ipc-registrar";
import { durableReplaceFile } from "../persistence/durable-json";
import { SerialQueue } from "../persistence/serial-queue";
import { builtinProviderCatalog, knownBackend, withProviderTarget, type ProviderCatalog } from "../../../shared/providers/catalog";
import { providerCatalog } from "../providers/host/catalog";
import { resolveHomePath, resolveLaunchHome } from "../../../shared/providers/home-path";

type Target = { backend: AgentBackendId; path: string };
type ReadResult = AgentInstructionsFile & { writePath: string; mode: number };

const digest = (content: string) =>
  createHash("sha256").update(content).digest("hex");
const oversizedDigest = (size: number, mtimeMs: number) =>
  digest(`oversized:${size}:${mtimeMs}`);

/** Each provider's user instructions file, as its descriptor declares it, resolved against the HOME its CLI runs with. */
export function resolveInstructionTargets(
  env: NodeJS.ProcessEnv = process.env,
  platformHome = homedir()
): Record<AgentBackendId, Target> {
  const userHome = resolveLaunchHome(env, platformHome);
  return Object.fromEntries(builtinProviderCatalog.entries().flatMap(({ id, descriptor }) => {
    const backend = knownBackend(builtinProviderCatalog, id);
    return backend && descriptor.instructions
      ? [[backend, { backend, path: join(resolveHomePath(descriptor.instructions.directory, env, userHome), descriptor.instructions.file) }]]
      : [];
  })) as Record<AgentBackendId, Target>;
}

export class PersonalizationService {
  private readonly queue = new SerialQueue();
  private readonly targets: Record<AgentBackendId, Target>;

  constructor(
    env: NodeJS.ProcessEnv = process.env,
    private readonly userHome = homedir()
  ) {
    this.targets = resolveInstructionTargets(env, userHome);
  }

  list(): Promise<AgentInstructionsFile[]> {
    return Promise.all(AGENT_BACKEND_ORDER.map((backend) => this.readPublic(backend)));
  }

  save(raw: unknown): Promise<SaveInstructionsResult> {
    const parsed = saveInstructionsInputSchema.safeParse(raw);
    if (!parsed.success) {
      /* 唯一合法的业务性校验失败是 content 超限；其余形状错误是调用方
         程序缺陷，折成 too-large 会误导排障，直接上抛。 */
      const tooLarge = parsed.error.issues.some(
        (issue) => issue.message === "too-large"
      );
      if (tooLarge) {
        return Promise.resolve({ status: "error", code: "too-large" });
      }
      return Promise.reject(new Error("个性化保存载荷不合法"));
    }
    return this.queue.enqueue(() => this.saveSerial(parsed.data));
  }

  private async saveSerial(input: SaveInstructionsInput): Promise<SaveInstructionsResult> {
    const current = await this.read(input.backend);
    if (current.error === "symlink-unresolvable") {
      return { status: "error", code: current.error };
    }
    if (current.error && current.error !== "oversized-file") {
      return { status: "error", code: current.error };
    }
    if (current.digest !== input.expectedDigest) {
      return {
        status: "conflict",
        current: current.oversized
          ? { oversized: true, content: null, digest: current.digest! }
          : { oversized: false, content: current.content ?? "", digest: current.digest },
      };
    }
    if (current.oversized) {
      return { status: "error", code: "oversized-file" };
    }
    try {
      await durableReplaceFile(current.writePath, input.content, current.mode);
      return { status: "ok", file: await this.readPublic(input.backend) };
    } catch (cause) {
      console.error("[personalization] write failed", input.backend, cause);
      return { status: "error", code: "write-failed" };
    }
  }

  private async readPublic(backend: AgentBackendId): Promise<AgentInstructionsFile> {
    const { writePath: _writePath, mode: _mode, ...file } = await this.read(backend);
    return file;
  }

  private async read(backend: AgentBackendId): Promise<ReadResult> {
    const target = this.targets[backend];
    let info;
    try {
      info = await lstat(target.path);
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "ENOENT") {
        return this.empty(target);
      }
      return this.failed(target, "read-failed");
    }

    let writePath = target.path;
    if (info.isSymbolicLink()) {
      try {
        writePath = await realpath(target.path);
        info = await stat(writePath);
      } catch (cause) {
        console.error("[personalization] symlink resolve failed", backend, cause);
        return this.failed(target, "symlink-unresolvable");
      }
    }
    const displayPath = compactPath(target.path, this.userHome);
    const linkTarget = target.path === writePath
      ? undefined
      : compactPath(writePath, this.userHome);
    if (!info.isFile()) return this.failed(target, "read-failed", displayPath, writePath);
    const mode = info.mode & 0o777;
    if (info.size > PERSONALIZATION_BYTE_LIMIT) {
      return {
        backend, displayPath, linkTarget, exists: true, oversized: true, size: info.size,
        content: null, digest: oversizedDigest(info.size, info.mtimeMs),
        error: "oversized-file", writePath, mode,
      };
    }
    try {
      const handle = await open(
        writePath,
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
      );
      try {
        if (!(await handle.stat()).isFile()) throw new Error("not a regular file");
        const buffer = Buffer.alloc(PERSONALIZATION_BYTE_LIMIT + 1);
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
        if (bytesRead > PERSONALIZATION_BYTE_LIMIT) {
          return {
            backend, displayPath, linkTarget, exists: true, oversized: true, size: bytesRead,
            content: null, digest: oversizedDigest(bytesRead, info.mtimeMs),
            error: "oversized-file", writePath, mode,
          };
        }
        const content = buffer.subarray(0, bytesRead).toString("utf8");
        return {
          backend, displayPath, linkTarget, exists: true, oversized: false, content,
          digest: digest(content), writePath, mode,
        };
      } finally {
        await handle.close();
      }
    } catch (cause) {
      console.error("[personalization] guarded read failed", backend, cause);
      return this.failed(target, "read-failed", displayPath, writePath, mode, linkTarget);
    }
  }

  private empty(target: Target): ReadResult {
    return {
      backend: target.backend, displayPath: compactPath(target.path, this.userHome),
      exists: false, oversized: false, content: "", digest: null,
      writePath: target.path, mode: 0o644,
    };
  }

  private failed(
    target: Target,
    error: Extract<AgentInstructionsErrorCode, "oversized-file" | "symlink-unresolvable" | "read-failed">,
    displayPath = compactPath(target.path, this.userHome),
    writePath = target.path,
    mode = 0o644,
    linkTarget?: string
  ): ReadResult {
    return {
      backend: target.backend, displayPath, linkTarget, exists: true, oversized: false,
      content: null, digest: null, error, writePath, mode,
    };
  }

  /* ============================================================
   * 在文件管理器里定位。renderer 只递 backend，真身在这边解析——
   * 绝对路径不穿 preload 这条约束在这里没有例外：一旦为了「点一下打开」
   * 把路径递出去，renderer 就成了路径的授权方。
   *
   * 文件不存在时静默返回而不是退而求其次去开父目录：父目录本身也可能
   * 整个不存在（opencode config 根），而「点了打开一个不是我要找的地方」
   * 比「按钮是灰的」更糟。按钮由 exists 决定灰不灰，这里只兜住竞态。
   * ============================================================ */
  async reveal(backend: AgentBackendId): Promise<void> {
    const target = this.targets[backend];
    let path = target.path;
    try {
      const info = await lstat(path);
      if (info.isSymbolicLink()) path = await realpath(path);
    } catch {
      return;
    }
    shell.showItemInFolder(path);
  }
}

const compactPath = (path: string, home: string) => {
  const rest = relative(home, path);
  return rest && !rest.startsWith("..") && !isAbsolute(rest)
    ? `~/${rest}`
    : path;
};

/** The two id-taking channels (TASK-11 S3-c): a malformed or unknown Provider id answers its refusal before any path is resolved. */
export function personalizationHandlers(service: Pick<PersonalizationService, "save" | "reveal">, catalog: () => ProviderCatalog) {
  return {
    save: (input: unknown) => withProviderTarget(input && typeof input === "object" && !Array.isArray(input) ? (input as { backend?: unknown }).backend : undefined,
      catalog(), () => service.save(input)),
    reveal: (backend: unknown) => withProviderTarget(backend, catalog(), id => service.reveal(id)),
  };
}

export function registerPersonalization(
  rendererUrl: string,
  service = new PersonalizationService(),
  catalog: () => ProviderCatalog = () => providerCatalog().catalog()
) {
  const handlers = personalizationHandlers(service, catalog);
  rendererIpc(rendererUrl, "拒绝非主窗口的个性化请求")
    .roles("main")
    .handle(PERSONALIZATION_CHANNEL.list, () => service.list())
    .handle(PERSONALIZATION_CHANNEL.save, handlers.save)
    .handle(PERSONALIZATION_CHANNEL.reveal, handlers.reveal);
}
