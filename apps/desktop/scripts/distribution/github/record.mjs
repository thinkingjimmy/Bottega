/**
 * [INPUT]: Canonical public build identities and exact installer filesystem bytes.
 * [OUTPUT]: Strict GitHub build records and installer-set verification without smoke claims.
 * [POS]: Production interchange contract consumed by draft upload and private acceptance.
 */
import assert from "node:assert/strict";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { canonicalJson, hashFile, PRODUCTION_CLOUD, PUBLIC_REPOSITORY, PUBLIC_WORKFLOW } from "./identity.mjs";

const OID = /^[a-f0-9]{40}$/, DIGEST = /^sha256:[a-f0-9]{64}$/, VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const TOP_KEYS = ["schema", "repository", "delivery", "tag", "version", "profile", "buildId", "startedAt", "completedAt", "source",
  "configuration", "payloadDigest", "workflow", "runner", "assets"];
const positive = value => Number.isSafeInteger(value) && value > 0;
function keys(value, expected, description) {
  assert(value && typeof value === "object" && !Array.isArray(value), `Invalid ${description}`);
  assert.deepEqual(Object.keys(value).sort(), [...expected].sort(), `Unexpected ${description} fields`);
}

export function assertGithubBuildRecord(record) {
  keys(record, TOP_KEYS, "GitHub build record");
  assert.equal(record.schema, "bottega.github-build/v1"); assert.equal(record.repository, PUBLIC_REPOSITORY);
  assert(["artifact", "draft"].includes(record.delivery), "Invalid GitHub build delivery");
  assert(VERSION.test(record.version) && record.tag === `v${record.version}`, "Build version/tag mismatch");
  assert.equal(record.profile, "personal", "GitHub production build requires the explicit personal profile");
  assert(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(record.buildId), "Invalid build id");
  assert(positive(record.startedAt) && positive(record.completedAt) && record.startedAt <= record.completedAt, "Invalid build interval");
  keys(record.source, ["commit", "tree", "digest", "dirty"], "public build source");
  assert(OID.test(record.source.commit) && OID.test(record.source.tree) && DIGEST.test(record.source.digest), "Invalid public source identity");
  assert.equal(record.source.dirty, false, "Public build source must be clean");
  keys(record.configuration, ["workbenchUi", "cloud", "builder", "digest", "signing"], "public build configuration");
  assert.equal(record.configuration.workbenchUi, true); assert.deepEqual(record.configuration.cloud, PRODUCTION_CLOUD);
  assert.equal(record.configuration.builder, "electron-builder.yml"); assert.equal(record.configuration.signing, "ad-hoc-unnotarized");
  assert(DIGEST.test(record.configuration.digest) && DIGEST.test(record.payloadDigest), "Invalid configuration/payload digest");
  keys(record.workflow, ["path", "runId", "runAttempt", "ref", "sha"], "GitHub workflow identity");
  assert.equal(record.workflow.path, PUBLIC_WORKFLOW);
  assert.equal(record.workflow.ref, `${PUBLIC_REPOSITORY}/${PUBLIC_WORKFLOW}@refs/heads/main`);
  assert.equal(record.workflow.sha, record.source.commit, "Workflow must come from the exact build commit");
  assert(positive(record.workflow.runId) && positive(record.workflow.runAttempt), "Invalid GitHub run identity");
  keys(record.runner, ["platform", "node", "pnpm"], "GitHub build toolchain");
  assert.equal(record.runner.platform, "darwin-arm64");
  assert(/^v24\.\d+\.\d+$/.test(record.runner.node) && /^\d+\.\d+\.\d+$/.test(record.runner.pnpm), "Invalid build toolchain pin");
  assert(Array.isArray(record.assets) && record.assets.length === 2, "GitHub build requires exactly DMG and ZIP");
  const expected = [["darwin-arm64.dmg", `Bottega-${record.version}-arm64.dmg`], ["darwin-arm64.zip", `Bottega-${record.version}-arm64-mac.zip`]];
  record.assets.forEach((asset, index) => {
    keys(asset, ["id", "name", "bytes", "sha256"], "installer");
    assert.equal(asset.id, expected[index][0]); assert.equal(asset.name, expected[index][1]);
    assert(positive(asset.bytes) && DIGEST.test(asset.sha256), "Invalid installer bytes/digest");
  });
  return record;
}

export function readGithubBuildRecord(path) {
  const stat = lstatSync(path); assert(stat.isFile() && stat.size <= 128 * 1024, "Invalid GitHub build record file");
  const bytes = readFileSync(path, "utf8"), record = JSON.parse(bytes);
  assert.equal(bytes, canonicalJson(record), "GitHub build record must be canonical JSON");
  return assertGithubBuildRecord(record);
}

export function verifyGithubAssets(directory, record, { provenance = true } = {}) {
  assertGithubBuildRecord(record);
  for (const asset of record.assets) {
    const path = join(directory, asset.name), stat = lstatSync(path);
    assert(stat.isFile() && stat.size === asset.bytes && hashFile(path) === asset.sha256, `Changed installer: ${asset.name}`);
  }
  if (provenance) {
    const names = [...record.assets.map(asset => asset.name), "github-build.json", "build-provenance.jsonl"].sort();
    assert.deepEqual(readdirSync(directory).sort(), names, "Unexpected candidate files");
    const path = join(directory, "build-provenance.jsonl"), stat = lstatSync(path);
    assert(stat.isFile() && stat.size > 0 && stat.size <= 1024 * 1024, "Missing build provenance bundle");
    const bundle = JSON.parse(readFileSync(path, "utf8"));
    assert(bundle.mediaType && bundle.verificationMaterial && bundle.dsseEnvelope, "Invalid build provenance bundle");
  }
  return record.assets;
}
