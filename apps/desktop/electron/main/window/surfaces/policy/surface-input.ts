/**
 * [INPUT]: Depends on shared surface/chat validators, navigation-intent validation, and untrusted renderer values
 * [OUTPUT]: Provides strict App id, generation-fenced show, open-in-window, and reclaim intent parsers
 * [POS]: Window-surfaces input policy boundary; generic orchestration receives normalized intents only
 */

import {
  assertSurfaceKey,
  chatSurface,
  type OpenSurfaceInWindowInput,
  type ReclaimSurfaceInput,
  type ShowSurfaceInput,
} from "../../../../../shared/window-surfaces-ipc";
import { parseSurfaceNavigationIntentId } from "./surface-navigation-intents";

export const parseAppId = (value: unknown) => {
  if (typeof value !== "string" || !/^[A-Za-z0-9._-]{1,160}$/.test(value)) {
    throw new Error("Invalid App id");
  }
  return value;
};

export const parseChatPart = (value: unknown) => {
  if (typeof value !== "string") {
    throw new Error("Invalid chat surface identity");
  }
  chatSurface(value, value);
  return value;
};

const revision = (value: unknown) => {
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new Error("Invalid residence revision");
  }
  return value as number;
};

export function showSurfaceInput(value: unknown): ShowSurfaceInput {
  const input = value as Partial<ShowSurfaceInput> | null;
  return {
    surface: assertSurfaceKey(input?.surface),
    route: typeof input?.route === "string" ? input.route : "",
    ...(input?.navigationIntentId === undefined
      ? {}
      : {
          navigationIntentId: parseSurfaceNavigationIntentId(
            input.navigationIntentId
          ),
        }),
  };
}

export function openSurfaceInput(value: unknown): OpenSurfaceInWindowInput {
  const input = value as Partial<OpenSurfaceInWindowInput> | null;
  return {
    ...showSurfaceInput(value),
    appId: parseAppId(input?.appId),
    ...(input?.expectedRevision === undefined
      ? {}
      : { expectedRevision: revision(input.expectedRevision) }),
    ...(input?.useChat
      ? {
          useChat: {
            chatId: parseChatPart(input.useChat.chatId),
            incarnationId: parseChatPart(input.useChat.incarnationId),
          },
        }
      : {}),
  };
}

export function reclaimSurfaceInput(value: unknown): ReclaimSurfaceInput {
  const input = value as Partial<ReclaimSurfaceInput> | null;
  return {
    ...showSurfaceInput(value),
    ...(input?.expectedRevision === undefined
      ? {}
      : { expectedRevision: revision(input.expectedRevision) }),
  };
}
