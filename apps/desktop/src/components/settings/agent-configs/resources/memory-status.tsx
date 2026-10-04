/**
 * [INPUT]: Depends on the plugin detail subscription, localized plugin text, settings navigation and shared UI primitives.
 * [OUTPUT]: Provides ConfigMemoryStatus, the None/Read-only config selection alongside the existing Memory plugin status and detail link.
 * [POS]: Agent-config resource row; observes the same plugin authority as the catalog and reports config intent to its parent without granting Memory authority.
 */
import { useId } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@ai-chat/ui/components/ui/select";
import { Button } from "@ai-chat/ui/components/ui/button";
import type { WorkbenchCopy } from "@ai-chat/ui/lib/workbench-copy";
import { useAppTranslation } from "@/components/providers/preferences/i18n-provider";
import { pluginText } from "@/components/settings/plugins/copy";
import { usePluginDetail } from "@/components/settings/plugins/use-plugins";
import { pluginsBridge } from "@/lib/apps/plugins-client";
import { requestSettingsSection } from "@/lib/settings/navigation/settings-navigation";

export function ConfigMemoryStatus({ workbench, onOpenSettings, value, timing, onChange }: {
  workbench: WorkbenchCopy; onOpenSettings(): void; value: "none" | "readonly"; timing: string; onChange(value: "none" | "readonly"): void;
}) {
  const { t } = useAppTranslation(), id = useId();
  const { detail, error, retry } = usePluginDetail(pluginsBridge(), "memory");
  const copy = workbench.plugins;
  const status = error ? copy.loadFailed : detail ? pluginText(detail.health.summary, workbench) : copy.health.unknown;
  return <div className="flex flex-col gap-1.5" data-config-memory="">
    <div className="flex items-center justify-between gap-3">
      <label htmlFor={id} className="font-medium text-sm">{t("memory.plugin.name")}</label>
      <Button type="button" variant="link" size="sm" className="h-auto px-0 text-xs" data-open-memory-plugin=""
        onClick={() => { onOpenSettings(); requestSettingsSection({ section: "plugins", plugin: "memory", pluginView: "settings" }); }}>
        {t("memory.plugin.open")}
      </Button>
    </div>
    <Select value={value} onValueChange={next => onChange(next as "none" | "readonly")}>
      <SelectTrigger id={id} className="w-full pointer-coarse:h-11" data-memory-access=""><SelectValue /></SelectTrigger>
      <SelectContent><SelectItem value="none">{t("memory.access.none")}</SelectItem><SelectItem value="readonly">{t("memory.access.readOnly")}</SelectItem></SelectContent>
    </Select>
    <p className="text-xs text-muted-foreground">{timing}</p>
    <p className="text-xs text-muted-foreground">{t("memory.access.description")}</p>
    {value === "readonly" && detail && <p className="text-xs text-muted-foreground">{t(detail.settings?.values["sharing-mode"] === "personal"
      ? "memory.workflow.personal" : !detail.enabled ? "memory.workflow.requiresActive" : detail.settings?.values["workflow-roles"] === true
        ? "memory.access.workflowOn" : "memory.access.workflowOff")}</p>}
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <span role={error ? "alert" : undefined}>{status}</span>
      {error && <Button type="button" variant="link" size="sm" className="h-auto px-0 text-xs" onClick={retry}>{copy.retry}</Button>}
    </div>
    <p className="text-xs text-muted-foreground">{t("memory.plugin.nativeDistinction")}</p>
  </div>;
}
