/**
 * [INPUT]: Depends on the Settings row/list/badge/button primitives, provider identity, availableInLabel and workbench-copy.
 * [OUTPUT]: Provides AgentConfigList — one config per row: Provider icon, the user's name, Read-only only when enforced, needs-attention lines (guarantees it cannot keep, settings that did not take effect here), greyed with the reason when its Provider plugin is turned off, sync badges (Syncing; Not synced with why, in the row), Provider · model · version,
 *           and for Some Projects the Project names; Edit opens the dialog.
 * [POS]: Rows of one "All Projects" or "Some Projects" group on the Agent configs page.
 */
import { SettingsBadge, SettingsButton, SettingsList, SettingsRow } from "@/components/settings/settings-layout";
import { formatWorkbench, type WorkbenchCopy } from "@ai-chat/ui/lib/workbench-copy";
import { AgentBackendIcon, backendLabel } from "@/lib/agent/agent-backends";
import { availableInLabel, type ProjectOption } from "./available-in";
import type { AgentConfigView } from "@ai-chat/cloud-protocol/agent-config/bridge";
import { guaranteeFacts } from "./guarantee-copy";
import { useAppTranslation } from "@/components/providers/preferences/i18n-provider";

export function AgentConfigList({ configs, projects, workbench, onEdit }: {
  configs: readonly AgentConfigView[];
  projects: readonly ProjectOption[];
  workbench: WorkbenchCopy;
  onEdit(config: AgentConfigView): void;
}) {
  const copy = workbench.agentConfigs, { i18n } = useAppTranslation();
  return (
    <SettingsList>
      {configs.map(config => {
        const { payload } = config;
        if (!payload) return null;
        const facts = guaranteeFacts(config, workbench, i18n.language);
        const model = payload.model.mode === "explicit" ? String(payload.model.value) : copy.providerDefault;
        const where = payload.availableIn === "all" ? [] : [availableInLabel(payload.availableIn, projects, workbench)];
        return (
          <div key={config.configId} data-agent-config={config.configId} className={config.unavailable ? "opacity-60" : undefined}>
            <SettingsRow
              leading={<AgentBackendIcon backend={payload.provider} className="size-5 shrink-0" />}
              label={payload.name}
              badge={<>
                {config.unavailable === "provider-disabled" && <SettingsBadge tone="muted">{formatWorkbench(copy.providerTurnedOff, { provider: backendLabel(payload.provider) })}</SettingsBadge>}
                {facts.readOnly && <SettingsBadge tone="neutral">{copy.readOnly}</SettingsBadge>}
                {facts.attention.length > 0 && <SettingsBadge tone="warn">{copy.needsAttention}</SettingsBadge>}
                {config.conflicted ? <SettingsBadge tone="warn">{copy.conflicted}</SettingsBadge>
                  : config.syncIssue ? <SettingsBadge tone="warn">{copy.notSynced}</SettingsBadge>
                  : config.pending ? <SettingsBadge tone="muted">{copy.syncing}</SettingsBadge> : null}
              </>}
              description={<>
                {[backendLabel(payload.provider), model, `v${config.revision}`, ...where].join(" · ")}
                {facts.attention.map(line => <span key={line} className="block text-amber-700 dark:text-amber-400">{line}</span>)}
                {/* Refused by the account, not retried on its own: say why, in the row (not only on hover). */}
                {config.syncIssue && <span className="block text-amber-700 dark:text-amber-400" data-sync-issue={config.syncIssue}>
                  {copy.syncIssueBudget}</span>}
              </>}
              control={<SettingsButton variant="outline" aria-label={`${copy.edit}: ${payload.name}`} onClick={() => onEdit(config)}>{copy.edit}</SettingsButton>}
            />
          </div>
        );
      })}
    </SettingsList>
  );
}
