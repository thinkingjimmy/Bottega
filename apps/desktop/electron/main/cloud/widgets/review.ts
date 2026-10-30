/**
 * [INPUT]: Depends on verified package inventories, exact manifest bytes, public descriptor identity and authenticated delivery metadata.
 * [OUTPUT]: Provides bounded encrypted review construction, original source Chat pointers and source/manifest/contract admission without executing package code.
 * [POS]: Main-only installation review; readable metadata confers no code execution, writable source or data permission.
 */
import { z } from "zod";
import { createHash } from "node:crypto";
import {
  canonicalJson,
  hashCanonical,
} from "@bottega/contracts/core/canonical-json";
import { parseStrictJson } from "@bottega/contracts/core/canonical";
import {
  WIDGET_PACKAGE_BUDGET as BUDGET,
  widgetPackageDescriptorSchema,
  validateWidgetPackageDescriptor,
  widgetPackageReference,
  type WidgetPackageSource,
} from "@bottega/contracts/plugins/dock/packages";
import {
  assertWidgetPackageDelivery,
  type WidgetPackageDelivery,
} from "@ai-chat/cloud-protocol/widgets/model";
import { dockPluginManifestSchema } from "../../apps/gui-build/source/manifest";
import type { verifyPackage } from "../../plugins/surface-runtime/packages/codec";

const schema = z
  .object({
    schema: z.literal("bottega.widget-review/v1"),
    reference: z.string(),
    descriptor: widgetPackageDescriptorSchema,
    sourceChat:z.object({chatId:z.string().min(1).max(160)}).strict().optional(),
    manifestText: z.string().max(BUDGET.runtimeFileBytes),
  })
  .strict();
const digest = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
export function buildWidgetPackageReview(
  packet: ReturnType<typeof verifyPackage>,
  reference: string,
  sourceChat?:{chatId:string},
): Buffer {
  const entry = packet.files.find(
    (file) => file.path === "runtime/plugin.json",
  );
  if (!entry || widgetPackageReference(packet.descriptor) !== reference)
    throw new Error("WIDGET_REVIEW_SOURCE_CHANGED");
  const bytes = Buffer.from(
    canonicalJson({
      schema: "bottega.widget-review/v1",
      reference,
      descriptor: packet.descriptor,
      ...(sourceChat?{sourceChat}:{}),
      manifestText: Buffer.from(entry.content, "base64").toString("utf8"),
    }),
  );
  if (bytes.length > BUDGET.runtimeFileBytes)
    throw new Error("WIDGET_REVIEW_BUDGET");
  return bytes;
}
export function verifyWidgetPackageReview(
  bytes: Buffer,
  delivery: WidgetPackageDelivery,
  expected: WidgetPackageSource,
) {
  assertWidgetPackageDelivery(delivery, {
    accountId: expected.accountId,
    subject: {
      definitionId: expected.definitionId,
      sourceInstallationId: expected.installationId,
    },
    reference: delivery.reference,
  });
  if (
    bytes.length !== delivery.reviewBytes ||
    digest(bytes) !== delivery.reviewSha256
  )
    throw new Error("WIDGET_REVIEW_SOURCE_CHANGED");
  const review = schema.parse(
    parseStrictJson(bytes, {
      maxBytes: BUDGET.runtimeFileBytes,
      maxDepth: 16,
      maxNodes: 100000,
    }),
  );
  const descriptor = validateWidgetPackageDescriptor(review.descriptor),
    manifestBytes = Buffer.from(review.manifestText),
    entry = descriptor.files.find(
      (file) => file.path === "runtime/plugin.json",
    );
  if (
    review.reference !== delivery.reference ||
    widgetPackageReference(descriptor) !== delivery.reference ||
    canonicalJson(descriptor.source) !== canonicalJson(expected) ||
    descriptor.contractDigest !== delivery.contractDigest ||
    descriptor.source.generationId !== delivery.generationId ||
    !entry ||
    manifestBytes.length !== entry.bytes ||
    `sha256:${digest(manifestBytes)}` !== entry.sha256
  )
    throw new Error("WIDGET_REVIEW_SOURCE_CHANGED");
  const manifest = dockPluginManifestSchema.parse(
    parseStrictJson(manifestBytes, {
      maxBytes: BUDGET.runtimeFileBytes,
      maxDepth: 16,
      maxNodes: 100000,
    }),
  );
  if (
    manifest.id !== expected.definitionId ||
    descriptor.contractDigest !==
      `sha256:${hashCanonical({ dock: manifest.dock, operations: manifest.operations })}`
  )
    throw new Error("WIDGET_REVIEW_CONTRACT_CHANGED");
  return { descriptor, manifest,...(review.sourceChat?{sourceChat:review.sourceChat}:{}) };
}
