/**
 * [INPUT]: Public GitHub run metadata, a clean snapshot for production commands, physical CLI identity, pinned Node/pnpm, production builder and owned signing material.
 * [OUTPUT]: Strict assertGithubContext admission, fresh macOS ARM64 personal installers, canonical provenance and run-bound cleanup independent of fresh source eligibility.
 * [POS]: Public GitHub producer and owned cleanup dispatcher; private native acceptance remains separate. build-only never accesses signing material.
 */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { builderEnvironment } from "../../assembly/package-manager.mjs";
import { locateCurrentPlatformArtifact, locateInstallers } from "../product-artifact.mjs";
import { canonicalJson, payloadIdentity, publicConfigurationIdentity, publicSourceIdentity, PUBLIC_REPOSITORY, PUBLIC_WORKFLOW } from "./identity.mjs";
import { assertGithubBuildRecord, readGithubBuildRecord, verifyGithubAssets } from "./record.mjs";
import { assertPreparedSigning, cleanupSigning, preparedSigningEnvironment, prepareSigning, signingForMode, unsignedPackagingEnvironment, verifyNotarizedInstallers } from "./signing.mjs";

const root = resolve(import.meta.dirname, "../../../../..");
const desktop = join(root, "apps/desktop");
const OID = /^[a-f0-9]{40}$/;
const json = path => JSON.parse(readFileSync(path, "utf8"));

function assertGithubRunContext() {
  const environment = process.env;
  assert.equal(environment.GITHUB_ACTIONS, "true", "Production build requires GitHub Actions");
  assert.equal(environment.GITHUB_REPOSITORY, PUBLIC_REPOSITORY, "Production build repository mismatch");
  assert.equal(environment.GITHUB_EVENT_NAME, "workflow_dispatch", "Production build requires manual dispatch");
  assert.equal(environment.GITHUB_REF, "refs/heads/main", "Production build requires main");
  assert.equal(environment.GITHUB_WORKFLOW_REF, `${PUBLIC_REPOSITORY}/${PUBLIC_WORKFLOW}@refs/heads/main`, "Unexpected production workflow");
  const mode = environment.BOTTEGA_PUBLIC_BUILD_MODE;
  const signing = signingForMode(mode);
  const runId = Number(environment.GITHUB_RUN_ID), runAttempt = Number(environment.GITHUB_RUN_ATTEMPT);
  assert(Number.isSafeInteger(runId) && runId > 0 && Number.isSafeInteger(runAttempt) && runAttempt > 0, "Invalid GitHub run identity");
  return { environment, mode, signing, runId, runAttempt };
}

export function assertGithubContext() {
  const { environment, mode, signing, runId, runAttempt } = assertGithubRunContext();
  const requested = environment.BOTTEGA_PUBLIC_BUILD_COMMIT;
  assert(OID.test(requested ?? ""), "Production build requires a full source commit");
  assert.equal(environment.GITHUB_SHA, requested, "Requested source commit differs from workflow dispatch");
  assert.equal(environment.GITHUB_WORKFLOW_SHA, requested, "Workflow source commit differs from build source");
  const source = publicSourceIdentity(root); assert.equal(source.commit, requested, "Checked-out source commit mismatch");
  const packageJson = json(join(root, "package.json")), app = json(join(desktop, "package.json"));
  assert.equal(packageJson.name, "bottega", "GitHub production build accepts only the exported public tree");
  assert.equal(packageJson.version, app.version, "Public root and desktop versions differ");
  assert.equal(environment.BOTTEGA_PUBLIC_RELEASE_TAG, `v${app.version}`, "Requested tag differs from source version");
  const node = packageJson.devEngines?.runtime;
  assert(node?.name === "node" && /^24\.\d+\.\d+$/.test(node.version) && node.onFail === "download", "Missing public Node runtime pin");
  assert.equal(packageJson.engines?.node, node.version, "Public Node engine pin mismatch");
  assert.equal(process.version, `v${node.version}`, "GitHub Node differs from the source runtime pin");
  assert(/^pnpm@\d+\.\d+\.\d+$/.test(packageJson.packageManager ?? ""), "Missing public pnpm pin");
  return { source, version: app.version, mode, signing, packageManager: packageJson.packageManager,
    workflow: { path: PUBLIC_WORKFLOW, runId, runAttempt, ref: environment.GITHUB_WORKFLOW_REF, sha: requested } };
}

function paths() {
  assert(isAbsolute(process.env.RUNNER_TEMP ?? ""), "GitHub runner temporary directory is required");
  const candidate = join(process.env.RUNNER_TEMP, "bottega-macos-candidate");
  return { candidate, packages: join(candidate, "packages"), assets: join(candidate, "assets") };
}
function run(command, args, environment = process.env) {
  const result = spawnSync(command, args, { cwd: desktop, stdio: "inherit", env: environment });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `Production build command failed: ${command}`);
}
function verifyAdHoc(path) {
  execFileSync("/usr/bin/codesign", ["--verify", "--deep", "--strict", path], { stdio: "inherit" });
  const result = spawnSync("/usr/bin/codesign", ["--display", "--verbose=4", path], { encoding: "utf8" });
  const details = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  assert.equal(result.status, 0, "Personal signature details unavailable");
  assert(/^Signature=adhoc$/m.test(details) && !/^Authority=/m.test(details) && /^TeamIdentifier=not set$/m.test(details),
    "Personal package must carry an ad-hoc signature without a Developer ID team");
}

function build(context) {
  assert.equal(process.platform, "darwin", "Production personal build requires macOS");
  assert.equal(process.arch, "arm64", "Production personal build requires ARM64");
  const signed = context.signing === "developer-id-notarized";
  if (signed) assertPreparedSigning();
  const output = paths(); assert(!existsSync(output.candidate), "A build candidate directory cannot be reused");
  mkdirSync(output.assets, { recursive: true });
  const startedAt = Date.now(), configuration = publicConfigurationIdentity(desktop, context.signing);
  const actualPnpm = execFileSync("pnpm", ["--version"], { encoding: "utf8" }).trim();
  assert.equal(`pnpm@${actualPnpm}`, context.packageManager, "Installed pnpm differs from source pin");
  const inherited = signed ? preparedSigningEnvironment(process.env) : unsignedPackagingEnvironment(process.env);
  const environment = builderEnvironment({ ...inherited, BOTTEGA_CLOUD_BUILD: "production", BOTTEGA_WORKBENCH_UI: "1",
    pnpm_config_verify_deps_before_run: "error" });
  const builderArgs = ["node_modules/electron-builder/cli.js", "--config", "electron-builder.yml", "--mac", "--arm64", "--publish", "never",
    "-c.extraMetadata.bottegaReleaseProfile=personal", `-c.directories.output=${output.packages}`];
  if (signed) builderArgs.push("-c.forceCodeSigning=true", `-c.mac.identity=${environment.CSC_NAME}`);
  else builderArgs.push("-c.mac.identity=-", "-c.mac.notarize=false");
  run("pnpm", ["--dir", desktop, "build"], environment);
  run(process.execPath, builderArgs, environment);
  const artifact = locateCurrentPlatformArtifact(desktop, startedAt, "darwin", output.packages);
  if (signed) {
    const installersForVerify = locateInstallers(desktop, startedAt, "darwin", output.packages);
    verifyNotarizedInstallers({ appPath: artifact.appPath, dmgPath: installersForVerify["darwin-arm64.dmg"].path,
      zipPath: installersForVerify["darwin-arm64.zip"].path, teamId: environment.APPLE_TEAM_ID });
  } else {
    verifyAdHoc(artifact.appPath); verifyAdHoc(join(artifact.resourcesPath, "runtime/node/darwin-arm64/bin/node"));
  }
  const installers = locateInstallers(desktop, startedAt, "darwin", output.packages);
  const assets = Object.entries(installers).map(([id, installer]) => {
    const name = installer.path.split("/").at(-1); copyFileSync(installer.path, join(output.assets, name));
    return { id, name, bytes: installer.bytes, sha256: installer.sha256 };
  });
  assert.deepEqual(publicSourceIdentity(root), context.source, "Public source changed during packaging");
  assert.deepEqual(publicConfigurationIdentity(desktop, context.signing), configuration, "Public configuration changed during packaging");
  const payloadDigest = payloadIdentity(artifact.appPath);
  const record = { schema: "bottega.github-build/v1", repository: PUBLIC_REPOSITORY, delivery: context.mode === "draft" ? "draft" : "artifact",
    tag: `v${context.version}`, version: context.version, profile: "personal", buildId: randomUUID(), startedAt, completedAt: Date.now(),
    source: context.source, configuration, payloadDigest, workflow: context.workflow,
    runner: { platform: "darwin-arm64", node: process.version, pnpm: actualPnpm }, assets };
  assertGithubBuildRecord(record); writeFileSync(join(output.assets, "github-build.json"), canonicalJson(record));
  verifyGithubAssets(output.assets, record, { provenance: false });
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY,
    `### macOS ARM64 candidate\n\nCommit: \`${context.source.commit}\`\n\nMode: \`${context.mode}\`\n\nSigning: \`${context.signing}\`\n\n${assets.map(asset => `- ${asset.name}: \`${asset.sha256}\` (${asset.bytes} bytes)`).join("\n")}\n`);
  console.log(canonicalJson(record));
}

function provenance(context) {
  const output = paths(), record = readGithubBuildRecord(join(output.assets, "github-build.json"));
  assert.deepEqual(record.source, context.source); assert.equal(record.workflow.runId, context.workflow.runId);
  const source = process.env.BOTTEGA_PUBLIC_ATTESTATION_BUNDLE;
  assert(isAbsolute(source ?? ""), "Build provenance bundle path is required");
  const bundle = JSON.parse(readFileSync(source, "utf8"));
  assert(bundle.mediaType && bundle.verificationMaterial && bundle.dsseEnvelope, "Invalid generated provenance bundle");
  writeFileSync(join(output.assets, "build-provenance.jsonl"), `${JSON.stringify(bundle)}\n`);
  verifyGithubAssets(output.assets, record);
}

const entryPath = process.argv[1];
if (entryPath && entryPath !== "-" && existsSync(resolve(entryPath)) &&
    pathToFileURL(realpathSync(resolve(entryPath))).href === import.meta.url) {
  const [command, ...extra] = process.argv.slice(2); assert.equal(extra.length, 0, "Unexpected production build arguments");
  assert(["validate", "toolchain", "sign-prepare", "build", "provenance", "sign-cleanup"].includes(command), "Expected validate, toolchain, sign-prepare, build, provenance, or sign-cleanup");
  if (command === "sign-cleanup") {
    const context = assertGithubRunContext();
    if (context.mode !== "build-only") cleanupSigning();
  } else {
    const context = assertGithubContext();
    if (command === "sign-prepare") {
      assert.notEqual(context.mode, "build-only", "Unsigned build-only mode cannot access signing material");
      prepareSigning();
    } else if (command === "toolchain") run("npm", ["install", "--global", context.packageManager]);
    else if (command === "build") build(context);
    else if (command === "provenance") provenance(context);
    else console.log(`Validated public build source ${context.source.commit}`);
  }
}
