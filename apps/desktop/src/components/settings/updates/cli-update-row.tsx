/**
 * [INPUT]: Depends on Setup terminal recovery, CLI verdicts/store, Agent identity, shared update rows, ui Collapsible and Updates i18n
 * [OUTPUT]: Provides CliUpdateRow with a fixed update/retry slot, visible progress/current status and collapsed failure/log/Terminal details
 * [POS]: Provider row of Settings › Updates; shares identity, version and action geometry with AppUpdateRow
 */

import { useSyncExternalStore } from "react";
import { ChevronRight } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@ai-chat/ui/components/ui/collapsible";
import { useAppTranslation } from "@/components/providers/preferences/i18n-provider";
import { useSetup } from "@/components/providers/setup-provider";
import { SettingsButton } from "@/components/settings/settings-layout";
import { AgentBackendIcon } from "@/lib/agent/agent-backends";
import { cliUpdateStore, describeCliUpdate } from "@/lib/updates/cli-updates";
import type { BuiltinBackendInfo } from "../../../../shared/ipc/agent/agent-ipc";
import { UpdateButton, UpdateRow, UpdatingMark, UpToDateMark } from "./update-row";

const FAILURE_KEYS = {
  failed: "settings.updates.failedShort",
  timeout: "settings.updates.cliTimeout",
  unchanged: "settings.updates.cliUnchanged",
  unavailable: "settings.updates.cliUnavailable",
} as const;

export function CliUpdateRow({ backend, disabled = false }: { backend: BuiltinBackendInfo; disabled?: boolean }) {
  const { t } = useAppTranslation();
  const setup = useSetup();
  const state = useSyncExternalStore(cliUpdateStore.subscribe, cliUpdateStore.getSnapshot);
  const verdict = describeCliUpdate(backend, state);
  const name = backend.displayName;
  const update = () => void cliUpdateStore.update(backend.id, backend.version);
  const trailing = verdict.kind === "updating" ? <UpdatingMark label={t("settings.updates.updating", { name })}>{t("settings.updates.updatingShort")}</UpdatingMark>
    : verdict.kind === "failed" ? <UpdateButton disabled={disabled} onClick={update}>{t("settings.updates.retry")}</UpdateButton>
      : verdict.kind === "available" ? <UpdateButton label={t("settings.updates.updateOne", { name })} disabled={disabled} onClick={update}>{t("settings.updates.upgrade")}</UpdateButton>
        : verdict.kind === "current" ? <UpToDateMark label={t("settings.updates.upToDate", { name })} />
          : <span className="text-xs text-muted-foreground">{t("settings.updates.latestUnknown")}</span>;
  const failure = verdict.kind === "failed" ? verdict.failure : null;
  const latest = backend.updateAvailable || backend.runtimeStatus === "unsupported" ? backend.latestVersion ?? backend.minimumVersion : undefined;
  return <UpdateRow icon={<AgentBackendIcon backend={backend.id} className="size-6" />} name={name} current={backend.version}
    latest={latest !== backend.version ? latest : undefined}
    trailing={trailing}
    failure={failure ? {
      summary: t("settings.updates.failedShort"),
      detail: <Collapsible>
        <p>{t(FAILURE_KEYS[failure.reason])}</p>
        <div className="-ml-3 flex flex-wrap items-center gap-1 pt-2">
          <SettingsButton variant="ghost" disabled={disabled || Boolean(setup.busy[backend.id])} onClick={() => void setup.terminalAction(backend.id, "update")}>
            {t("settings.updates.terminal")}
          </SettingsButton>
          {failure.log && <CollapsibleTrigger asChild>
            <SettingsButton variant="ghost" className="group">
              <ChevronRight aria-hidden="true" className="size-3 transition-transform group-data-[state=open]:rotate-90 motion-reduce:transition-none" />
              {t("settings.updates.log")}
            </SettingsButton>
          </CollapsibleTrigger>}
        </div>
        {failure.log && <CollapsibleContent>
          <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted px-3 py-2 font-mono text-[11px]">{failure.log}</pre>
        </CollapsibleContent>}
      </Collapsible>,
    } : undefined} />;
}
