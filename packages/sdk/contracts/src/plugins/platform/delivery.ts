/**
 * [INPUT]: Unified plugin identities and bounded immutable revision metadata.
 * [OUTPUT]: Pathless explicit remote-package review, acceptance and progress contracts.
 * [POS]: Renderer package delivery boundary; review never approves execution or changes the accepted revision.
 */
import { z } from "zod";
import { pluginIdentitySchema, pluginDigestSchema } from "./manifest";
export const pluginUpdateQuerySchema = z.object({ pluginId: pluginIdentitySchema, sourceInstallationId: z.string().min(1).max(256).optional(), reference: pluginDigestSchema.optional() }).strict();
export const pluginUpdateAcceptSchema = z.object({ reviewId: z.string().uuid(), operationId: pluginIdentitySchema, trust: z.literal(true) }).strict();
export type PluginUpdateReview = { reviewId: string; pluginId: string; name: string; revisionId: string; reference: string;
  sourceInstallationId: string; bytes: number; contributions: { id: string; kind: string; name: string }[]; trustRequired: boolean };
export type PluginUpdateProgress = { operationId: string; pluginId: string; revisionId: string;
  state: "reviewed" | "downloading" | "installing" | "ready" | "failed" | "cancelled"; bytes?: number; totalBytes?: number; error?: string };
export type PluginPackageDeliveryBridge = {
  reviewUpdate(input: z.infer<typeof pluginUpdateQuerySchema>): Promise<PluginUpdateReview>;
  acceptUpdate(input: z.infer<typeof pluginUpdateAcceptSchema>): Promise<PluginUpdateProgress>;
  dismissUpdate(input: { reviewId: string }): Promise<void>;
  updateProgress(input: { operationId: string }): Promise<PluginUpdateProgress | null>;
  cancelUpdate(input: { operationId: string }): Promise<PluginUpdateProgress>;
  sharingStatus(input: { pluginId: string }): Promise<{ enabled: boolean; lastPublishedRevision?: string }>;
  publishPlugin(input: { pluginId: string }): Promise<{ reference: string; revisionId: string }>;
};
