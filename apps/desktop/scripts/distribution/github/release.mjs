/**
 * [INPUT]: Parsed JSON from an authenticated GitHub CLI callback and the fixed public repository identity.
 * [OUTPUT]: findGithubRelease discovers a unique tag across all pages; readGithubRelease verifies a pinned release ID and tag.
 * [POS]: Shared production release-query boundary for draft upload and private intake/publication consumers; it performs no writes.
 */
import assert from "node:assert/strict";
import { PUBLIC_REPOSITORY } from "./identity.mjs";

function assertTag(tag) {
  assert(typeof tag === "string" && tag.length > 0, "GitHub release tag is invalid");
}

function assertRelease(value) {
  assert(value && typeof value === "object" && !Array.isArray(value), "GitHub release response is malformed");
  assert(Number.isSafeInteger(value.id) && value.id > 0, "GitHub release ID is invalid");
  assertTag(value.tag_name);
}

export function readGithubRelease(id, tag, readJson) {
  assert(Number.isSafeInteger(id) && id > 0, "GitHub release ID is invalid");
  assertTag(tag);
  const release = readJson(["api", `repos/${PUBLIC_REPOSITORY}/releases/${id}`]);
  assertRelease(release);
  assert.equal(release.id, id, "GitHub release ID mismatch");
  assert.equal(release.tag_name, tag, "GitHub release tag mismatch");
  return release;
}

export function findGithubRelease(tag, readJson) {
  assertTag(tag);
  const pages = readJson(["api", "--paginate", "--slurp", `repos/${PUBLIC_REPOSITORY}/releases?per_page=100`]);
  assert(Array.isArray(pages) && pages.length > 0 && pages.every(Array.isArray), "GitHub release list pages are malformed");
  const releases = pages.flat();
  for (const release of releases) assertRelease(release);
  const matches = releases.filter(release => release.tag_name === tag);
  assert(matches.length <= 1, "Duplicate GitHub releases match the requested tag");
  return matches.length === 0 ? null : readGithubRelease(matches[0].id, tag, readJson);
}
