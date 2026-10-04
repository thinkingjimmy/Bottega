/**
 * [INPUT]: Depends on Node Ed25519 verification, a synchronous bundled toolchain-manifest read, bounded HTTPS fetch, and the shared strict App GUI support-matrix schema
 * [OUTPUT]: Provides readFormalReleaseTrust, exact-byte detached-signature verification, and GitHub release-asset loading for candidate compatibility preflight
 * [POS]: Update supply-chain boundary; trust is read once at assembly so an unprovisioned build omits the preflight entirely instead of failing every download, and UpdateService still never parses unsigned candidate policy
 */

import { createPublicKey, verify } from "node:crypto";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  appGuiCompatibilitySupportSchema,
  type AppGuiCompatibilitySupport,
} from "../../../shared/app-gui/support";

const MATRIX_BYTES_LIMIT = 64 * 1024;
const SIGNATURE_BYTES = 64;
const RELEASE_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const MATRIX_ASSET = "app-gui-compatibility-support.json";
const TOOLCHAIN_DIRECTORY = "app-gui-toolchain";
const TRUST_SCHEMA = "bottega.formal-release-trust/v1";
const RELEASE_KEY_ASSET = "release-public-key.pem";

export type CandidateCompatibilityLoader = (
  version: string
) => Promise<AppGuiCompatibilitySupport>;

export type FormalReleaseTrust = "provisioned" | "unprovisioned";

/* ============================================================
 * 正式发布信任是构建期事实，不是运行期问题。
 *
 * 随包清单说自己没配密钥，或那把 Ed25519 公钥根本不在包里，就没有
 * 任何签名可验——此时候选兼容性预检不是「会失败」，是「无从谈起」。
 * 把这个判断留到点击时刻，只会让每一次下载都死在同一处
 * GUI_COMPATIBILITY_RELEASE_KEY_UNAVAILABLE 上。
 *
 * 缺失与畸形一律读作 unprovisioned：信任必须被证明，不能被假设。
 * 只有 ENOENT 之外的读盘故障才抛——那是磁盘在说话，不是信任缺席。
 * ============================================================ */
export function readFormalReleaseTrust(resourcesPath: string): FormalReleaseTrust {
  const toolchain = join(resourcesPath, TOOLCHAIN_DIRECTORY);
  const manifest = readOptionalText(join(toolchain, "toolchain-manifest.json"));
  if (!manifest || !declaresProvisionedTrust(manifest)) return "unprovisioned";
  const pem = readOptionalText(join(toolchain, RELEASE_KEY_ASSET));
  return pem && isEd25519PublicKey(pem) ? "provisioned" : "unprovisioned";
}

function readOptionalText(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw cause;
  }
}

/* 只认字面量：schema 对得上、status 恰好是 provisioned 才算数。
   第三种 status 与畸形 JSON 走同一条出口，故这里没有第三个分支。 */
function declaresProvisionedTrust(source: string): boolean {
  try {
    const { formalReleaseTrust } = JSON.parse(source) as {
      formalReleaseTrust?: { schema?: unknown; status?: unknown };
    };
    return (
      formalReleaseTrust?.schema === TRUST_SCHEMA &&
      formalReleaseTrust.status === "provisioned"
    );
  } catch {
    return false;
  }
}

function isEd25519PublicKey(pem: string): boolean {
  try {
    return createPublicKey(pem).asymmetricKeyType === "ed25519";
  } catch {
    return false;
  }
}

export async function verifyCandidateCompatibility(input: Readonly<{
  matrixBytes: Uint8Array;
  signatureBytes: Uint8Array;
  publicKeyPem: string | Buffer;
}>): Promise<AppGuiCompatibilitySupport> {
  if (input.matrixBytes.byteLength > MATRIX_BYTES_LIMIT) {
    throw new Error("GUI_COMPATIBILITY_MATRIX_TOO_LARGE");
  }
  if (input.signatureBytes.byteLength !== SIGNATURE_BYTES) {
    throw new Error("GUI_COMPATIBILITY_SIGNATURE_INVALID");
  }
  const publicKey = createPublicKey(input.publicKeyPem);
  if (publicKey.asymmetricKeyType !== "ed25519") {
    throw new Error("GUI_COMPATIBILITY_PUBLIC_KEY_INVALID");
  }
  if (!verify(null, input.matrixBytes, publicKey, input.signatureBytes)) {
    throw new Error("GUI_COMPATIBILITY_SIGNATURE_INVALID");
  }
  const source = new TextDecoder("utf-8", { fatal: true }).decode(input.matrixBytes);
  return appGuiCompatibilitySupportSchema.parse(JSON.parse(source));
}

export function createGitHubCompatibilityLoader(
  resourcesPath: string,
  fetchImpl: typeof fetch = fetch
): CandidateCompatibilityLoader {
  let publicKey: Promise<Buffer> | null = null;
  return async (version) => {
    if (!RELEASE_VERSION.test(version)) {
      throw new Error("GUI_COMPATIBILITY_VERSION_INVALID");
    }
    publicKey ??= readFile(
      join(resourcesPath, TOOLCHAIN_DIRECTORY, RELEASE_KEY_ASSET)
    ).catch((cause) => {
      publicKey = null;
      throw new Error("GUI_COMPATIBILITY_RELEASE_KEY_UNAVAILABLE", { cause });
    });
    const prefix = `https://github.com/thinkingjimmy/Bottega/releases/download/v${version}`;
    const [matrixBytes, signatureBytes, publicKeyPem] = await Promise.all([
      fetchBounded(fetchImpl, `${prefix}/${MATRIX_ASSET}`, MATRIX_BYTES_LIMIT),
      fetchBounded(fetchImpl, `${prefix}/${MATRIX_ASSET}.sig`, SIGNATURE_BYTES),
      publicKey,
    ]);
    return verifyCandidateCompatibility({ matrixBytes, signatureBytes, publicKeyPem });
  };
}

async function fetchBounded(
  fetchImpl: typeof fetch,
  url: string,
  limit: number
): Promise<Uint8Array> {
  const response = await fetchImpl(url, {
    headers: { accept: "application/octet-stream" },
    redirect: "follow",
  });
  if (!response.ok || !trustedReleaseUrl(response.url)) {
    throw new Error("GUI_COMPATIBILITY_ASSET_UNAVAILABLE");
  }
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (declared > limit) throw new Error("GUI_COMPATIBILITY_ASSET_TOO_LARGE");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > limit) throw new Error("GUI_COMPATIBILITY_ASSET_TOO_LARGE");
  return bytes;
}

function trustedReleaseUrl(value: string) {
  const url = new URL(value);
  return url.protocol === "https:" && (
    url.hostname === "github.com" ||
    url.hostname.endsWith(".githubusercontent.com")
  );
}
