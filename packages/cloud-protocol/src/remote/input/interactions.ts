/**
 * [INPUT]: Zod scalar validation for approval choices and authenticated interaction provenance.
 * [OUTPUT]: Shared approval decisions and InteractionSource without command or queue schema dependencies.
 * [POS]: Small input contract used by command receipts and live projections, including search workers.
 */
import { z } from "zod";
export const remoteApprovalDecisionSchema = z.union([z.enum(["accept", "accept-for-session", "decline"]), z.string().regex(/^choice:(?:0|[1-9][0-9]{0,5})$/)]);
export const interactionSourceSchema = z.object({ sourceDeviceId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
  sourceDeviceName: z.string().min(1).max(120) }).strict();
export type InteractionSource = z.infer<typeof interactionSourceSchema>;
