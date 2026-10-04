/**
 * [INPUT]: Zod scalar validation and the supported browser push service origins.
 * [OUTPUT]: Bounded Web Push subscriptions and the endpoint admission shared by registration and delivery.
 * [POS]: Browser transport of the existing push protocol; endpoint possession is proved through R-36.
 */
import { z } from "zod";

export function allowedPushEndpoint(value: string) {
  try {
    const url = new URL(value), host = url.hostname;
    return url.protocol === "https:" && !url.username && !url.password && !url.port && !url.hash &&
      (host === "fcm.googleapis.com" || host === "updates.push.services.mozilla.com" ||
        host.endsWith(".push.services.mozilla.com") || host === "web.push.apple.com" ||
        host.endsWith(".push.apple.com") || host.endsWith(".notify.windows.com"));
  } catch { return false; }
}
export const webPushEndpointSchema = z.string().min(1).max(2048).refine(allowedPushEndpoint);
export const webPushSubscriptionSchema = z.object({ endpoint: webPushEndpointSchema,
  bindingId: z.uuid(),
  keys: z.object({ p256dh: z.string().length(87).regex(/^[A-Za-z0-9_-]+$/), auth: z.string().length(22).regex(/^[A-Za-z0-9_-]+$/) }).strict(),
}).strict();
export type WebPushSubscription = z.infer<typeof webPushSubscriptionSchema>;
