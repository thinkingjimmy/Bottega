/**
 * [INPUT]: Depends on Zod, the shared cloud identifier scalar and browser push subscription schemas.
 * [OUTPUT]: Provides PUSH_LIMITS, pushCategoriesSchema, PushCategories, pushKindSchema, PushKind, expoPushTokenSchema, pushPlatformSchema, pushLocaleSchema, PushLocale, pushRegistrationSchema, PushRegistration, chatPushDataSchema, newComputerPushDataSchema, pushDataSchema, PUSH_OWNERSHIP, pushInstallProofSchema, PushInstallProof, pushInstallProofMessage, pushChallengeNonceSchema, pushRegisterResultSchema, PushRegisterResult, challengePushDataSchema, ChallengePushData, PushData, DEFAULT_PUSH_CATEGORIES.
 * [POS]: Push contract shared by the backend delivery, the Web settings/registration owner and the native shell's tap payload.
 */
import { z } from "zod";
import { cloudIdSchema, mobilePlatformSchema } from "../auth/index";
export { webPushEndpointSchema, webPushSubscriptionSchema, type WebPushSubscription } from "./browser";
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
export const chatPushDataSchema = z.object({
  chatId: cloudIdSchema, kind: pushKindSchema, turnSeq: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
}).strict();
export const newComputerPushDataSchema = z.object({
  kind: z.literal("attention"), targetKind: z.literal("new-computer"),
}).strict();
export const pushDataSchema = z.union([chatPushDataSchema, newComputerPushDataSchema]);
/* R-36: proof that the phone registering a token is the installation already bound to it (a non-exportable Keystore P-256 key).
   The signed bytes name the registering account, so a proof cannot be replayed into another account. */
export const PUSH_OWNERSHIP = Object.freeze({ proofSkewMs: 120_000, challengeMs: 60_000, perTokenChallenges: 3, perTokenWindowMs: 10 * 60_000,
  perUserChallenges: 10, perUserWindowMs: 60 * 60_000, retentionMs: 60 * 60_000 });
const base64url = (min: number, max: number) => z.string().min(min).max(max).regex(/^[A-Za-z0-9_-]+$/);
export const pushInstallProofSchema = z.object({
  publicKey: base64url(80, 128), signature: base64url(86, 86), issuedAt: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
}).strict();
export type PushInstallProof = z.infer<typeof pushInstallProofSchema>;
export const pushInstallProofMessage = (token: string, userId: string, issuedAt: number) => `bottega-push-install-v1\n${token}\n${userId}\n${issuedAt}`;
/* 16 random bytes; the server stores only its hash. */
export const pushChallengeNonceSchema = base64url(22, 22);
/* A token another installation holds is not taken on request: the phone must answer a challenge sent to that token. */
export const pushRegisterResultSchema = z.union([
  pushRegistrationSchema.extend({ registered: z.literal(true) }).strict(),
  z.object({ registered: z.literal(false), challenge: z.enum(["sent", "limited"]) }).strict(),
]);
export type PushRegisterResult = z.infer<typeof pushRegisterResultSchema>;
/* The challenge travels data-only and is kept apart from pushDataSchema, which titled notifications and taps are built from:
   a phone never shows it and never opens anything from it. */
export const challengePushDataSchema = z.object({ kind: z.literal("challenge"), nonce: pushChallengeNonceSchema }).strict();
export type ChallengePushData = z.infer<typeof challengePushDataSchema>;
export type PushData = z.infer<typeof pushDataSchema>;
export const DEFAULT_PUSH_CATEGORIES: PushCategories = Object.freeze({ settled: true, attention: true });
