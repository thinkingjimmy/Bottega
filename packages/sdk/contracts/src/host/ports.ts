/**
 * [INPUT]: Depends on zod and the strict JSON rule (../core/canonical).
 * [OUTPUT]: Provides PACKAGE_PORT_LIMITS, portJsonBytes and portStorageBytes (the measures the limits use), packagePortKeySchema, packagePortContractSchema, PACKAGE_PORT_INPUTS (the input schema of each package port operation), PackagePortOperation, isPackagePortOperation, and packageEventSchema / PackageEvent (what a subscriber's `event` handler receives).
 * [POS]: The package ports every host package can call through HostApi.call: storage in its own namespace, events on the contracts it requires or provides, background holds, and its own declared settings. The desktop's port implementation validates with these schemas and measures with these functions, and docs/ports.md is generated from them. How the desktop stores and routes (file format, paths, queues, callers) stays private.
 */
import { z } from "zod";
import { assertStrictJson } from "../core/canonical";

/**
 * - `keys`, `keyChars`: stored keys per package, and characters per key.
 * - `valueBytes`, `eventBytes`: one stored value, or one event payload, as `portJsonBytes`.
 * - `totalBytes`: everything a package stores, as `portStorageBytes`.
 * - `listPage`: keys per `storage.list` page.
 * - `subscribersPerContract`: subscribers of one contract, counted across all packages.
 */
export const PACKAGE_PORT_LIMITS = Object.freeze({ keys: 2_048, keyChars: 256, valueBytes: 64 * 1024, totalBytes: 4 * 1024 * 1024,
  listPage: 100, subscribersPerContract: 64, eventBytes: 16 * 1024 });

const utf8 = new TextEncoder();
/** The UTF-8 bytes of `JSON.stringify(value)`: what `valueBytes` and `eventBytes` measure. */
export const portJsonBytes = (value: unknown) => utf8.encode(JSON.stringify(value)).byteLength;
/** What `totalBytes` measures: each stored key's UTF-8 bytes plus its value's `portJsonBytes`. */
export const portStorageBytes = (entries: Readonly<Record<string, unknown>>) =>
  Object.entries(entries).reduce((sum, [key, value]) => sum + utf8.encode(key).byteLength + portJsonBytes(value), 0);

export const packagePortKeySchema = z.string().min(1).max(PACKAGE_PORT_LIMITS.keyChars).regex(/^[A-Za-z0-9._:/-]+$/);
/**
 * A Bottega-defined contract, `bottega.<name>/v<n>`. In 0.x packages talk to each other only through contracts Bottega
 * defines; other namespaces are refused.
 */
export const packagePortContractSchema = z.string().regex(/^bottega\.[a-z0-9.-]+\/v[1-9][0-9]*$/);

/* Strict JSON, as the host stores and delivers it: no undefined, NaN, ±Infinity, -0, unsafe integers, lone surrogates,
   sparse arrays, accessors or objects that are not plain. */
const isStrictJson = (value: unknown) => { try { assertStrictJson(value); return true; } catch { return false; } };
const strictJson = z.unknown().refine(isStrictJson, "strict-json");

const key = packagePortKeySchema, contract = packagePortContractSchema;
export const PACKAGE_PORT_INPUTS = {
  "storage.get": z.object({ key }).strict(),
  "storage.put": z.object({ key, value: strictJson }).strict(),
  "storage.delete": z.object({ key }).strict(),
  "storage.list": z.object({ prefix: z.string().max(PACKAGE_PORT_LIMITS.keyChars).default(""), after: key.optional() }).strict(),
  "events.subscribe": z.object({ contract }).strict(),
  "events.publish": z.object({ contract, type: z.string().min(1).max(80).regex(/^[a-z][a-z0-9.-]*$/), payload: strictJson }).strict(),
  "background.hold": z.object({ reason: z.string().min(1).max(120) }).strict(),
  "background.release": z.object({}).strict(),
  /* The package's own settings, defaults filled; secrets in clear text, to this package only. Changes arrive as `changed` events on bottega.settings/v1. */
  "settings.get": z.object({}).strict(),
} as const;
export type PackagePortOperation = keyof typeof PACKAGE_PORT_INPUTS;
export const isPackagePortOperation = (name: string): name is PackagePortOperation => Object.hasOwn(PACKAGE_PORT_INPUTS, name);

/**
 * What a subscriber's `event` handler receives. `from` names the publisher by an opaque handle: stable for one subscriber
 * and one publisher, so a subscriber can deduplicate and correlate, but never an install identity, and two subscribers get
 * different handles for the same publisher.
 */
export const packageEventSchema = z.object({ contract, type: PACKAGE_PORT_INPUTS["events.publish"].shape.type, payload: strictJson,
  from: z.string().regex(/^pkg_[0-9a-f]{32}$/) }).strict();
export type PackageEvent = z.infer<typeof packageEventSchema>;
