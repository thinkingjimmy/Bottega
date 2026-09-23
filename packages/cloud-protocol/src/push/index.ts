/**
 * [INPUT]: Depends on Zod and the shared cloud identifier scalar.
 * [OUTPUT]: Provides push categories, Expo token/platform/locale scalars, the per-device registration projection and the closed notification data payload.
 * [POS]: Push contract shared by the backend delivery, the Web settings/registration owner and the native shell's tap payload.
 */
import { z } from "zod";
import { cloudIdSchema, mobilePlatformSchema } from "../auth/index";
export const PUSH_LIMITS = Object.freeze({
  /* Expo push API: messages per send request, receipt ids per getReceipts request and bytes per message. */
  messagesPerRequest: 100, receiptsPerRequest: 300, messageBytes: 4096,
  /* One Chat's notifications collapse inside this window; event idempotency is separate. */
  coalesceMs: 60_000,
  /* Expo keeps receipts ~24 h; checking them 15 min after the send is the documented cadence. */
  receiptDelayMs: 15 * 60_000,
  retentionMs: 7 * 86_400_000,
});
export const pushCategoriesSchema = z.object({ settled: z.boolean(), attention: z.boolean() }).strict();
export type PushCategories = z.infer<typeof pushCategoriesSchema>;
export const pushKindSchema = z.enum(["settled", "attention"]);
export type PushKind = z.infer<typeof pushKindSchema>;
/* Expo's opaque device address, e.g. ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]. */
export const expoPushTokenSchema = z.string().max(256).regex(/^Expo(?:nent)?PushToken\[[A-Za-z0-9_-]{1,200}\]$/);
export const pushPlatformSchema = mobilePlatformSchema;
/* The server never sees the page's language otherwise; notification copy is chosen from it at delivery. */
export const pushLocaleSchema = z.enum(["zh-CN", "en", "ja", "fr", "es"]);
export type PushLocale = z.infer<typeof pushLocaleSchema>;
export const pushRegistrationSchema = z.object({
  registered: z.boolean(), categories: pushCategoriesSchema, locale: pushLocaleSchema.nullable(),
}).strict();
export type PushRegistration = z.infer<typeof pushRegistrationSchema>;
/* The only data a notification carries: no title, body, credential or computer identity. */
export const pushDataSchema = z.object({
  chatId: cloudIdSchema, kind: pushKindSchema, turnSeq: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
}).strict();
export type PushData = z.infer<typeof pushDataSchema>;
export const DEFAULT_PUSH_CATEGORIES: PushCategories = Object.freeze({ settled: true, attention: true });
