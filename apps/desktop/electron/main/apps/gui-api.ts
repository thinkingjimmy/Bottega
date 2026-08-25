/**
 * [INPUT]: Depends on Node crypto/fs/path, shared GUI page Binds to generation-bound Base GUI binding
 * [OUTPUT]: Provides scoped GuiTokenRegistry, collectGuiPages, and redirects capability-aware BaseGuiApi to the factory and port
 * [POS]: GUI token/page scanning of the door of the apps module; HTTP contract sinks base-gui/api, owner with durable mutation to inject port
 */

import { randomBytes, timingSafeEqual } from "node:crypto";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { BaseGuiLiveBinding } from "../../../shared/apps-ipc";
import { isValidGuiPage } from "../../../shared/bases-ipc";

export {
  createBaseGuiApi,
  type GuiBasePort,
} from "./base-gui/api/router";
export { GUI_MUTATION_BODY_TIMEOUT_MS } from "./base-gui/api/mutations";

const TOKEN_TTL_MS = 2 * 60 * 60_000;
const GUI_PAGE_LIMIT = 64;
const GUI_SCAN_DEPTH = 4;

export type GuiTokenClaims = BaseGuiLiveBinding & Readonly<{ expiresAt: number }>;

// ============================================================================
// token：per-app 单实例内存态，本机扫端口的进程拿不到即读不到 Base
// ============================================================================

export class GuiTokenRegistry {
  private readonly issued = new Map<
    string,
    { value: string; claims: GuiTokenClaims }
  >();

  constructor(private readonly now: () => number = Date.now) {}

  /** 单实例语义：mint 即撤销旧值，旧 iframe 的下一次请求必然 401。 */
  mint(binding: BaseGuiLiveBinding) {
    const value = randomBytes(32).toString("base64url");
    this.issued.set(binding.appId, {
      value,
      claims: { ...binding, expiresAt: this.now() + TOKEN_TTL_MS },
    });
    return value;
  }

  verify(appId: string, candidate: string) {
    const current = this.issued.get(appId);
    if (!current) return null;
    if (current.claims.expiresAt <= this.now()) {
      this.issued.delete(appId);
      return null;
    }
    return constantTimeEquals(current.value, candidate)
      ? structuredClone(current.claims)
      : null;
  }

  revoke(appId: string) {
    this.issued.delete(appId);
  }
}

function constantTimeEquals(left: string, right: string) {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

// ============================================================================
// gui/ 目录扫描：保留前缀永不可达；dirent 不跟随符号链接
// ============================================================================

export async function collectGuiPages(root: string) {
  const pages: string[] = [];
  const walk = async (directory: string, prefix: string, depth: number) => {
    if (depth > GUI_SCAN_DEPTH || pages.length >= GUI_PAGE_LIMIT) return;
    const entries = await readdir(directory, { withFileTypes: true }).catch(
      () => []
    );
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (pages.length >= GUI_PAGE_LIMIT) return;
      if (!prefix && ["_api", "_sdk"].includes(entry.name.toLowerCase())) continue;
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (!isValidGuiPage(relative)) continue;
      if (entry.isDirectory()) {
        await walk(join(directory, entry.name), relative, depth + 1);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".html")) {
        pages.push(relative);
      }
    }
  };
  await walk(root, "", 0);
  return pages;
}
