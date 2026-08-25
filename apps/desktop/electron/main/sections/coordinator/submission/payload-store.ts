/**
 * [INPUT]: Depends on Node Private atomic files IO, shared image budget, manual turnsubmission and canonical hash
 * [OUTPUT]: Provides raw submission to reset storage, opaque reference, complete hydration, ledger before crash recovery and release marker
 * [POS]: The coordinator's submission of the large payload custody; The atomic manifest itself is also a reservation
 */

import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import {
  ATTACHMENT_BYTE_LIMIT,
  ATTACHMENT_LIMIT,
  dataUrlByteSize,
  isValidImageDataUrl,
} from "../../../../../shared/agent-ipc";
import type { TrustedManualTurnSubmission as ManualTurnSubmission } from "../../../../../shared/sections-ipc";
import {
  SUBMISSION_CAPSULE_BYTE_LIMIT,
  type SubmissionErrorCode,
} from "../../../../../shared/submission";
import { canonicalHash } from "../coordinator-values";
import type { LedgerState } from "../state/ledger-schema";
import { reserveSubmission } from "../submission-outcome";

const pathSegmentSchema = z.union([
  z.string().min(1).max(512),
  z.number().int().nonnegative(),
]);
const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const manifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    intentId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
    submissionHash: digestSchema,
    value: z.unknown(),
    refs: z
      .array(
        z
          .object({
            path: z.array(pathSegmentSchema).min(1).max(64),
            digest: digestSchema,
          })
          .strict()
      )
      .max(ATTACHMENT_LIMIT * 8),
  })
  .strict();
const releaseMarkerSchema = z
  .object({
    schemaVersion: z.literal(1),
    intentId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
    submissionHash: digestSchema,
  })
  .strict();

export type SubmissionPayloadReference = {
  kind: "submission-ref";
  value: {
    intentId: string;
    submissionHash: string;
  };
};

type Manifest = z.infer<typeof manifestSchema>;

export class SubmissionPayloadStore {
  constructor(readonly root: string) {}

  async initialize() {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
  }

  async put(
    submission: ManualTurnSubmission,
    submissionHash: string
  ): Promise<SubmissionPayloadReference> {
    const packed = packSubmission(submission, submissionHash);
    const target = this.directory(submission.intentId);
    const existing = await this.readManifest(target).catch((cause) => {
      if (isCode(cause, "ENOENT")) return null;
      throw cause;
    });
    if (existing) {
      assertSame(existing, submission.intentId, submissionHash);
      return reference(submission.intentId, submissionHash);
    }

    const temporary = `${target}.${randomUUID()}.tmp`;
    await mkdir(temporary, { mode: 0o700 });
    try {
      for (const [digest, dataUrl] of packed.blobs) {
        await durableFile(join(temporary, `${digest}.data-url`), dataUrl);
      }
      await durableFile(
        join(temporary, "manifest.json"),
        JSON.stringify(packed.manifest)
      );
      try {
        await rename(temporary, target);
        await fsyncDirectory(this.root);
      } catch (cause) {
        if (!isCode(cause, "EEXIST") && !isCode(cause, "ENOTEMPTY")) {
          throw cause;
        }
        const raced = await this.readManifest(target);
        assertSame(raced, submission.intentId, submissionHash);
        await rm(temporary, { recursive: true, force: true });
      }
      return reference(submission.intentId, submissionHash);
    } catch (cause) {
      await rm(temporary, { recursive: true, force: true }).catch(
        () => undefined
      );
      throw cause;
    }
  }

  async read(payload: SubmissionPayloadReference) {
    const manifest = await this.readManifest(
      this.directory(payload.value.intentId)
    );
    assertSame(
      manifest,
      payload.value.intentId,
      payload.value.submissionHash
    );
    const value = structuredClone(manifest.value);
    const cache = new Map<string, string>();
    for (const ref of manifest.refs) {
      let dataUrl = cache.get(ref.digest);
      if (!dataUrl) {
        dataUrl = await readFile(
          join(this.directory(manifest.intentId), `${ref.digest}.data-url`),
          "utf8"
        );
        if (
          digest(dataUrl) !== ref.digest ||
          !isValidImageDataUrl(dataUrl) ||
          dataUrlByteSize(dataUrl) > ATTACHMENT_BYTE_LIMIT
        ) {
          throw codedError("CUSTODY_UNAVAILABLE");
        }
        cache.set(ref.digest, dataUrl);
      }
      installAtPath(value, ref.path, dataUrl);
    }
    const submission = value as ManualTurnSubmission;
    if (
      submission.intentId !== manifest.intentId ||
      canonicalHash(submission) !== manifest.submissionHash
    ) {
      throw codedError("CUSTODY_UNAVAILABLE");
    }
    return submission;
  }

  readReservation(payload: unknown): Promise<ManualTurnSubmission> {
    if (isSubmissionPayloadReference(payload)) return this.read(payload);
    if (
      payload &&
      typeof payload === "object" &&
      "kind" in payload &&
      payload.kind === "submission" &&
      "value" in payload
    ) {
      return Promise.resolve(payload.value as ManualTurnSubmission);
    }
    return Promise.reject(codedError("CUSTODY_UNAVAILABLE"));
  }

  async remove(intentId: string) {
    await rm(this.directory(intentId), { recursive: true, force: true });
    await fsyncDirectory(this.root);
  }

  async markReleased(intentId: string) {
    const manifest = await this.readManifest(this.directory(intentId)).catch(
      (cause) => {
        if (isCode(cause, "ENOENT")) return null;
        throw cause;
      }
    );
    if (!manifest) return false;
    await durableReplace(
      this.releaseMarker(intentId),
      JSON.stringify(
        releaseMarkerSchema.parse({
          schemaVersion: 1,
          intentId,
          submissionHash: manifest.submissionHash,
        })
      )
    );
    await this.remove(intentId);
    return true;
  }

  async finishRelease(intentId: string, submissionHash?: string) {
    const current = submissionHash
      ? await this.readManifest(this.directory(intentId)).catch(() => null)
      : null;
    if (!submissionHash || current?.submissionHash === submissionHash) {
      await this.remove(intentId);
    }
    await rm(this.releaseMarker(intentId), { force: true });
    await fsyncDirectory(this.root);
  }

  async recoverLedgerState(state: LedgerState, now: number) {
    const markers = await this.readReleaseMarkers();
    const released = new Map(
      markers.map((marker) => [marker.intentId, marker.submissionHash])
    );
    const cleanup = new Set<string>();
    for (const marker of markers) {
      const reservation = state.submissionReservations[marker.intentId];
      // admitted reservation 的 custody 已进 ledger intent：残留 marker
      //（release 与 promote 竞态）不得反向删除已录取的 reservation。
      if (
        reservation?.submissionHash === marker.submissionHash &&
        reservation.state !== "admitted"
      ) {
        delete state.submissionReservations[marker.intentId];
      }
    }
    for (const recovered of await this.recoverableReservations()) {
      const { submission, payload } = recovered;
      if (released.get(submission.intentId) === payload.value.submissionHash) {
        cleanup.add(submission.intentId);
        continue;
      }
      const existing = state.submissionReservations[submission.intentId];
      if (!existing) {
        // 孤儿 manifest 重放可因配额/冲突失败：留守磁盘下次收敛，
        // 绝不允许一个用户可达的残留把整个应用启动打死。
        try {
          reserveSubmission(
            state,
            {
              intentId: submission.intentId,
              conversationId: submissionConversationId(submission),
              submissionHash: payload.value.submissionHash,
              payload,
            },
            now
          );
        } catch (cause) {
          console.warn(
            `[submission] reservation ${submission.intentId} 恢复失败，留守待重试`,
            cause
          );
        }
        continue;
      }
      if (
        existing.state === "released" &&
        isSubmissionPayloadReference(existing.payload)
      ) {
        assertReservationMatches(existing, submission, payload);
        continue;
      }
      if (
        existing.state !== "reserved"
      ) {
        cleanup.add(submission.intentId);
        continue;
      }
      if (existing.payload === undefined) {
        existing.payload = payload;
        existing.updatedAt = now;
      } else if (!isSubmissionPayloadReference(existing.payload)) {
        cleanup.add(submission.intentId);
        continue;
      }
      if (
        existing.submissionHash !== payload.value.submissionHash ||
        existing.conversationId !== submissionConversationId(submission)
      ) {
        throw codedError("RESERVATION_CONFLICT");
      }
    }
    return async () => {
      for (const intentId of cleanup) await this.remove(intentId);
      for (const marker of markers) {
        await this.finishRelease(marker.intentId, marker.submissionHash);
      }
      await this.removeTemporaryDirectories();
    };
  }

  async prepareExpiredReleases(state: LedgerState, now: number) {
    const expired = Object.values(state.submissionReservations).filter(
      (reservation) => {
        const capsule = state.retryCapsules[reservation.intentId];
        return (
          reservation.state === "released" &&
          isSubmissionPayloadReference(reservation.payload) &&
          (!capsule || capsule.expiresAt <= now)
        );
      }
    );
    await Promise.all(
      expired.map((reservation) =>
        this.markReleased(reservation.intentId)
      )
    );
    return async () => {
      const results = await Promise.allSettled(
        expired.map((reservation) =>
          this.finishRelease(
            reservation.intentId,
            reservation.submissionHash
          )
        )
      );
      for (const result of results) {
        if (result.status === "rejected") {
          console.warn("[submission-custody] release marker 清理失败", result.reason);
        }
      }
    };
  }

  private async recoverableReservations() {
    const recovered: Array<{
      submission: ManualTurnSubmission;
      payload: SubmissionPayloadReference;
    }> = [];
    for (const entry of await readdir(this.root, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.includes(".tmp")) continue;
      try {
        const manifest = await this.readManifest(join(this.root, entry.name));
        const payload = reference(manifest.intentId, manifest.submissionHash);
        recovered.push({ submission: await this.read(payload), payload });
      } catch (cause) {
        console.warn("[submission-custody] 保留无法判定的 payload", cause);
      }
    }
    return recovered;
  }

  private async readReleaseMarkers() {
    const markers: Array<z.infer<typeof releaseMarkerSchema>> = [];
    for (const entry of await readdir(this.root, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".released.json")) continue;
      try {
        markers.push(
          releaseMarkerSchema.parse(
            JSON.parse(await readFile(join(this.root, entry.name), "utf8"))
          )
        );
      } catch (cause) {
        console.warn("[submission-custody] 保留损坏 release marker", cause);
      }
    }
    return markers;
  }

  private async removeTemporaryDirectories() {
    for (const entry of await readdir(this.root, { withFileTypes: true })) {
      if (!entry.isDirectory() || !entry.name.includes(".tmp")) continue;
      await rm(join(this.root, entry.name), { recursive: true, force: true });
    }
    await fsyncDirectory(this.root);
  }

  private directory(intentId: string) {
    return join(this.root, storageKey(intentId));
  }

  private releaseMarker(intentId: string) {
    return join(this.root, `${storageKey(intentId)}.released.json`);
  }

  private async readManifest(directory: string) {
    return manifestSchema.parse(
      JSON.parse(await readFile(join(directory, "manifest.json"), "utf8"))
    );
  }
}

export function isSubmissionPayloadReference(
  value: unknown
): value is SubmissionPayloadReference {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const payload = value as {
    kind?: unknown;
    value?: { intentId?: unknown; submissionHash?: unknown };
  };
  return (
    payload.kind === "submission-ref" &&
    typeof payload.value?.intentId === "string" &&
    typeof payload.value.submissionHash === "string"
  );
}

export function submissionConversationId(submission: ManualTurnSubmission) {
  return submission.persistence.kind === "append"
    ? submission.persistence.input.chatId
    : submission.persistence.input.id;
}

function assertReservationMatches(
  existing: {
    submissionHash: string;
    conversationId: string;
  },
  submission: ManualTurnSubmission,
  payload: SubmissionPayloadReference
) {
  if (
    existing.submissionHash !== payload.value.submissionHash ||
    existing.conversationId !== submissionConversationId(submission)
  ) {
    throw codedError("RESERVATION_CONFLICT");
  }
}

function packSubmission(
  submission: ManualTurnSubmission,
  submissionHash: string
) {
  const refs: Manifest["refs"] = [];
  const blobs = new Map<string, string>();
  const value = extractDataUrls(submission, [], refs, blobs);
  const manifest = manifestSchema.parse({
    schemaVersion: 1,
    intentId: submission.intentId,
    submissionHash,
    value,
    refs,
  });
  if (
    Buffer.byteLength(JSON.stringify(manifest), "utf8") >
    SUBMISSION_CAPSULE_BYTE_LIMIT
  ) {
    throw codedError("CAPSULE_LIMIT");
  }
  if (blobs.size > ATTACHMENT_LIMIT) throw codedError("CAPSULE_LIMIT");
  return { manifest, blobs };
}

function extractDataUrls(
  value: unknown,
  path: Array<string | number>,
  refs: Manifest["refs"],
  blobs: Map<string, string>
): unknown {
  if (typeof value === "string" && value.startsWith("data:image/")) {
    if (
      !isValidImageDataUrl(value) ||
      dataUrlByteSize(value) > ATTACHMENT_BYTE_LIMIT
    ) {
      throw codedError("CAPSULE_LIMIT");
    }
    const hash = digest(value);
    blobs.set(hash, value);
    refs.push({ path, digest: hash });
    return null;
  }
  if (Array.isArray(value)) {
    return value.map((item, index) =>
      extractDataUrls(item, [...path, index], refs, blobs)
    );
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        extractDataUrls(item, [...path, key], refs, blobs),
      ])
    );
  }
  return value;
}

function installAtPath(
  root: unknown,
  path: Array<string | number>,
  value: string
) {
  let cursor = root;
  for (const [index, segment] of path.entries()) {
    if (
      typeof segment === "string" &&
      ["__proto__", "constructor", "prototype"].includes(segment)
    ) {
      throw codedError("CUSTODY_UNAVAILABLE");
    }
    if (!cursor || typeof cursor !== "object") {
      throw codedError("CUSTODY_UNAVAILABLE");
    }
    if (index === path.length - 1) {
      (cursor as Record<string | number, unknown>)[segment] = value;
      return;
    }
    cursor = (cursor as Record<string | number, unknown>)[segment];
  }
  throw codedError("CUSTODY_UNAVAILABLE");
}

function reference(
  intentId: string,
  submissionHash: string
): SubmissionPayloadReference {
  return {
    kind: "submission-ref",
    value: { intentId, submissionHash },
  };
}

function assertSame(
  manifest: Manifest,
  intentId: string,
  submissionHash: string
) {
  if (
    manifest.intentId !== intentId ||
    manifest.submissionHash !== submissionHash
  ) {
    throw codedError("RESERVATION_CONFLICT");
  }
}

function storageKey(intentId: string) {
  return digest(intentId);
}

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

async function durableFile(path: string, content: string) {
  const file = await open(path, "wx", 0o600);
  try {
    await file.writeFile(content);
    await file.sync();
  } finally {
    await file.close();
  }
}

async function durableReplace(path: string, content: string) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  await durableFile(temporary, content);
  await rename(temporary, path);
  await fsyncDirectory(dirname(path));
}

async function fsyncDirectory(path: string) {
  const directory = await open(path, "r");
  try {
    await directory.sync();
  } catch (cause) {
    if (!isCode(cause, "EINVAL") && !isCode(cause, "ENOTSUP")) throw cause;
  } finally {
    await directory.close();
  }
}

function isCode(cause: unknown, code: string) {
  return (
    cause instanceof Error &&
    "code" in cause &&
    (cause as NodeJS.ErrnoException).code === code
  );
}

function codedError(code: SubmissionErrorCode) {
  return Object.assign(new Error(code), { code });
}
