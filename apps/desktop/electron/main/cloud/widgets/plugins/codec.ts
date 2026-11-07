/**
 * [INPUT]: Depends on complete verified plugin distributions, bounded JSON decoding and authenticated encrypted Widget delivery identities.
 * [OUTPUT]: Provides full-package archive/review encoding and exact source/revision/digest admission on the existing Cloud file transport.
 * [POS]: Unified plugin wire adapter; every runtime/UI/dependency file travels together and receiver compilation is absent.
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import { canonicalJson, hashCanonical } from "@bottega/contracts/core/canonical-json";
import { parseStrictJson } from "@bottega/contracts/core/canonical";
import { unifiedPluginDistributionSchema, type UnifiedPluginDistribution } from "@bottega/contracts/plugins/platform";
import { WIDGET_PACKAGE_BUDGET as B } from "@bottega/contracts/plugins/dock/packages";
import type { WidgetPackageDelivery } from "@ai-chat/cloud-protocol/widgets/model";
import { verifyUnifiedPluginDistribution, verifyUnifiedPluginFiles } from "../../../plugins/distribution/verify";
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
export const cloudPluginReference = (distribution: UnifiedPluginDistribution) => `sha256:${hashCanonical(distribution)}`;
export const cloudPluginContract = (distribution: UnifiedPluginDistribution) => `sha256:${hashCanonical(distribution.manifest.contributions)}`;
export type FrozenCloudPluginPacket = { format: "bottega-plugin/v1"; reference: string; distribution: UnifiedPluginDistribution; bytes: Buffer };
const archive = z.object({ format: z.literal("bottega-plugin-archive/v1"), distribution: unifiedPluginDistributionSchema,
  files: z.array(z.object({ path: z.string(), content: z.string() }).strict()).max(4096) }).strict();
export function cloudPluginReview(distribution: UnifiedPluginDistribution) {
  const bytes = Buffer.from(canonicalJson({ format: "bottega-plugin-review/v1", distribution }));
  if (bytes.length > B.runtimeFileBytes) throw new Error("Plugin review exceeds the encrypted transfer budget"); return bytes;
}
export async function freezeCloudPluginPacket(directory: string): Promise<FrozenCloudPluginPacket> {
  const checked = await verifyUnifiedPluginDistribution(directory);
  const bytes = Buffer.from(canonicalJson({ format: "bottega-plugin-archive/v1", distribution: checked.distribution,
    files: [...checked.files].filter(([path]) => path !== "plugin-package.json").map(([path, content]) => ({ path, content: content.toString("base64") })) }));
  if (bytes.length > B.packageBytes) throw new Error("Plugin package exceeds the current encrypted transfer cap");
  return { format: "bottega-plugin/v1", reference: checked.packageDigest, distribution: checked.distribution, bytes };
}
export function verifyCloudPluginArchive(bytes: Buffer, reference: string) {
  const packet = archive.parse(parseStrictJson(bytes, { maxBytes: B.packageBytes, maxDepth: 32, maxNodes: 500_000 }));
  if (cloudPluginReference(packet.distribution) !== reference) throw new Error("Plugin package reference changed");
  const files = new Map<string, Buffer>();
  for (const file of packet.files) {
    if (files.has(file.path)) throw new Error("Duplicate plugin package file");
    const content = Buffer.from(file.content, "base64"); if (content.toString("base64") !== file.content) throw new Error("Invalid plugin package bytes");
    files.set(file.path, content);
  }
  files.set("plugin-package.json", Buffer.from(JSON.stringify(packet.distribution, null, 2) + "\n"));
  return verifyUnifiedPluginFiles(files);
}
export function verifyCloudPluginReview(bytes: Buffer, delivery: WidgetPackageDelivery) {
  if (delivery.format !== "bottega-plugin/v1" || bytes.length !== delivery.reviewBytes || digest(bytes) !== delivery.reviewSha256) throw new Error("Plugin review delivery changed");
  const value = z.object({ format: z.literal("bottega-plugin-review/v1"), distribution: unifiedPluginDistributionSchema }).strict().parse(parseStrictJson(bytes, { maxBytes: B.runtimeFileBytes, maxDepth: 32, maxNodes: 500_000 }));
  const distribution = value.distribution;
  if (cloudPluginReference(distribution) !== delivery.reference || distribution.pluginId !== delivery.subject.definitionId || distribution.revisionId !== delivery.generationId || cloudPluginContract(distribution) !== delivery.contractDigest) throw new Error("Plugin review source or revision changed");
  return { delivery, distribution, manifest: distribution.manifest };
}
