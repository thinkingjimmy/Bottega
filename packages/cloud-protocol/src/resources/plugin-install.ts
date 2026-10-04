/**
 * [INPUT]: Depends on Zod.
 * [OUTPUT]: Provides bounded GitHub installation requests and status-only receipts.
 * [POS]: Remote plugin acquisition contract; it grants no installation authority and carries no Base records or reports.
 */
import { z } from "zod";
export const pluginInstallSourceSchema = z.object({
  repoUrl: z.string().max(2048).url().refine(raw => {
    try {
      const url = new URL(raw);
      return url.protocol === "https:" && url.hostname === "github.com" && !url.username && !url.password && !url.search && !url.hash && !url.port
        && /^\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/?$/.test(url.pathname);
    } catch { return false; }
  }),
  requestedRef: z.string().min(1).max(160).optional(),
  subdirectory: z.string().max(200).optional(),
}).strict();
export const pluginInstallStateSchema = z.enum(["waiting", "reviewing", "installing", "installed", "declined", "expired", "unknown"]);
export const pluginInstallReceiptSchema = z.object({ requestId: z.string().uuid(), state: pluginInstallStateSchema }).strict();
export type PluginInstallSource = z.infer<typeof pluginInstallSourceSchema>;
export type PluginInstallReceipt = z.infer<typeof pluginInstallReceiptSchema>;
export type NativePluginInstallRequest = PluginInstallSource & PluginInstallReceipt & { sourceDeviceId: string; expiresAt: number };
