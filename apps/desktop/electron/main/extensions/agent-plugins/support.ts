/**
 * [INPUT]: Depends on Node fs/path and the shared plugin inventory entry type
 * [OUTPUT]: Provides the bounded registry reader (readJson/JsonRead, jsonValue), value narrowing (asObject, firstString), plugin-id validation, path existence and real-path containment checks, and byPluginId ordering
 * [POS]: The fail-closed reading primitives every provider's plugin inventory shares; no provider-specific path or format lives here
 */
import { lstat, readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { AgentPluginInventoryEntry } from "../../../../shared/ipc/settings/extensions-ipc";

const MAX_REGISTRY_BYTES = 1024 * 1024;
const PLUGIN_ID = /^[^\p{Cc}\p{Cf}]{1,200}$/u;

export type JsonRead =
  | Readonly<{ state: "ready"; value: unknown }>
  | Readonly<{ state: "missing" | "error" }>;

export async function readJson(path: string): Promise<JsonRead> {
  try {
    const bytes = await readFile(path);
    if (bytes.byteLength > MAX_REGISTRY_BYTES) return { state: "error" };
    return { state: "ready", value: JSON.parse(bytes.toString("utf8")) };
  } catch (cause) {
    return (cause as NodeJS.ErrnoException).code === "ENOENT"
      ? { state: "missing" }
      : { state: "error" };
  }
}

/* missing 与 error 在读取面同义：都没有可信内容可读。区别只在调用方——
   谁要 fail-closed，谁就先看 `state`，而不是靠两份同形的取值函数区分。 */
export function jsonValue(read: JsonRead) {
  return read.state === "ready" ? read.value : {};
}

export function asObject(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

export function firstString(...values: unknown[]) {
  return values.find((value): value is string => typeof value === "string" && value.length > 0) ?? "";
}

export function validPluginId(value: string) {
  return PLUGIN_ID.test(value);
}

export async function pathState(path: string) {
  if (!path) return false;
  try {
    const metadata = await lstat(resolve(path));
    return metadata.isDirectory() || metadata.isFile();
  } catch {
    return false;
  }
}

export async function isContainedPath(path: string, parent: string) {
  try {
    const [candidate, boundary] = await Promise.all([
      realpath(path),
      realpath(parent),
    ]);
    const child = relative(boundary, candidate);
    return child === "" || (
      child !== ".." &&
      !child.startsWith(`..${sep}`) &&
      !isAbsolute(child)
    );
  } catch {
    return false;
  }
}

export function byPluginId(left: AgentPluginInventoryEntry, right: AgentPluginInventoryEntry) {
  return left.id.localeCompare(right.id);
}
