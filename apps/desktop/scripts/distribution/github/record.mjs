/**
 * [INPUT]: Canonical public build identities, exact installer/update bytes and the shared update-feed verifier.
 * [OUTPUT]: Closed personal v1 and official-macos v2 build records, combined subject inventories and exact installer/feed verification without smoke claims.
 * [POS]: Production interchange contract consumed by draft upload and private acceptance.
 */
import assert from "node:assert/strict";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { verifyUpdateFeed } from "../../verify-update-feed.mjs";
import { canonicalJson, hashFile, PRODUCTION_CLOUD, PUBLIC_REPOSITORY, PUBLIC_WORKFLOW } from "./identity.mjs";

const OID = /^[a-f0-9]{40}$/, DIGEST = /^sha256:[a-f0-9]{64}$/, VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const TOP_KEYS = ["schema", "repository", "delivery", "tag", "version", "profile", "buildId", "startedAt", "completedAt", "source",
  "configuration", "payloadDigest", "workflow", "runner", "assets"];
const positive = value => Number.isSafeInteger(value) && value > 0;
function keys(value, expected, description) {
  assert(value && typeof value === "object" && !Array.isArray(value), `Invalid ${description}`);
  assert.deepEqual(Object.keys(value).sort(), [...expected].sort(), `Unexpected ${description} fields`);
}

export function assertGithubBuildProfile(profile) {
  assert(["personal", "official-macos"].includes(profile), "Expected personal or official-macos GitHub profile");
  return profile;
}

export function githubUpdateAssetSpecs(version) {
  assert(VERSION.test(version), "Invalid update asset version");
  return [
    { id: "darwin-arm64.feed", name: "latest-mac.yml" },
    { id: "darwin-arm64.dmg.blockmap", name: `Bottega-${version}-arm64.dmg.blockmap` },
    { id: "darwin-arm64.zip.blockmap", name: `Bottega-${version}-arm64-mac.zip.blockmap` },
  ];
}

function assertAssets(assets, expected, description) {
  assert(Array.isArray(assets) && assets.length === expected.length, `Unexpected ${description} count`);
  assets.forEach((asset, index) => {
    keys(asset, ["id", "name", "bytes", "sha256"], description);
    assert.equal(asset.id, expected[index].id); assert.equal(asset.name, expected[index].name);
    assert(positive(asset.bytes) && DIGEST.test(asset.sha256), `Invalid ${description} bytes/digest`);
  });
}

export function assertGithubBuildRecord(record) {
  const official = record?.profile === "official-macos";
  keys(record, official ? [...TOP_KEYS, "updateAssets"] : TOP_KEYS, "GitHub build record");
  assert.equal(record.schema, official ? "bottega.github-build/v2" : "bottega.github-build/v1");
  assert.equal(record.repository, PUBLIC_REPOSITORY);
  assert(["artifact", "draft"].includes(record.delivery), "Invalid GitHub build delivery");
  assert(VERSION.test(record.version) && record.tag === `v${record.version}`, "Build version/tag mismatch");
  assertGithubBuildProfile(record.profile);
  assert(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(record.buildId), "Invalid build id");
  assert(positive(record.startedAt) && positive(record.completedAt) && record.startedAt <= record.completedAt, "Invalid build interval");
  keys(record.source, ["commit", "tree", "digest", "dirty"], "public build source");
  assert(OID.test(record.source.commit) && OID.test(record.source.tree) && DIGEST.test(record.source.digest), "Invalid public source identity");
  assert.equal(record.source.dirty, false, "Public build source must be clean");
  keys(record.configuration, ["workbenchUi", "cloud", "builder", "digest", "signing"], "public build configuration");
  assert.equal(record.configuration.workbenchUi, true); assert.deepEqual(record.configuration.cloud, PRODUCTION_CLOUD);
  assert.equal(record.configuration.builder, "electron-builder.yml");
  assert(["ad-hoc-unnotarized", "developer-id-notarized"].includes(record.configuration.signing), "Invalid GitHub signing claim");
  if (record.delivery === "draft") assert.equal(record.configuration.signing, "developer-id-notarized", "Draft delivery requires Developer ID notarization");
  if (official) assert.equal(record.configuration.signing, "developer-id-notarized", "Official macOS requires Developer ID notarization");
  assert(DIGEST.test(record.configuration.digest) && DIGEST.test(record.payloadDigest), "Invalid configuration/payload digest");
  keys(record.workflow, ["path", "runId", "runAttempt", "ref", "sha"], "GitHub workflow identity");
  assert.equal(record.workflow.path, PUBLIC_WORKFLOW);
  assert.equal(record.workflow.ref, `${PUBLIC_REPOSITORY}/${PUBLIC_WORKFLOW}@refs/heads/main`);
  assert.equal(record.workflow.sha, record.source.commit, "Workflow must come from the exact build commit");
  assert(positive(record.workflow.runId) && positive(record.workflow.runAttempt), "Invalid GitHub run identity");
  keys(record.runner, ["platform", "node", "pnpm"], "GitHub build toolchain");
  assert.equal(record.runner.platform, "darwin-arm64");
  assert(/^v24\.\d+\.\d+$/.test(record.runner.node) && /^\d+\.\d+\.\d+$/.test(record.runner.pnpm), "Invalid build toolchain pin");
  assertAssets(record.assets, [
    { id: "darwin-arm64.dmg", name: `Bottega-${record.version}-arm64.dmg` },
    { id: "darwin-arm64.zip", name: `Bottega-${record.version}-arm64-mac.zip` },
  ], "installer");
  if (official) assertAssets(record.updateAssets, githubUpdateAssetSpecs(record.version), "update asset");
  return record;
}

export function githubBuildAssets(record) {
  assertGithubBuildRecord(record);
  return [...record.assets, ...(record.updateAssets ?? [])];
}

export function readGithubBuildRecord(path) {
  const stat = lstatSync(path); assert(stat.isFile() && stat.size <= 128 * 1024, "Invalid GitHub build record file");
  const bytes = readFileSync(path, "utf8"), record = JSON.parse(bytes);
  assert.equal(bytes, canonicalJson(record), "GitHub build record must be canonical JSON");
  return assertGithubBuildRecord(record);
}

export function verifyGithubAssets(directory, record, { provenance = true } = {}) {
  const assets = githubBuildAssets(record);
  for (const asset of assets) {
    const path = join(directory, asset.name), stat = lstatSync(path);
    assert(stat.isFile() && stat.size === asset.bytes && hashFile(path) === asset.sha256, `Changed candidate asset: ${asset.name}`);
  }
  if (record.profile === "official-macos") {
    const feed = verifyUpdateFeed({ root: directory, expectedVersion: record.version, channel: "latest", platform: "darwin" });
    assert.deepEqual([...feed.assets].sort(), record.assets.map(asset => asset.name).sort(), "Update feed must name exactly the accepted DMG and ZIP");
  }
  if (provenance) {
    const names = [...assets.map(asset => asset.name), "github-build.json", "build-provenance.jsonl"].sort();
    assert.deepEqual(readdirSync(directory).sort(), names, "Unexpected candidate files");
    const path = join(directory, "build-provenance.jsonl"), stat = lstatSync(path);
    assert(stat.isFile() && stat.size > 0 && stat.size <= 1024 * 1024, "Missing build provenance bundle");
    const bundle = JSON.parse(readFileSync(path, "utf8"));
    assert(bundle.mediaType && bundle.verificationMaterial && bundle.dsseEnvelope, "Invalid build provenance bundle");
  }
  return record.assets;
}
