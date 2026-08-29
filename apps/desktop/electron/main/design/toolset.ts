/**
 * [INPUT]: Depends on an incarnation-bound registered-canvas reader, the Design anti-slop lint, hermetic render-check capture, and turn-derived built-in tool context
 * [OUTPUT]: Provides createDesignToolset with design_render_check authorization derived only from the exact lease chat incarnation and a bounded image marker result
 * [POS]: Design-to-built-in-tools adapter; it cannot select another chat, workspace, or unregistered file
 */

import type { BuiltinToolset } from "../tools/registry";
import { lintDesignHtml } from "./anti-slop";
import { captureDesignCanvas, type DesignRenderViewport } from "./render-check";

export type DesignToolsetPorts = Readonly<{
  readDesignCanvasForTool(chatId: string, incarnationId: string, file: string): Promise<Buffer | string>;
}>;

export function createDesignToolset(ports: DesignToolsetPorts): BuiltinToolset {
  return {
    design_render_check: async (args, context) => {
      const file = args.file as string;
      const viewport = args.viewport as DesignRenderViewport;
      const html = await ports.readDesignCanvasForTool(
        context.lease.chatId,
        context.lease.incarnationId,
        file
      );
      // Base64 and the metadata envelope consume roughly 4/3 of the JPEG bytes.
      const maxImageBytes = Math.floor(Math.max(12 * 1024, context.lease.resultByteBudget - 4_096) * 0.72);
      const screenshot = await captureDesignCanvas({
        html,
        viewport,
        maxImageBytes,
        signal: context.signal,
      });
      return {
        type: "builtin-image",
        mimeType: "image/jpeg",
        data: screenshot.data,
        metadata: {
          file,
          viewport,
          width: screenshot.width,
          height: screenshot.height,
          quality: screenshot.quality,
          bytes: screenshot.bytes,
          advisories: lintDesignHtml(html),
        },
      };
    },
  };
}
