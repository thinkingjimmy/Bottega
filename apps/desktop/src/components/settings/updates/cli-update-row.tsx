/**
 * [INPUT]: Depends on the Setup context's terminal fallback, lib/updates CLI verdicts and store, Agent identity, ui Collapsible and Updates i18n
 * [OUTPUT]: Provides CliUpdateRow — one installed provider CLI with its one-click update, progress, verified failure, log and Terminal fallback
 * [POS]: Provider row of Settings › Updates; the Bottega row is AppUpdateRow, both share UpdateRow
 */

import { useSyncExternalStore } from "react";
import { ChevronRight } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@ai-chat/ui/components/ui/collapsible";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { useSetup } from "@/components/providers/setup-provider";
import { SettingsButton } from "@/components/settings/settings-layout";
import { AgentBackendIcon } from "@/lib/agent-backends";
import { cliUpdateStore, describeCliUpdate } from "@/lib/updates/cli-updates";
import type { BackendInfo } from "../../../../shared/agent-ipc";
import { FailedMark, UpdateButton, UpdateRow, UpdatingMark, UpToDateMark } from "./update-row";

const FAILURE_KEYS = {
  failed: "settings.updates.cliFailed",
  timeout: "settings.updates.cliTimeout",
  unchanged: "settings.updates.cliUnchanged",
  unavailable: "settings.updates.cliUnavailable",
} as const;

export function CliUpdateRow({ backend }: { backend: BackendInfo }) {
  const { t } = useAppTranslation();
  const setup = useSetup();
  const state = useSyncExternalStore(cliUpdateStore.subscribe, cliUpdateStore.getSnapshot);
  const verdict = describeCliUpdate(backend, state);
  const name = backend.displayName;
  const update = () => void cliUpdateStore.update(backend.id, backend.version);
  const trailing = verdict.kind === "updating" ? <UpdatingMark label={t("settings.updates.updating", { name })} />
    : verdict.kind === "failed" ? <FailedMark label={t("settings.updates.cliFailed")} />
    : verdict.kind === "available" ? <UpdateButton label={t("settings.updates.updateOne", { name })} onClick={update} />
      : verdict.kind === "current" ? <UpToDateMark label={t("settings.updates.upToDate", { name })} />
        : <span className="text-muted-foreground text-xs">{t("settings.updates.latestUnknown")}</span>;
  const failure = verdict.kind === "failed" ? verdict.failure : null;
  return <UpdateRow icon={<AgentBackendIcon backend={backend.id} className="size-5" />} name={name} current={backend.version}
    latest={verdict.kind === "available" && verdict.latest && verdict.latest !== backend.version ? verdict.latest : undefined}
    trailing={trailing}
    detail={failure && <Collapsible>
      <p role="alert" className="text-destructive text-xs">{t(FAILURE_KEYS[failure.reason])}</p>
      <div className="flex flex-wrap items-center gap-2 pt-2">
        <SettingsButton variant="outline" onClick={update}>{t("settings.updates.retry")}</SettingsButton>
        <SettingsButton variant="ghost" disabled={Boolean(setup.busy[backend.id])} onClick={() => void setup.terminalAction(backend.id, "update")}>
          {t("settings.updates.terminal")}
        </SettingsButton>
        {failure.log && <CollapsibleTrigger className="group flex cursor-pointer items-center gap-1 rounded-sm text-muted-foreground text-xs outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40">
          <ChevronRight aria-hidden="true" className="size-3 transition-transform group-data-[state=open]:rotate-90 motion-reduce:transition-none" />
          {t("settings.updates.log")}
        </CollapsibleTrigger>}
      </div>
      {failure.log && <CollapsibleContent>
        <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted px-3 py-2 font-mono text-[11px] text-muted-foreground">{failure.log}</pre>
      </CollapsibleContent>}
    </Collapsible>} />;
}
