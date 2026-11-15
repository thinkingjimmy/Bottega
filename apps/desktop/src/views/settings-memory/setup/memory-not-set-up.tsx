/**
 * [INPUT]: Depends on React open state, lucide Brain/Server/ShieldCheck/Trash2 icons, Settings primitives (SettingsSetupGuide, list, row, badge, button, note list), the memory setup target/stage helpers, MemoryOperationProgress, MemorySetupDialog and i18n
 * [OUTPUT]: Provides MemoryNotSetUp — Settings › Memory before any engine passes the configuration gate: stage 1 renders only the refined setup guide (S21) whose facts carry the "Before you start" notes; installing, installed and failed stages keep the status row whose badge, description and action follow the setup stage (Installing · Show Progress with live progress below, Installed · Connect…, failed · Set Up…), and the setup dialog those actions open
 * [POS]: The not-set-up face of MemorySettingsView; the guide owns the one call to action while the three steps themselves live in memory-setup-dialog
 */

import { useState } from "react";
import { ArrowUpRight, Brain, Server, ShieldCheck, Trash2 } from "lucide-react";
import { useAppTranslation } from "@/components/providers/preferences/i18n-provider";
import { MemoryOperationProgress } from "@/components/settings/memory/runtime/memory-runtime-panel";
import {
  SettingsBadge,
  SettingsButton,
  SettingsList,
  SettingsRow,
  SettingsSection,
  SettingsSetupGuide,
} from "@/components/settings/settings-layout";
import { MemorySetupDialog } from "./memory-setup-dialog";
import {
  memoryRuntimeStepText,
  memorySetupStage,
  memorySetupTarget,
  type MemorySetupProps,
} from "./memory-setup";

/* 还没装好时，向导自己说出唯一的行动——头版因此不再挂刷新或主按钮（S21）；
   已经开始的安装、失败与待连接仍用行说话：行本身就是进度。 */
export function MemoryNotSetUp({ onAbout, ...props }: MemorySetupProps & { onAbout?(): void }) {
  const { t } = useAppTranslation();
  const [open, setOpen] = useState(false);
  const { active } = memorySetupTarget(props.descriptors, props.runtimes, props.selectedId);
  const runtime = props.runtimes[active.id] ?? null;
  const stage = memorySetupStage(runtime);
  const provider = active.displayName;
  const installing = stage === 2 && runtime?.phase === "running";
  const failed = stage === 2 && !installing;

  if (stage === 1) {
    return (
      <>
        <SettingsSetupGuide
          icon={<Brain />}
          title={t("memory.setup.guide.title")}
          description={t("memory.setup.guide.description")}
          action={
            <SettingsButton className="h-9 px-4" onClick={() => setOpen(true)}>
              {t("memory.setup.guide.action")}
            </SettingsButton>
          }
          secondaryAction={
            onAbout && (
              <button
                type="button"
                className="inline-flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground"
                onClick={onAbout}
                data-plugin-about-link=""
              >
                {t("memory.plugin.about")}
                <ArrowUpRight aria-hidden className="size-3.5" />
              </button>
            )
          }
          facts={[
            { icon: <ShieldCheck />, title: t("memory.setup.notes.localTerm"), description: t("memory.setup.notes.localDetail") },
            { icon: <Server />, title: t("memory.setup.notes.modelTerm"), description: t("memory.setup.notes.modelDetail") },
            { icon: <Trash2 />, title: t("memory.setup.notes.removeTerm"), description: t("memory.setup.notes.removeDetail") },
          ]}
        />
        <MemorySetupDialog open={open} onOpenChange={setOpen} {...props} />
      </>
    );
  }

  const badge =
    stage === 3 ? <SettingsBadge>{t("memory.setup.row.installed")}</SettingsBadge>
      : installing ? <SettingsBadge>{t("memory.setup.row.installing")}</SettingsBadge>
        : <SettingsBadge tone={runtime?.error ? "danger" : "warn"}>
          {runtime?.error ? t("memory.setup.row.failed") : t("memory.backend.interrupted")}
        </SettingsBadge>;
  const description =
    stage === 3 ? t("memory.setup.row.connectDescription", {
      provider,
      version: runtime?.installedVersion ?? active.lockedVersion ?? "",
    })
      : installing ? t("memory.setup.row.installingDescription", { provider })
        : t("memory.setup.row.failedDescription", { provider });
  const action =
    installing ? <SettingsButton variant="ghost" onClick={() => setOpen(true)}>{t("memory.setup.row.showProgress")}</SettingsButton>
      : <SettingsButton onClick={() => setOpen(true)}>
        {stage === 3 ? t("memory.setup.row.connect") : t("memory.setup.row.setUp")}
      </SettingsButton>;

  return (
    <div className="space-y-8">
      <SettingsSection title={t("memory.page.title")}>
        <SettingsList>
          <div data-memory-setup-row={installing ? "installing" : failed ? "failed" : "connect"}>
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
      <MemorySetupDialog open={open} onOpenChange={setOpen} {...props} />
    </div>
  );
}
