/**
 * [INPUT]: Canonical GitHub build/provenance bytes, exact installers/update assets, physical CLI identity, GitHub context and complete release discovery/pinned-ID readback from release.mjs.
 * [OUTPUT]: Uploads immutable candidate bytes only to a profile-matched unpublished draft and reports exact asset custody; personal is prerelease, official-macos is stable.
 * [POS]: Production cloud-side upload boundary; it never publishes, clobbers assets, signs, or rebuilds. It accepts only a Developer ID notarized draft record.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, lstatSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { assertGithubContext } from "./build.mjs";
import { canonicalJson, hashFile, publicConfigurationIdentity, PUBLIC_REPOSITORY } from "./identity.mjs";
import { githubBuildAssets, readGithubBuildRecord, verifyGithubAssets } from "./record.mjs";
import { findGithubRelease, readGithubRelease } from "./release.mjs";

function gh(args) {
  const result = spawnSync("gh", args, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  if (result.error) throw result.error; return result;
}
function readJson(args) {
  const result = gh(args);
  assert.equal(result.status, 0, `GitHub read failed: ${args.join(" ")}`); return JSON.parse(result.stdout);
}
const jsonApi = endpoint => readJson(["api", endpoint]);
function validateDraft(release, record) {
  assert(release && release.draft === true && release.prerelease === (record.profile === "personal"), "Only an unpublished draft matching the build profile may receive candidate bytes");
  assert.equal(release.tag_name, record.tag, "Draft tag mismatch");
  assert.equal(release.target_commitish, record.source.commit, "Draft source commit mismatch");
  assert(Array.isArray(release.assets), "Draft asset inventory is unavailable");
  const ids = release.assets.map(asset => asset.id), names = release.assets.map(asset => asset.name);
  assert(ids.every(id => Number.isSafeInteger(id) && id > 0) && new Set(ids).size === ids.length && new Set(names).size === names.length,
    "Duplicate or invalid draft assets");
  return release;
}
function sameAsset(asset, expected) {
  assert(asset.state === "uploaded" && asset.size === expected.bytes && asset.digest === expected.sha256, `Conflicting draft asset: ${expected.name}`);
}
function verifyRemoteAsset(record, releaseId, asset, expected) {
  sameAsset(asset, expected);
  const directory = mkdtempSync(join(tmpdir(), "bottega-draft-readback-"));
  const result = gh(["release", "download", record.tag, "--repo", PUBLIC_REPOSITORY, "--pattern", expected.name, "--dir", directory]);
  assert.equal(result.status, 0, `Exact-byte draft readback failed: ${expected.name}`);
  const path = join(directory, expected.name), stat = lstatSync(path);
  assert(stat.isFile() && stat.size === expected.bytes && hashFile(path) === expected.sha256, `Downloaded draft bytes differ: ${expected.name}`);
  const current = validateDraft(readGithubRelease(releaseId, record.tag, readJson), record).assets.find(item => item.name === expected.name);
  assert(current && current.id === asset.id, `Draft asset identity changed during readback: ${expected.name}`); sameAsset(current, expected);
  return { id: asset.id, name: expected.name, bytes: expected.bytes, sha256: expected.sha256 };
}
function verifyTag(record) {
  const ref = jsonApi(`repos/${PUBLIC_REPOSITORY}/git/ref/tags/${record.tag}`);
  let object = ref.object;
  const seen = new Set();
  while (object?.type === "tag") {
    assert(/^[a-f0-9]{40}$/.test(object.sha) && !seen.has(object.sha), "Invalid annotated release tag");
    seen.add(object.sha); object = jsonApi(`repos/${PUBLIC_REPOSITORY}/git/tags/${object.sha}`).object;
  }
  assert(object?.type === "commit" && object.sha === record.source.commit, "Release tag must already exist at the exact public source commit");
}
function cleanupTransfer(record, custody) {
  const raw = process.env.BOTTEGA_PUBLIC_TRANSFER_ARTIFACT_ID;
  if (!raw) return null;
  assert(/^[1-9]\d*$/.test(raw) && Number.isSafeInteger(Number(raw)), "Invalid transfer artifact id");
  const id = Number(raw), endpoint = `repos/${PUBLIC_REPOSITORY}/actions/artifacts/${id}`;
  const result = gh(["api", endpoint]);
  if (result.status !== 0) return { id, status: /\bHTTP[\s:(]+404\b/.test(result.stderr) ? "absent" : "retained", custody };
  const artifact = JSON.parse(result.stdout);
  const expectedDigest = process.env.BOTTEGA_PUBLIC_TRANSFER_ARTIFACT_DIGEST;
  assert.equal(artifact.id, id); assert.equal(artifact.name, `macos-arm64-candidate-${record.workflow.runId}`);
  assert.equal(artifact.workflow_run?.id, record.workflow.runId); assert.equal(artifact.workflow_run?.head_sha, record.source.commit);
  assert.equal(artifact.digest, `sha256:${expectedDigest?.replace(/^sha256:/, "")}`, "Transfer artifact digest mismatch");
  const removed = gh(["api", "--method", "DELETE", endpoint]);
  if (removed.status === 0) return { id, status: "deleted", custody };
  const readback = gh(["api", endpoint]);
  return { id, status: readback.status !== 0 && /\bHTTP[\s:(]+404\b/.test(readback.stderr) ? "deleted" : "retained", custody };
}

export function uploadDraft(directory) {
  const record = readGithubBuildRecord(join(directory, "github-build.json"));
  assert.equal(record.delivery, "draft", "Build-only candidates cannot access a Release");
  const context = assertGithubContext(); assert.equal(context.mode, "draft", "Only draft mode may upload candidate assets");
  assert.deepEqual(record.source, context.source); assert.equal(record.tag, `v${context.version}`);
  assert.equal(record.profile, context.profile, "Draft profile differs from original build");
  assert.equal(record.workflow.runId, context.workflow.runId); assert(record.workflow.runAttempt <= context.workflow.runAttempt, "Invalid candidate run attempt");
  assert.equal(record.configuration.signing, "developer-id-notarized", "Draft upload requires a Developer ID notarized candidate");
  assert.deepEqual(record.configuration, publicConfigurationIdentity(resolve(import.meta.dirname, "../../.."), record.configuration.signing, record.profile), "Candidate configuration differs from public source");
  verifyGithubAssets(directory, record); verifyTag(record);
  const expected = [...githubBuildAssets(record).map(asset => ({ name: asset.name, bytes: asset.bytes, sha256: asset.sha256 })),
    ...["github-build.json", "build-provenance.jsonl"].map(name => ({ name, bytes: lstatSync(join(directory, name)).size, sha256: hashFile(join(directory, name)) }))];
  let release = findGithubRelease(record.tag, readJson);
  if (release) validateDraft(release, record);
  else {
    const requestDirectory = mkdtempSync(join(tmpdir(), "bottega-draft-create-")), requestPath = join(requestDirectory, "request.json");
    writeFileSync(requestPath, canonicalJson({ tag_name: record.tag, target_commitish: record.source.commit, name: `${record.tag} candidate`,
      body: "Production macOS ARM64 candidate, Developer ID signed and notarized. Private installer acceptance is pending.",
      draft: true, prerelease: record.profile === "personal", make_latest: "false" }));
    const created = gh(["api", "--method", "POST", `repos/${PUBLIC_REPOSITORY}/releases`, "--input", requestPath]);
    const response = created.status === 0 ? JSON.parse(created.stdout) : null;
    release = findGithubRelease(record.tag, readJson);
    assert(release, created.status === 0 ? "Created draft cannot be read back" : "Draft creation result is unknown; no retry is allowed");
    if (created.status === 0) {
      assert(response && typeof response === "object" && !Array.isArray(response), "Created release response is malformed");
      assert(Number.isSafeInteger(response.id) && response.id > 0, "Created release ID is invalid");
      assert.equal(release.id, response.id, "Created release ID mismatch");
      validateDraft(response, record);
    }
    validateDraft(release, record);
  }
  const releaseId = release.id;
  for (const asset of release.assets) {
    const match = expected.find(item => item.name === asset.name);
    assert(match, `Unexpected draft asset: ${asset.name}`); sameAsset(asset, match);
  }
  const custody = [];
  for (const asset of expected) {
    release = validateDraft(readGithubRelease(releaseId, record.tag, readJson), record);
    let remote = release.assets.find(item => item.name === asset.name);
    if (!remote) {
      const uploaded = gh(["release", "upload", record.tag, "--repo", PUBLIC_REPOSITORY, join(directory, asset.name)]);
      release = validateDraft(readGithubRelease(releaseId, record.tag, readJson), record); remote = release.assets.find(item => item.name === asset.name);
      assert(remote, uploaded.status === 0 ? `Uploaded asset is missing: ${asset.name}` : `Upload result is unknown: ${asset.name}; no retry is allowed`);
    }
    custody.push(verifyRemoteAsset(record, releaseId, remote, asset));
  }
  release = validateDraft(readGithubRelease(releaseId, record.tag, readJson), record);
  assert.deepEqual(release.assets.map(asset => asset.name).sort(), expected.map(asset => asset.name).sort(), "Draft inventory changed");
  for (const fact of custody) {
    const current = release.assets.find(asset => asset.id === fact.id); assert(current, "Draft asset disappeared"); sameAsset(current, fact);
  }
  const transfer = cleanupTransfer(record, custody);
  const result = { schema: "bottega.github-draft-upload/v1", releaseId: release.id, tag: record.tag, commit: record.source.commit,
    draft: true, prerelease: record.profile === "personal", assets: custody, transfer };
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY,
    `### Verified candidate draft\n\nRelease ID: \`${release.id}\`\n\n${custody.map(asset => `- ${asset.name}: ID \`${asset.id}\`, \`${asset.sha256}\``).join("\n")}\n\nTransfer artifact: ${transfer ? `\`${transfer.id}\` (${transfer.status})` : "retained"}\n`);
  console.log(canonicalJson(result)); return result;
}

const entryPath = process.argv[1];
if (entryPath && entryPath !== "-" && existsSync(resolve(entryPath)) &&
    pathToFileURL(realpathSync(resolve(entryPath))).href === import.meta.url) {
  const [directory, ...extra] = process.argv.slice(2);
  assert(directory && extra.length === 0, "Usage: node draft.mjs <candidate-assets>");
  uploadDraft(resolve(directory));
}
