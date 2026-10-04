/**
 * [INPUT]: Depends on the Provider descriptor contract, the ACP session probe, the shared model catalog mechanism and its CLI file key, and this folder's declared launch.
 * [OUTPUT]: Provides createDescriptorModelCatalog: a package Provider's model list, read from the `model` select option of an ACP session/new, keyed on the CLI file, its version and the package digest; cached() never probes.
 * [POS]: The models half of providers/host/packages' DescriptorBackend; nothing here knows a Provider by name.
 */
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProviderDescriptor } from "@ai-chat/cloud-protocol/contracts/provider";
import type { BackendModelInfo } from "../../../../../shared/ipc/agent/agent-ipc";
import { inspectAcpSession } from "../../../backends/acp/probe";
import { createModelCatalog, executableFileKey, type ModelCatalogProbeRunner } from "../../../backends/models/model-catalog";
import type { ResolvedRuntime } from "../../../backends/types";
import type { ProviderPackageRef } from "../catalog";
import { assertDeclaredLaunch, assertPackageAdmitted, descriptorAcpLaunch, preparePackageLaunch } from "./launch";

const MODEL_LIMIT = 128;
const SLUG = /^[A-Za-z0-9._:/@+-]{1,128}$/;
export const PACKAGE_SESSION_ID = /^[A-Za-z0-9._:/-]{1,128}$/;

type SelectOption = { value?: unknown; name?: unknown };
/** The `model` select of a session/new answer; any other shape is no list (never a guess). */
export function packageModels(created: unknown): BackendModelInfo[] {
  const options = (created as { configOptions?: unknown } | null)?.configOptions;
  if (!Array.isArray(options)) return [];
  const model = options.find(option => option && typeof option === "object" && (option as { type?: unknown }).type === "select"
    && ((option as { category?: unknown }).category === "model" || (option as { id?: unknown }).id === "model")) as
    { currentValue?: unknown; options?: unknown } | undefined;
  if (!model || !Array.isArray(model.options)) return [];
  const entries = (model.options as SelectOption[]).filter(entry => typeof entry?.value === "string" && SLUG.test(entry.value)).slice(0, MODEL_LIMIT);
  return entries.map(entry => ({ slug: entry.value as string, displayName: typeof entry.name === "string" && entry.name.trim() ? entry.name.slice(0, 120) : entry.value as string,
    isDefault: entry.value === model.currentValue }));
}

export type DescriptorModelCatalog = ((runtime: ResolvedRuntime, signal?: AbortSignal, runProbe?: ModelCatalogProbeRunner) => Promise<BackendModelInfo[]>)
  & { list(runtime: ResolvedRuntime, signal?: AbortSignal, runProbe?: ModelCatalogProbeRunner): Promise<BackendModelInfo[]>;
    cached(runtime: ResolvedRuntime): Promise<BackendModelInfo[] | null>; invalidate(): void };

export function createDescriptorModelCatalog(descriptor: ProviderDescriptor, pkg: ProviderPackageRef,
  dependencies: { inspectSession?: typeof inspectAcpSession } = {}): DescriptorModelCatalog {
  const inspect = dependencies.inspectSession ?? inspectAcpSession;
  const catalog = createModelCatalog<ResolvedRuntime>({
    backend: descriptor.providerId,
    label: `${descriptor.displayName} models`,
    /* The list is a fact about this CLI file and this package generation; the workspace does not enter (project config is the CLI's). */
    key: runtime => `${executableFileKey(runtime.executable)}\0${runtime.version}\0${pkg.packageDigest}`,
    read: async (runtime, _workspace, signal) => {
      await assertPackageAdmitted(descriptor.providerId);
      const launch = descriptorAcpLaunch(descriptor, runtime);
      assertDeclaredLaunch(descriptor, launch, runtime.executable);
      const cwd = join(tmpdir(), `bottega-${descriptor.providerId}-models`);
      mkdirSync(cwd, { recursive: true, mode: 0o700 });
      const fenced = await preparePackageLaunch(descriptor, pkg, { ...launch, cwd });
      return inspect({ backend: descriptor.providerId, ...fenced, args: [...fenced.args], signal, timeoutMs: 20_000, totalTimeoutMs: 40_000,
        validateSessionId: id => PACKAGE_SESSION_ID.test(id) }, async ({ created }) => packageModels(created));
    },
  });
  const list = ((runtime, signal, runProbe) => catalog.list(runtime, "", signal, runProbe)) as DescriptorModelCatalog;
  list.list = list;
  list.cached = runtime => catalog.cached(runtime, "");
  list.invalidate = catalog.invalidate;
  return list;
}
