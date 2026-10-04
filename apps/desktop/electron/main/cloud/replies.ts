/**
 * [INPUT]: Depends on zod schemas owned by the shared cloud contracts and an Electron window.
 * [OUTPUT]: Provides `replying` (parse a handler's reply with its contract before it crosses IPC), `sendParsed` (parse a pushed event, drop it when it does not match) and `reportOutboundDrift` (the named diagnostic for a dropped value).
 * [POS]: Main-side outbound validation for the cloud IPC registrations. Preload used to run these parses (OPT-34); main now sends exactly the contract's shape, so unknown keys are stripped and defaults are filled before the value leaves main.
 */
import type { BrowserWindow } from "electron";
import type { ZodError, ZodType } from "zod";

export const replying = <T>(schema: ZodType<T>, handler: (...args: unknown[]) => unknown) =>
  async (...args: unknown[]): Promise<T> => schema.parse(await handler(...args));

/* A dropped push means main and its own contract disagree: say so by name, with issue paths and codes only, never the value. */
export function reportOutboundDrift(channel: string, error: ZodError) {
  console.warn("[cloud-outbound-drift]", { channel, issues: error.issues.slice(0, 8).map(issue => ({ path: issue.path.join("."), code: issue.code })) });
}

export function sendParsed(window: BrowserWindow, channel: string, schema: ZodType, value: unknown) {
  const parsed = schema.safeParse(value);
  if (!parsed.success) { reportOutboundDrift(channel, parsed.error); return; }
  if (!window.isDestroyed()) window.webContents.send(channel, parsed.data);
}
