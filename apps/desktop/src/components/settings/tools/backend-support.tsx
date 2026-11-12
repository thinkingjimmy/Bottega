/**
 * [INPUT]: Setup provider, built-in backend identity, shared tool support projection and localized reason copy.
 * [OUTPUT]: Provides useToolBackendFacts and BackendSupportNote for live backend diagnostics.
 * [POS]: Shared by official plugin details and global MCP server settings.
 */
import { useMemo } from "react";
import { useAppTranslation } from "@/components/providers/preferences/i18n-provider";
import { useSetup } from "@/components/providers/setup-provider";
import { isBuiltinBackendInfo } from "@/lib/agent/agent-backends";
import type { ResourceBackendSupportView } from "../../../../shared/product/resource-scope";
import { toolBackendFacts } from "../../../../shared/tools/tool-support";

export function useToolBackendFacts() {
  const { status } = useSetup();
  const backends = status?.backends;
  return useMemo(
    () => (backends ?? []).filter(isBuiltinBackendInfo).map(toolBackendFacts),
    [backends]
  );
}

export function BackendSupportNote({
  support,
}: {
  support: readonly ResourceBackendSupportView[];
}) {
  const { t } = useAppTranslation();
  const unsupported = support.filter((item) => !item.supported);
  if (!unsupported.length) return null;

  return (
    <span className="mt-1 block text-xs text-muted-foreground wrap-anywhere" role="note">
      {unsupported.map((item) => (
        <span className="block" key={item.backendId}>
          {item.backendId}: {t(
            `settings.tools.supportReason.${item.reason ?? "unknown"}`
          )}
          {item.detail ? ` · ${item.detail}` : ""}
          {item.constraint?.kind === "minimum-runtime-version"
            ? ` · ${t("settings.tools.supportReason.minimumRuntimeVersion", {
                minimumVersion: item.constraint.minimumVersion,
                detectedVersion: item.constraint.detectedVersion ??
                  t("settings.tools.supportReason.unknownVersion"),
              })}`
            : ""}
        </span>
      ))}
    </span>
  );
}
