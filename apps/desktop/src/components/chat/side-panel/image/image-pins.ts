/**
 * [INPUT]: Depends on React state/effect hooks, panel-catalog Image identities, the shared image identity decoder, resolveConversationImage, and the chats timeline page read
 * [OUTPUT]: Provides useOpenImages plus its pure rules pinImages/settleImagePin/readImageRow: every open Image tab resolves independently of the transcript window
 * [POS]: chat/side-panel/image's resolution cache for PanelTabs; the window keeps only a bounded slice (TASK-25 S4d), so a tab pins the row it resolved to while it stays open,
 *        and a tab whose region names its row (a generated seq:N, or an attachment opened from a canonical user row) is read back by seq through the store when it is outside window and projection
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { decodeImageIdentity } from "@ai-chat/chat-ui/image/identity";
import type { ChatMessage, ChatTimelinePage, ChatTimelinePageInput } from "../../../../../shared/ipc/content/chats-ipc";
import { getChatTimelinePage } from "@/lib/chat/session/chats-client";
import type { ImageRegionId } from "../panel-catalog";
import type { ConversationImageProjection } from "./image-projection";
import { resolveConversationImage, type ResolvedConversationImage } from "./image-tab-panel";

export type ImagePin = ResolvedConversationImage | "reading" | "missing";
export type ImagePins = ReadonlyMap<ImageRegionId, ImagePin>;
type ReadPage = (input: ChatTimelinePageInput) => Promise<ChatTimelinePage | null>;

const EMPTY: ImagePins = new Map();
const incarnationOf = (image: ResolvedConversationImage) =>
  image.source.kind === "generated" ? image.source.sourceRef.incarnationId : image.source.incarnationId;
const pinKey = (pin: ImagePin | undefined) => (typeof pin === "object" ? JSON.stringify([pin.label, pin.source]) : pin);

/* A main-transcript generated image names its row (seq:N), and so does an attachment opened from a canonical user row; an attachment region
   without a seq keeps only its pin, and a Subagent image lives in the live Subagent projection. */
export function readableSeq(region: ImageRegionId) {
  const identity = decodeImageIdentity(region);
  if (identity?.kind === "attachment") return identity.seq ?? null;
  if (identity?.kind !== "generated" || identity.subagentId !== null) return null;
  const match = /^seq:(0|[1-9][0-9]*)$/.exec(identity.messageId);
  return match ? Number(match[1]) : null;
}

/* The pins follow the open tabs: a live hit replaces the pin, a miss keeps it, a closed tab drops it. Unchanged pins keep their identity. */
export function pinImages(
  pins: ImagePins,
  open: readonly ImageRegionId[],
  live: ReadonlyMap<ImageRegionId, ResolvedConversationImage | null>,
  incarnationId: string | null
): ImagePins {
  const next = new Map<ImageRegionId, ImagePin>();
  for (const region of open) {
    const held = pins.get(region);
    const kept = typeof held === "object" && incarnationOf(held) !== incarnationId ? undefined : held;
    next.set(region, live.get(region) ?? kept ?? (readableSeq(region) === null ? "missing" : "reading"));
  }
  const same = next.size === pins.size && [...next].every(([region, pin]) => pinKey(pins.get(region)) === pinKey(pin));
  return same ? pins : next;
}

export function settleImagePin(pins: ImagePins, region: ImageRegionId, pin: Exclude<ImagePin, "reading">): ImagePins {
  if (pins.get(region) !== "reading") return pins;
  return new Map(pins).set(region, pin);
}

/* The existing cursor read: the tail gives the current fence, then one native row before seq + 1. A moved fence or a deleted row is a miss, never a substitute. */
export async function readImageRow(read: ReadPage, chatId: string, seq: number): Promise<ChatMessage | null> {
  const match = (page: ChatTimelinePage | null) => page?.messages.find((row) => row.seq === seq && row.segment !== "imported") ?? null;
  try {
    const tail = await read({ chatId, limit: 1 });
    if (!tail) return null;
    const { incarnationId, nativeMessageRevision, activeGenerationId } = tail;
    return match(tail) ?? match(await read({
      chatId, limit: 1,
      cursor: { segment: "native", beforeSeq: seq + 1, incarnationId, nativeMessageRevision, activeGenerationId },
    }));
  } catch {
    return null;
  }
}

export function useOpenImages(open: readonly ImageRegionId[], projection: ConversationImageProjection | undefined, fallbackTitle: string) {
  const live = useMemo(
    () => new Map(projection ? open.map((region) => [region, resolveConversationImage(region, projection, fallbackTitle)] as const) : []),
    [fallbackTitle, open, projection]
  );
  const scope = projection ? `${projection.chatId}:${projection.incarnationId}` : "";
  const [held, setHeld] = useState({ scope, pins: EMPTY });
  const current = held.scope === scope ? held.pins : EMPTY;
  const pins = projection?.hydrated ? pinImages(current, open, live, projection.incarnationId) : current;
  // Adjusting state while rendering: the pins are derived from the open tabs and settle in one pass because unchanged pins keep their identity.
  if (held.scope !== scope || pins !== held.pins) setHeld({ scope, pins });

  const reading = useRef(new Set<string>());
  useEffect(() => {
    if (!projection) return;
    for (const [region, pin] of pins) {
      const seq = readableSeq(region);
      const key = `${scope}|${region}`;
      if (pin !== "reading" || seq === null || reading.current.has(key)) continue;
      reading.current.add(key);
      void readImageRow(getChatTimelinePage, projection.chatId, seq).then((row) => {
        reading.current.delete(key);
        const image = row ? resolveConversationImage(region, { ...projection, canonicalMessages: [row], draft: null }, fallbackTitle) : null;
        setHeld((prev) => (prev.scope === scope ? { scope, pins: settleImagePin(prev.pins, region, image ?? "missing") } : prev));
      });
    }
  }, [fallbackTitle, pins, projection, scope]);

  return useMemo(() => ({
    images: new Map([...pins].map(([region, pin]) => [region, typeof pin === "object" ? pin : null] as const)),
    reading: (region: ImageRegionId) => pins.get(region) === "reading",
  }), [pins]);
}
