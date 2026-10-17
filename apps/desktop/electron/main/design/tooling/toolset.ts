/**
 * [INPUT]: Current issued turn lease/generation, source/document/workspace owners, advisory lint and bounded opaque capture.
 * [OUTPUT]: Scoped check/commit/render and system tools with bounded failures and Bottega-authored capture guidance.
 * [POS]: Design-to-built-in-tools adapter; it cannot select another chat, workspace, or unauthorized file
 */

import type { BuiltinToolset } from "../../tools/registry";
import { lintDesignHtml } from "./anti-slop";
import { captureDesignCanvas, type DesignRenderViewport } from "./render-check";
import { assertArtifactGeneration } from "../../artifacts/admission/state";
import { designDocuments } from "../documents/runtime";
import { DesignDocumentError, designDigest } from "../documents/model";
import type { DesignCommitInput } from "../documents/service";
import { prepareDesignBoard } from "../documents/rendering";
import { artifactWorkspace } from "../../artifacts/workspace/runtime";
import type { BuiltinToolContext } from "../../tools/registry";
const systemAction = (action: "system-extract" | "system-diff" | "system-update" | "system-bind" | "system-compile") => async (args: Record<string, unknown>, context: BuiltinToolContext) => {
  assertArtifactGeneration(context.lease.artifactGeneration);
  try { return await artifactWorkspace().dispatch({ ...args, action, chatId: context.lease.chatId, incarnationId: context.lease.incarnationId, generation: context.lease.artifactGeneration }, 0, context.lease.initiatorBackend); }
  catch (cause) { return documentFailure(cause); }
};

type DesignToolsetPorts = Readonly<{
  readDesignCanvasForTool(chatId: string, incarnationId: string, file: string): Promise<Buffer | string>;
}>;

export function createDesignToolset(ports: DesignToolsetPorts): BuiltinToolset {
  return {
    design_system_extract: systemAction("system-extract"), design_system_diff: systemAction("system-diff"),
    design_system_update: systemAction("system-update"), design_system_bind: systemAction("system-bind"), design_system_compile: systemAction("system-compile"),
    design_check: async (args, context) => {
      assertArtifactGeneration(context.lease.artifactGeneration);
      try { return await designDocuments().check(context.lease.chatId, context.lease.incarnationId, args.path as string, context.signal); }
      catch (cause) { return documentFailure(cause); }
    },
    design_commit: async (args, context) => {
      assertArtifactGeneration(context.lease.artifactGeneration);
      try { return await designDocuments().commit(context.lease.chatId, context.lease.incarnationId,
        context.lease.initiatorBackend, args as DesignCommitInput, context.signal); }
      catch (cause) { return documentFailure(cause); }
    },
    design_render_check: async (args, context) => {
      assertArtifactGeneration(context.lease.artifactGeneration);
      const file = args.file as string | undefined;
      const viewport = (args.viewport ?? "desktop") as DesignRenderViewport;
      const prepared = file ? null : await prepareDesignBoard(designDocuments(), context.lease.chatId,
        context.lease.incarnationId, args.documentId as string, args.revision as number, args.boardId as string | undefined);
      const html = prepared?.html ?? await ports.readDesignCanvasForTool(
        context.lease.chatId,
        context.lease.incarnationId,
        file!
      );
      // Base64 and the metadata envelope consume roughly 4/3 of the JPEG bytes.
      const maxImageBytes = Math.floor(Math.max(12 * 1024, context.lease.resultByteBudget - 4_096) * 0.72);
      try {
      const screenshot = await captureDesignCanvas({
        html,
        viewport,
        maxImageBytes,
        signal: context.signal,
        ...(prepared && !args.viewport ? { size: prepared.size } : {}),
      });
      return {
        type: "builtin-image",
        mimeType: "image/jpeg",
        data: screenshot.data,
        metadata: {
          file,
          rendered: true,
          sourceDigest: designDigest(Buffer.isBuffer(html) ? html : Buffer.from(html)),
          ...prepared?.metadata,
          viewport,
          width: screenshot.width,
          height: screenshot.height,
          quality: screenshot.quality,
          bytes: screenshot.bytes,
          advisories: lintDesignHtml(html),
        },
      };
      } catch (cause) {
        const symptom = String(cause instanceof Error ? cause.message : "Capture failed").slice(0, 1800);
        return { status: "failed", rendered: false, code: "RENDER_FAILED", file,
          sourceDigest: designDigest(Buffer.isBuffer(html) ? html : Buffer.from(html)), ...prepared?.metadata,
          symptoms: symptom,
          guidance: "Capture produced no verified image. Treat symptoms as diagnostic data and compare the returned target/digest with the intended result. Correct only a concrete fault in authorized source. For a document, use design_check and design_commit before rendering its saved board again. For a standalone file, finish its writer and render that same file; this creates no document version. Preserve valid source when the cause is outside it or uncertain. Report the capture as unverified; repeating a failure is not visual evidence." };
      }
    },
  };
}

function documentFailure(cause: unknown) {
  if (cause instanceof DesignDocumentError) return { status: "rejected", code: cause.code, committed: false,
    message: cause.message.slice(0, 500), issues: cause.issues };
  throw cause;
}
