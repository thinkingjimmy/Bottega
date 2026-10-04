/**
 * [INPUT]: Depends on the Provider descriptor contract, the d4-0 catalog contract, runtime discovery and version helpers, the generic ACP failure classifier, readiness's working directory, the bridged turn and the Provider bridge runtime, and this folder's launch and model catalog.
 * [OUTPUT]: Provides createDescriptorBackend (a DescriptorBackendFactory): main's side of a third-party Provider package driven only by its descriptor — discovery by declared command names, its declared version arguments and floor, fail-closed capabilities and the package session policy (shared with the bridge's initialize), explicit JSON authentication, local login metadata, optional one-shot titles, and readiness/models/turns through the shared package fence.
 * [POS]: Turn options parse the shared packageTurnOptionsSchema, the Chat record's own shape (TASK-11 S3-b). TASK-11 (d) d4b; the package catalog (package-catalog.ts) calls it once per package generation and answers resolveBackend with it. Package code never runs in main: the bridge alone loads the package's pinned module, and the production admission gate still requires a provisioned trust policy.
 */
import { packageTurnOptionsSchema } from "../../../../../shared/chat-agent/options";
import { classifyAcpFailure } from "../../../backends/acp/failure";
import { PACKAGE_SESSION_POLICY } from "../../../backends/acp/startup/client-capabilities";
import { readinessWorkingDirectory } from "../../../backends/acp/startup/readiness";
import { commonCommandPaths, probeRuntimeCandidatesAsync, runtimeVersionAtLeast, sanitizedProcessEnvironment } from "../../../backends/runtime/runtime-probe";
import type { AcpSpawnConfig } from "../../../backends/acp/launch";
import { descriptorVersionProbe } from "./auxiliary/version";
import { descriptorAuth, descriptorSetup } from "./auxiliary/auth";
import type { BackendTurnOptions } from "../../../backends/types";
import { BridgedAcpTurn } from "../turns/bridged-turn";
import { requireProviderBridge } from "../runtime";
import type { DescriptorBackendFactory, ProviderBackend } from "../catalog";
import { assertDeclaredLaunch, assertPackageAdmitted, descriptorAcpLaunch, preparePackageLaunch } from "./launch";
import { createDescriptorModelCatalog, PACKAGE_SESSION_ID } from "./models";

/* One shape for a package Provider's options, the Chat record's own (TASK-11 S3-b): extra keys are refused too. */
function validateTurnOptions(id: string, value: unknown) {
  const options = packageTurnOptionsSchema.safeParse(value);
  if (!options.success) throw new Error(`${id}: invalid turn options`);
  if (options.data.backend !== id) throw new Error(`${id}: turn options for another Provider`);
}

export const createDescriptorBackend: DescriptorBackendFactory = (descriptor, pkg): ProviderBackend => {
  const id = descriptor.providerId, minimum = descriptor.runtime.discovery.minimumVersion;
  const models = createDescriptorModelCatalog(descriptor, pkg);
  const auth = descriptorAuth(descriptor, pkg), setup = descriptorSetup(descriptor);
  const declared = (name: string) => (descriptor.capabilities as Record<string, string | undefined>)[name] === "declared";
  const spawnConfig = (options: BackendTurnOptions): AcpSpawnConfig => {
    const launch = descriptorAcpLaunch(descriptor, options.runtime, options.processEnv);
    assertDeclaredLaunch(descriptor, launch, options.runtime.executable);
    return { ...launch, validateSessionId: sessionId => PACKAGE_SESSION_ID.test(sessionId), classifyFailure: classifyAcpFailure };
  };
  return {
    id,
    displayName: descriptor.displayName,
    minimumVersion: minimum,
    workspaceDirName: `${id}-workspace`,
    sessionCapabilityPolicy: PACKAGE_SESSION_POLICY,
    detectRuntime: async signal => (await Promise.all(descriptor.runtime.discovery.commands.map(command =>
      probeRuntimeCandidatesAsync({ command, commonPaths: commonCommandPaths(command), signal })))).flat(),
    versionEnvironment: runtime => sanitizedProcessEnvironment(runtime.path),
    versionArgs: descriptor.runtime.discovery.versionArgs,
    probeVersion: descriptorVersionProbe(descriptor, pkg),
    validateRuntime: runtime => runtimeVersionAtLeast(runtime.version, minimum)
      ? { status: "installed" } : { status: "unsupported", reason: `${descriptor.displayName} ${minimum}+` },
    /* Fail-closed: only what the descriptor declares and the host can honour for any ACP CLI; nothing a built-in had to earn. */
    capabilitiesFor: () => ({ resume: declared("resume"), permissionModes: ["ask-for-approval"], modelOptions: "list-only",
      imageInput: declared("image-input"), planMode: false, headless: [...(descriptor.headless ?? [])], maintenance: false, builtinTools: "none" }),
    classifyFailure: classifyAcpFailure,
    ...(auth ? { auth } : {}),
    ...(setup ? { setup } : {}),
    validateTurnOptions: value => validateTurnOptions(id, value),
    validateSessionId: sessionId => PACKAGE_SESSION_ID.test(sessionId),
    models: { list: (runtime, _workspace, signal, runProbe) => models(runtime, signal, runProbe), cached: runtime => models.cached(runtime),
      invalidate: models.invalidate },
    /* A plain handshake in its own working directory, whatever credentialSafeProbe says: a generic package declares no home override. */
    readiness: async runtime => {
      await assertPackageAdmitted(id);
      const launch = descriptorAcpLaunch(descriptor, runtime);
      assertDeclaredLaunch(descriptor, launch, runtime.executable);
      return { launch: await preparePackageLaunch(descriptor, pkg, { ...launch, cwd: await readinessWorkingDirectory(id) }, { network: false }) };
    },
    /* The bridge runs the package's pinned module; main seals the declared launch. d4c's gate refuses a third-party module this period. */
    createTurn: options => {
      validateTurnOptions(id, options.payload.turnOptions);
      return new BridgedAcpTurn(options, spawnConfig(options), requireProviderBridge(), launch => preparePackageLaunch(descriptor, pkg, launch, {
        workspace: options.workspace, readOnly: options.filesystemAccess?.mode === "read-only" || Boolean(options.payload.planMode),
        readRoots: options.filesystemAccess?.readOnlyRoots, writeRoots: options.artifactDirectory ? [options.artifactDirectory] : [],
        deniedReadRoots: options.skillIsolation?.deniedRoots, controlRoot: options.filesystemAccess?.controlRoot,
        network: options.filesystemAccess?.network !== "off",
      }));
    },
  };
};
