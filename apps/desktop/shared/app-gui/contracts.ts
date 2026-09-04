/**
 * [INPUT]: Depends on shared SHA-256 and Base GUI capability primitives
 * [OUTPUT]: Provides compiled GUI manifest, compatibility, receipt, the producible build-finding catalog, and the enumerable single-source-of-truth runtime error code tuple
 * [POS]: Shared app-gui identity leaf; build and runtime layers consume one discriminated contract
 */

import type { Sha256Digest } from "../extensions-ipc";

export const APP_GUI_PRESET = "bottega-react-v1" as const;
export const LEGACY_BASE_GUI_SDK_VERSION = "base-gui-legacy-v1" as const;

type AppGuiIconLibrary = "lucide" | "phosphor";

export type BaseGuiBuildManifest = Readonly<{
  preset: typeof APP_GUI_PRESET;
  entry: "src/main.tsx";
  stylesheet: "src/styles.css";
  iconLibrary: AppGuiIconLibrary;
}>;

export type BaseGuiPreferencesManifest = Readonly<{
  schema: "gui/preferences.schema.json";
  schemaVersion: number;
  schemaDigest: Sha256Digest;
  defaults: "gui/preferences.defaults.json";
  defaultsDigest: Sha256Digest;
  maxBytes: 65_536;
}>;

export type AppGuiStaticV2CompatibilityRef = Readonly<{
  kind: "static-v2";
  legacySdkDigest: Sha256Digest;
  legacyBaseApiVersion: typeof LEGACY_BASE_GUI_SDK_VERSION;
  grantContractVersion: "studio-grant-v1";
  requiredHostActions: readonly ("open-data" | "open-data-view" | "compose-text")[];
}>;

export type AppGuiCompiledV3CompatibilityRef = Readonly<{
  kind: "compiled-v3";
  transformContractDigest: Sha256Digest;
  sdkDigest: Sha256Digest;
  cutoverContractVersion: "app-generation-cutover-v2";
  dataSdk:
    | Readonly<{ kind: "none" }>
    | Readonly<{ kind: "base-gui-data-v1"; querySemanticsVersion: "base-gui-query-v1" }>;
  preferences:
    | Readonly<{ kind: "none" }>
    | Readonly<{
        kind: "app-preferences-v1";
        schemaDigest: Sha256Digest;
        defaultsDigest: Sha256Digest;
      }>;
  workspace:
    | Readonly<{ kind: "none" }>
    | Readonly<{
        kind: "workspace-read-v1";
        scope: "design/";
        opaquePreviewContractVersion: "workspace-opaque-preview-v1";
      }>;
  hostActions:
    | Readonly<{ kind: "none" }>
    | Readonly<{
        kind: "host-actions-v1";
        required: readonly (
          | "open-data"
          | "open-data-view"
          | "compose-text"
          | "file.export"
        )[];
      }>;
}>;

export type AppGuiCompatibilityRef =
  | AppGuiStaticV2CompatibilityRef
  | AppGuiCompiledV3CompatibilityRef;

export type AppGuiBuildReceipt = Readonly<{
  preset: typeof APP_GUI_PRESET;
  transformContractDigest: Sha256Digest;
  platformCompilerCustodyDigest: Sha256Digest;
  componentOriginsDigest: Sha256Digest;
  allowlistDigest: Sha256Digest;
  transformManifestDigest: Sha256Digest;
  runtimeSbomSliceDigest: Sha256Digest;
  runtimeNoticesSliceDigest: Sha256Digest;
  compatibility: AppGuiCompiledV3CompatibilityRef;
  platform: "darwin-arm64" | "win32-x64" | "linux-x64";
  manifestDigest: Sha256Digest;
  sourcePackageDigest: Sha256Digest;
  contentDigest: Sha256Digest;
  sourceGuiDigest: Sha256Digest;
  runtimeGuiDigest: Sha256Digest;
  iconLibrary: AppGuiIconLibrary;
  files: readonly Readonly<{ path: string; bytes: number; sha256: Sha256Digest }>[];
}>;

/* ============================================================
 * §10.3 构建/切换 finding code：目录即「主进程真的会产出」的集合。
 *
 * PRD 列过但从未产出的名字已删除，各自的真实归宿：
 *   GUI_BUILD_NON_DETERMINISTIC —— 确定性由 seal 的 digest 比对兜底，
 *     不一致直接是 GUI_BUILD_RECEIPT_INVALID。
 *   GUI_CUTOVER_PARTICIPANT_UNAVAILABLE / _NOT_READY —— participant 只有
 *     「计划非法」与「阶段非法」两种真实失败，见下面两个 code。
 *   GUI_CUTOVER_RECOVERY_INVALID —— 恢复改写后按具体缺失分账：
 *     GUI_CUTOVER_RECOVERY_APP_MISSING / _AUTHORITY_MISMATCH。
 *   GUI_COMPATIBILITY_REVOKED —— 撤销不抛错，走 quarantine 落盘。
 * ============================================================ */
export const APP_GUI_FINDING_CODES = [
  "GUI_BUILD_MANIFEST_INVALID",
  "GUI_BUILD_SOURCE_MISSING",
  "GUI_BUILD_SOURCE_FREEZE_UNSAFE",
  "GUI_TYPECHECK_FAILED",
  "GUI_BUILD_IMPORT_FORBIDDEN",
  "GUI_BUILD_IMPORTER_DOMAIN_VIOLATION",
  "GUI_BUILD_ENTRY_ABI_INVALID",
  "GUI_BUILD_RAW_SDK_FORBIDDEN",
  "GUI_BUILD_ICON_LIBRARY_MISMATCH",
  "GUI_BUILD_COMPONENT_ORIGIN_INVALID",
  "GUI_BUILD_COMPONENT_CATALOG_INVALID",
  "GUI_BUILD_COMPONENT_UPDATE_CONFLICT",
  "GUI_ADMISSION_GATE_CLOSED",
  "GUI_BUILD_CSS_DIRECTIVE_FORBIDDEN",
  "GUI_BUILD_REMOTE_RESOURCE",
  "GUI_COMPILER_SANDBOX_UNAVAILABLE",
  "GUI_COMPILER_SANDBOX_VIOLATION",
  "GUI_BUILD_TIMEOUT",
  "GUI_BUILD_ABORTED",
  "GUI_BUILD_MEMORY_LIMIT",
  "GUI_BUILD_OUTPUT_LIMIT",
  "GUI_BUILD_COMPILER_CRASH",
  "GUI_BUILD_ARTIFACT_INVALID",
  "GUI_BUILD_RECEIPT_INVALID",
  "GUI_CUTOVER_CONFLICT",
  "GUI_CUTOVER_PARTICIPANT_PLAN_INVALID",
  "GUI_CUTOVER_READY_TIMEOUT",
  "GUI_COMPATIBILITY_UNSUPPORTED",
] as const;

type AppGuiFindingCode = (typeof APP_GUI_FINDING_CODES)[number];
export type AppGuiBuildFinding = Readonly<{
  code: AppGuiFindingCode;
  file: string;
  line?: number;
  column?: number;
  message: string;
}>;

/* ============================================================
 * §10.4 运行期错误码：唯一真相源。
 *
 * 这个联合体只列「主进程真的会产出、并且真的会抵达 App SDK」的 code。
 * 生成物 SDK 把任何 wire code 原样透传成 AppGuiRuntimeError.code，所以
 * 联合体一旦与 wire 分叉，它就从契约退化成注释。
 *
 * 已删除的 PRD 名字及其真实归宿：
 *   lease_expired / cutover_in_progress —— 从未产出；租约与切换失败走
 *     surface_gone / surface_invalid / generation_draining。
 *   host_action_declined / host_action_cancelled —— 不是抛出的错误，
 *     是 host action ack 结果里的 status 字段。
 *   file_export_integrity / file_export_busy —— 同理，走
 *     CompleteFileExportResultV1.status 与 BeginFileExportResultV1.reason。
 *   workspace_invalid_preview —— 实际产出的是 preview_not_found /
 *     preview_navigation_required / workspace_file_invalid。
 *
 * 元组而非裸联合体：作者侧 SDK 的 .d.ts 是一段字符串，只有能在运行期枚举
 * 成员，那段字符串才能由这里生成而不是被人手抄一遍。顺序即数字身份，
 * 只准追加。
 * ============================================================ */
export const APP_GUI_RUNTIME_ERROR_CODES = [
  /* 传输与路由 */
  "invalid_token",
  "endpoint_not_found",
  "method_not_allowed",
  "unsupported_media_type",
  "capability_not_granted",
  "permission_denied",
  "generation_draining",
  "generation_stale",
  "cutover_admission_closed",
  "surface_gone",
  "surface_invalid",
  "client_aborted",
  "internal_error",
  /* Base 读写 */
  "base_not_found",
  "invalid_json",
  "invalid_envelope",
  "batch_too_large",
  "body_too_large",
  "body_read_timeout",
  "mutation_busy",
  "revision_conflict",
  "base_instance_changed",
  "commit_uncertain",
  "read_failed",
  "unknown_outcome",
  /* Query V1：请求面 */
  "query_unavailable",
  "query_invalid",
  "query_column_invalid",
  "query_aggregation_invalid",
  "query_cursor_invalid",
  "query_budget_exceeded",
  "query_revision_changed",
  "query_timeout",
  /* Query V1：执行器与 worker 自治面 */
  "query_snapshot_capacity",
  "query_snapshot_missing",
  "query_snapshot_invalid",
  "query_response_invalid",
  "query_queue_full",
  "query_queue_timeout",
  "query_worker_invalid",
  "query_worker_exit",
  "query_worker_failed",
  "query_executor_closed",
  "query_executor_reset",
  "query_executor_quarantined",
  /* App preferences */
  "preferences_unavailable",
  "preference_invalid",
  "preference_limit",
  "preference_conflict",
  "preference_schema_changed",
  "preference_schema_invalid",
  "preference_value_invalid",
  "preference_transitioning",
  "app_deleted",
  /* Workspace read v1 */
  "workspace_forbidden",
  "workspace_changed",
  "workspace_stale_ref",
  "workspace_cursor_invalid",
  "workspace_not_found",
  "workspace_file_invalid",
  "workspace_file_too_large",
  "workspace_invalid_request",
  "workspace_request_too_large",
  "workspace_response_too_large",
  "workspace_route_not_found",
  "workspace_read_failed",
  "workspace_unavailable",
  "workspace_preview_unavailable",
  "preview_not_found",
  "preview_navigation_required",
  /* Host actions */
  "host_action_timeout",
  "host_action_failed",
] as const;

export type AppGuiRuntimeErrorCode = (typeof APP_GUI_RUNTIME_ERROR_CODES)[number];

export type AppGuiRuntimeError = Readonly<{
  code: AppGuiRuntimeErrorCode;
  message: string;
  retryable: boolean;
}>;
