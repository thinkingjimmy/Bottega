"use client";

/**
 * [INPUT]: Depends on zod and the shared Base GUI host-action channel constant
 * [OUTPUT]: Provides hostMessageSchema and readyMessageSchema — the only shapes an App iframe may send the host
 * [POS]: components/apps/surface wire leaf; app-gui-surface.tsx owns frame lifecycle while this file owns what counts as a well-formed message
 */

import { z } from "zod";
import { BASE_GUI_ACTION_CHANNEL } from "../../../../shared/apps-ipc";

export const hostMessageSchema = z
  .object({
    channel: z.literal(BASE_GUI_ACTION_CHANNEL),
    token: z.string().min(1),
    requestId: z.string().regex(/^host_[a-z0-9_]{3,96}$/),
    action: z.discriminatedUnion("type", [
      z.object({ type: z.literal("open-data") }).strict(),
      z
        .object({
          type: z.literal("open-data-view"),
          viewId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
        })
        .strict(),
      z
        .object({
          type: z.literal("compose-text"),
          text: z.string().min(1).max(32_768),
        })
        .strict(),
      z.object({
        type: z.literal("file.export.begin"),
        request: z.object({
          version: z.literal(1),
          suggestedName: z.string().min(1).max(255),
          mediaType: z.enum([
            "text/plain;charset=utf-8", "text/csv;charset=utf-8", "application/json",
            "image/png", "image/jpeg", "image/webp", "image/gif",
          ]),
          byteLength: z.number().int().min(1).max(20 * 1024 * 1024),
          sha256: z.string().regex(/^sha256:[a-f0-9]{64}$/)
            .transform((value) => value as `sha256:${string}`),
        }).strict(),
      }).strict(),
      z.object({
        type: z.literal("file.export.chunk"),
        header: z.object({
          exportId: z.string().uuid(),
          seq: z.number().int().nonnegative().max(319),
          byteLength: z.number().int().min(1).max(65_536),
        }).strict(),
        bytes: z.instanceof(Uint8Array),
      }).strict(),
      z.object({ type: z.literal("file.export.finalize"), exportId: z.string().uuid() }).strict(),
      z.object({ type: z.literal("file.export.cancel"), exportId: z.string().uuid() }).strict(),
    ]),
  })
  .strict();

export const readyMessageSchema = z
  .object({
    channel: z.literal("bottega:app-gui-ready"),
    leaseId: z.string().min(1),
    readyNonce: z.string().uuid(),
  })
  .strict();
