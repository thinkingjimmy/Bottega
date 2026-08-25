/**
 * [INPUT]: Depends on ACP ContentBlock, back-end structured input and error grouping tool
 * [OUTPUT]: Provides input block conversion, steering outcome, overtime stop loss requests and obstacles to flight operation
 * [POS]: The ACP turn transport's steering core is unstable; AcpTurn only holds session lifecycle and call times
 */

import type { ContentBlock } from "@agentclientprotocol/sdk";
import { asError } from "../../../errors";
import type {
  AdapterSteerOutcome,
  BackendTurnOptions,
} from "../../types";

const STEER_TIMEOUT_MS = 10_000;

export function resolvedInputBlocks(
  input: BackendTurnOptions["input"]["input"]
): ContentBlock[] {
  const result: ContentBlock[] = [];
  for (const item of input) {
    if (item.type === "text") {
      result.push({ type: "text", text: item.text });
      continue;
    }
    if (item.type === "image") {
      const match = /^data:([^;,]+);base64,(.+)$/s.exec(item.dataUrl);
      if (!match) throw new Error("ACP 图片输入格式无效");
      result.push({ type: "image", mimeType: match[1], data: match[2] });
      continue;
    }
    result.push({
      type: "resource_link",
      uri: `file://${encodeURI(item.path)}`,
      name: item.name,
      ...(item.type === "skill"
        ? { description: "必须读取并遵循的 SKILL.md" }
        : { description: "用户显式引用的上下文文件" }),
    });
  }
  return result;
}

export function normalizeSteerOutcome(value: unknown): AdapterSteerOutcome {
  const outcome =
    value && typeof value === "object"
      ? (value as { outcome?: unknown }).outcome
      : undefined;
  if (outcome === "injected") return { outcome: "injected" };
  if (outcome === "promptRequired") {
    return { outcome: "unconsumed", reason: "promptRequired" };
  }
  if (outcome === "startedNewTurn" || outcome === "failed") {
    return {
      outcome: "ambiguous",
      reason:
        outcome === "startedNewTurn"
          ? "adapter started a detached turn"
          : "adapter could not prove whether steering was consumed",
    };
  }
  return {
    outcome: "ambiguous",
    reason: `unknown steering outcome: ${String(outcome)}`,
  };
}

export async function requestAcpSteering(
  send: () => Promise<unknown>,
  interrupt: () => void
): Promise<AdapterSteerOutcome> {
  let timeout: NodeJS.Timeout | undefined;
  const timeoutResult = new Promise<AdapterSteerOutcome>((resolve) => {
    timeout = setTimeout(() => {
      interrupt();
      resolve({ outcome: "ambiguous", reason: "steering request timed out" });
    }, STEER_TIMEOUT_MS);
  });
  const response = send()
    .then((value) => {
      const outcome = normalizeSteerOutcome(value);
      if (outcome.outcome === "ambiguous") interrupt();
      return outcome;
    })
    .catch((cause): AdapterSteerOutcome => {
      interrupt();
      return { outcome: "ambiguous", reason: asError(cause).message };
    });
  return Promise.race([response, timeoutResult]).finally(() => {
    if (timeout) clearTimeout(timeout);
  });
}

export class SteeringOperationGate {
  private readonly operations = new Set<Promise<AdapterSteerOutcome>>();

  async run(operation: Promise<AdapterSteerOutcome>) {
    this.operations.add(operation);
    try {
      return await operation;
    } finally {
      this.operations.delete(operation);
    }
  }

  async wait() {
    if (this.operations.size) {
      await Promise.allSettled([...this.operations]);
    }
  }
}
