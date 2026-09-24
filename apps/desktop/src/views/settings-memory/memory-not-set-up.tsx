/**
 * [INPUT]: Depends on React open state, lucide Brain/Server/ShieldCheck/Trash2 icons, Settings primitives (section, list, row, badge, button, surface, note list), the memory setup target/stage helpers, MemoryOperationProgress, MemorySetupDialog and i18n
 * [OUTPUT]: Provides MemoryNotSetUp — Settings › Memory before any engine passes the configuration gate: one "Long-term memory" row whose badge, description and action follow the setup stage (Not set up · Set Up…, Installing · Show Progress with live progress below, Installed · Connect…, failed · Set Up…), a "Before you start" note list, and the setup dialog those actions open
 * [POS]: The not-set-up face of MemorySettingsView; it speaks the ordinary Settings grammar while the three steps themselves live in memory-setup-dialog
 */

import { useState } from "react";
import { Brain, Server, ShieldCheck, Trash2 } from "lucide-react";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { MemoryOperationProgress } from "@/components/settings/memory/memory-runtime-panel";
import {
  SettingsBadge,
  SettingsButton,
  SettingsList,
  SettingsNoteList,
  SettingsRow,
  SettingsSection,
  SettingsSurface,
} from "@/components/settings/settings-layout";
import { MemorySetupDialog } from "./memory-setup-dialog";
import {
  memoryRuntimeStepText,
  memorySetupStage,
  memorySetupTarget,
  type MemorySetupProps,
} from "./memory-setup";

/* 还没装好时，这一页说的仍是 Settings 的话：一行、一个徽标、一个动作。
   三步设置收进分步弹窗；安装在后台跑时，行本身就是进度——关掉弹窗
   不等于看不见它。 */
export function MemoryNotSetUp(props: MemorySetupProps) {
  const { t } = useAppTranslation();
  const [open, setOpen] = useState(false);
  const { active } = memorySetupTarget(props.descriptors, props.runtimes, props.selectedId);
  const runtime = props.runtimes[active.id] ?? null;
  const stage = memorySetupStage(runtime);
  const provider = active.displayName;
  const installing = stage === 2 && runtime?.phase === "running";
  const failed = stage === 2 && !installing;

  const badge =
    stage === 3 ? <SettingsBadge>{t("memory.setup.row.installed")}</SettingsBadge>
      : installing ? <SettingsBadge>{t("memory.setup.row.installing")}</SettingsBadge>
        : failed ? <SettingsBadge tone={runtime?.error ? "danger" : "warn"}>
          {runtime?.error ? t("memory.setup.row.failed") : t("memory.backend.interrupted")}
        </SettingsBadge>
          : <SettingsBadge tone="muted">{t("memory.setup.row.notSetUp")}</SettingsBadge>;
  const description =
    stage === 3 ? t("memory.setup.row.connectDescription", {
      provider,
      version: runtime?.installedVersion ?? active.lockedVersion ?? "",
    })
      : installing ? t("memory.setup.row.installingDescription", { provider })
        : failed ? t("memory.setup.row.failedDescription", { provider })
          : t("memory.setup.row.description");
  const action =
    installing ? <SettingsButton variant="ghost" onClick={() => setOpen(true)}>{t("memory.setup.row.showProgress")}</SettingsButton>
      : <SettingsButton onClick={() => setOpen(true)}>
        {stage === 3 ? t("memory.setup.row.connect") : t("memory.setup.row.setUp")}
      </SettingsButton>;

  return (
    <div className="space-y-8">
      <SettingsSection title={t("memory.page.title")}>
        <SettingsList>
          <div data-memory-setup-row={installing ? "installing" : failed ? "failed" : stage === 3 ? "connect" : "start"}>
            <SettingsRow
              leading={
                <span className="flex size-9 shrink-0 items-center justify-center rounded-[9px] bg-muted ring-1 ring-foreground/5 ring-inset">
                  <Brain className="size-[18px]" aria-hidden="true" />
                </span>
              }
              label={t("memory.page.title")}
              badge={badge}
              description={<span role={installing ? "status" : undefined}>{description}</span>}
              control={action}
            />
            {installing && runtime && (
              <div className="-mt-1 pr-4 pb-3 pl-[4.75rem]">
                <MemoryOperationProgress runtime={runtime} stepText={memoryRuntimeStepText(runtime, t)} />
              </div>
            )}
          </div>
        </SettingsList>
      </SettingsSection>
      <SettingsSection title={t("memory.setup.notes.title")}>
        <SettingsSurface className="p-4">
          <SettingsNoteList
            items={[
              { icon: <ShieldCheck />, term: t("memory.setup.notes.localTerm"), detail: t("memory.setup.notes.localDetail") },
              { icon: <Server />, term: t("memory.setup.notes.modelTerm"), detail: t("memory.setup.notes.modelDetail") },
              { icon: <Trash2 />, term: t("memory.setup.notes.removeTerm"), detail: t("memory.setup.notes.removeDetail") },
            ]}
          />
        </SettingsSurface>
      </SettingsSection>
      <MemorySetupDialog open={open} onOpenChange={setOpen} {...props} />
    </div>
  );
}
