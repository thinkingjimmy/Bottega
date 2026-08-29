/**
 * [INPUT]: Depends on durable PreparedManualTurn shapes, workspace/submission schemas, sealed Project Tools hydration, canonical backend runtime identity, staged blob bytes, and shared staging custody
 * [OUTPUT]: Provides PreparedManualTurn hydration into canonical submission, resolved Agent input, runtime-reprojected frozen Project Tools, and static custody-backed release
 * [POS]: Prepared admission read boundary; the sibling staging primitive owns integrity/release while prepared-manual-turn owns writes
 */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type {
  AgentSendPayload,
  AgentUserInput,
} from "../../../../../../shared/agent-ipc";
import type {
  TrustedManualTurnPersistence as ManualTurnPersistence,
  TrustedManualTurnSubmission as ManualTurnSubmission,
} from "../../../../../../shared/sections-ipc";
import { workspacePreconditionSchema } from "../../../../../../shared/submission";
import type { ResolvedAgentInput } from "../../../../backends/types";
import { backendRuntimeRegistry } from "../../../../backends";
import { hydrateProjectToolsReceipt } from "../prepared-project-tools";
import type { PreparedManualTurn } from "../prepared-manual-turn";
import {
  assertPreparedContentHash,
  releasePreparedStaging,
} from "./staging";

type PreparedBlob = Extract<
  PreparedManualTurn["input"][number],
  { blob: unknown }
>["blob"];

const digest = (content: Uint8Array) =>
  createHash("sha256").update(content).digest("hex");

export type ProjectToolsRuntimeIdentityResolver = (
  backendId: AgentSendPayload["turnOptions"]["backend"]
) => Promise<string | undefined>;

export async function resolveProjectToolsRuntimeIdentity(
  backendId: AgentSendPayload["turnOptions"]["backend"]
) {
  const runtime = await backendRuntimeRegistry.resolve(backendId);
  return runtime.runtimeStatus === "installed"
    ? `${backendId}@${runtime.runtime.version}`
    : undefined;
}

export async function hydratePreparedTurn(
  prepared: PreparedManualTurn,
  resolveRuntimeIdentity: ProjectToolsRuntimeIdentityResolver =
    resolveProjectToolsRuntimeIdentity
) {
  assertPreparedContentHash(prepared);
  if (
    !("lifecycleProjectId" in prepared) ||
    (prepared.lifecycleProjectId !== null &&
      !/^[A-Za-z0-9_-]{1,128}$/.test(prepared.lifecycleProjectId))
  ) {
    throw new Error("PreparedManualTurn 缺少合法 lifecycle Project 身份");
  }
  const workspacePrecondition = workspacePreconditionSchema.parse(
    prepared.workspacePrecondition
  );
  const backendId = prepared.turn.turnOptions.backend;
  const backendRuntimeIdentity = await resolveRuntimeIdentity(backendId);
  const projectTools = await hydrateProjectToolsReceipt(
    prepared.projectTools,
    backendId,
    Boolean(prepared.turn.planMode),
    backendRuntimeIdentity,
    prepared.stagingDir === ""
  );
  if (
    projectTools.receipt.projectContext.projectId !==
    prepared.lifecycleProjectId
  ) {
    throw new Error("PROJECT_TOOLS_LIFECYCLE_MISMATCH");
  }
  const input: AgentUserInput[] = [];
  const resolved: ResolvedAgentInput["input"] = [];
  for (const item of prepared.input) {
    if (item.type === "text") {
      if (item.originalSection) input.push(item.originalSection);
      else if (!item.resolvedOnly) input.push({ type: "text", text: item.text });
      resolved.push({ type: "text", text: item.text });
    } else if (item.type === "image") {
      const dataUrl = await blobDataUrl(item.blob);
      if (!item.resolvedOnly) {
        input.push({ type: "image", dataUrl, filename: item.blob.filename });
      }
      resolved.push({
        type: "image",
        dataUrl,
        filename: item.blob.filename,
        ...(item.resolvedOnly ? { resolvedOnly: true as const } : {}),
      });
    } else {
      if (!item.resolvedOnly) {
        input.push({ type: "text", text: `${item.name}（staged resource）` });
      }
      resolved.push({ type: item.type, name: item.name, path: item.blob.path });
    }
  }
  return {
    submission: {
      intentId: prepared.intentId,
      persistence: await hydratePersistence(prepared.persistence),
      content: prepared.content,
      precondition: prepared.precondition,
      workspacePrecondition,
      turn: { ...prepared.turn, input },
    } satisfies ManualTurnSubmission,
    resolvedInput: {
      input: resolved,
      commit() {},
      rollback() {},
      release: () => releasePreparedStaging(prepared),
    } satisfies ResolvedAgentInput,
    projectTools,
  };
}

async function hydratePersistence(
  persistence: PreparedManualTurn["persistence"]
): Promise<ManualTurnPersistence> {
  const payloads = await Promise.all(
    (persistence.input.attachmentPayloads ?? []).map(async (blob) => ({
      filename: blob.filename,
      mediaType: blob.mediaType,
      dataUrl: await blobDataUrl(blob),
    }))
  );
  const input = {
    ...persistence.input,
    attachmentPayloads:
      persistence.kind === "append" && persistence.input.revise
        ? undefined
        : payloads.length
          ? payloads
          : undefined,
  };
  return { kind: persistence.kind, input } as ManualTurnPersistence;
}

async function blobDataUrl(blob: PreparedBlob) {
  const content = await readFile(blob.path);
  if (digest(content) !== blob.sha256) throw new Error("staged blob hash 冲突");
  return `data:${blob.mediaType};base64,${content.toString("base64")}`;
}
