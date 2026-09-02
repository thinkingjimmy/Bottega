/**
 * [INPUT]: Depends on type-only AgentBackendId, Apps manifest/record/authorization primitives, product resource scope, and Extension disclosure/digest vocabulary
 * [OUTPUT]: Provides the App acquisition wire contracts — gh status, repo/preset probe results, extension install preflights, typed preset identities and install inputs, config values, share preview/publish, add/save-as/remove commands
 * [POS]: Shared Apps wire leaf for the acquisition half (install, preset, share, removal); apps-ipc re-exports it while durable lifecycle and grant records stay in that file
 */

import type { AgentBackendId } from "./agent-ipc";
import type {
  AppInstallAuthorization,
  AppRecord,
  AppRequirement,
  BaseAppManifest,
} from "./apps-ipc";
import type { ProductResourceScope } from "./product-resource-scope";
import type { ExtensionDisclosureView, Sha256Digest } from "./extensions-ipc";

export type GhStatus =
  | { state: "missing"; message: string }
  | { state: "unauthenticated"; message: string }
  | { state: "ready"; message: string };

export type AppRepoProbeResult =
  | { kind: "web"; repoUrl: string }
  | {
      kind: "base";
      repoUrl: string;
      preflightId: string;
      digest: string;
      commitSha: string;
      manifest: BaseAppManifest;
      requirements: AppRequirement[];
      cliStatuses: Array<{
        id: string;
        detectable: boolean;
        installed: boolean;
      }>;
      disclosures: Array<{ path: string; content: string }>;
      files: Array<{ path: string; bytes: number }>;
      ignored: string[];
      rowCount: number;
      hasGui: boolean;
      extensionPreflights: readonly AppExtensionInstallPreflight[];
    };

export type AppExtensionInstallPreflight = Readonly<{
  declaredComponentIdentity: string;
  scope: ProductResourceScope;
  projectLifecycleRevision: number | null;
  scopeRevision: number;
  repoUrl: string;
  requestedRef: string;
  resolvedCommit: string;
  contentDigest: Sha256Digest;
  capabilityDigest: Sha256Digest;
  capabilities: ExtensionDisclosureView;
  preflightId: string | null;
  state: "ready" | "installed";
}>;

/** 线上身份只穿过稳定 ID；产品文案由 renderer 的五语目录投影。 */
export const PRESET_APP_IDS = [
  "design-canvas",
  "dev-kanban",
  "expense-tracker",
  "fitness-log",
] as const;
export type PresetAppId = (typeof PRESET_APP_IDS)[number];

export type PresetAppSummary = {
  id: PresetAppId;
  icon: string;
  requirements: AppRequirement[];
};

export type PresetInstallRequest = {
  presetId: string;
  requestId: string;
  config?: AppConfigValue;
};

export type PresetProbeResult = Extract<
  AppRepoProbeResult,
  { kind: "base" }
> & {
  presetId: string;
  resolvedPin: string;
  channel: "release" | "dev";
};

export type InstallPresetInput = PresetInstallRequest & {
  preflightId: string;
  digest: string;
  authorization: AppInstallAuthorization;
};

export type AppConfigValue = {
  values: Record<string, string>;
  agentReadableKeys: string[];
};

export type ShareDataMode = "full" | "sample" | "schema";
export type SharePreviewInput = {
  appId: string;
  dataMode: ShareDataMode;
  repoName: string;
  visibility: "public" | "private";
};
export type SharePreview = {
  previewId: string;
  digest: string;
  files: Array<{ path: string; bytes: number }>;
  rowCount: number;
  sampleRows: Array<{ id: string; values: Record<string, unknown> }>;
  ignored: string[];
  readmePlaceholder: boolean;
  diffSummary: string;
};
export type SharePublishInput = {
  appId: string;
  previewId: string;
  confirmedDigest: string;
  requestId: string;
};

export type AddAppInput = {
  repoUrl: string;
  maintenanceAgent: AgentBackendId | "auto";
  preflightId?: string;
  confirmedDigest?: string;
  config?: AppConfigValue;
  authorization?: AppInstallAuthorization;
};

export type AddAppResult =
  | { status: "done"; record: AppRecord }
  | {
      status: "rejected";
      error: {
        code: "DUPLICATE_REPOSITORY";
        appId: string;
      };
    };

export type SaveAsAppInput = {
  chatId: string;
  name: string;
  icon: string;
  requestId: string;
};

export type SaveAsAppResult =
  | { status: "done"; record: AppRecord }
  | {
      status: "rejected";
      error: { code: string; message: string };
    };

export type RemoveAppMode = "cascade" | "retain-data";
export type RemoveAppInput = {
  appId: string;
  mode: RemoveAppMode;
  requestId: string;
};
