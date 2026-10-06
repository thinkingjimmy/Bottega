/**
 * [INPUT]: Depends on canonical settings snapshots, the Memory plugin adapter, i18n and existing Settings/dialog primitives.
 * [OUTPUT]: Provides MemoryPhoneSection with phone status publishing and explicit workflow-read opt-in beside it.
 * [POS]: Existing Memory access section; durable values remain with SettingsOwner and workflow consent never grants capture.
 */
import { useRef, useState, useSyncExternalStore } from "react";
import { ConfirmationDialog } from "@ai-chat/ui/components/ui/app-dialog";
import { useAppTranslation } from "@/components/providers/preferences/i18n-provider";
import { SettingsButton, SettingsList, SettingsRow, SettingsSection, SettingsSwitch } from "@/components/settings/settings-layout";
import { settingsStore } from "@/lib/settings/store/settings-store";
import { pluginsBridge } from "@/lib/apps/plugins-client";

export function MemoryPhoneSection({ checked }: { checked: boolean }) {
  const { t } = useAppTranslation();
  const { settings } = useSyncExternalStore(settingsStore.subscribe, settingsStore.getSnapshot);
  const pending = useRef(false);
  const [saving, setSaving] = useState(false);
  const [retryValue, setRetryValue] = useState<boolean | null>(null);
  const [workflowOpen, setWorkflowOpen] = useState(false);
  const [workflowSaving, setWorkflowSaving] = useState(false);
  const workflowPending = useRef(false);
  const [workflowFailed, setWorkflowFailed] = useState(false);
  const bridge = pluginsBridge(), workflowChecked = settings?.memoryWorkflowRoles === true;
  const workflowReason = settings?.memory.sharingMode === "personal" ? t("memory.workflow.personal")
    : !settings?.memory.pluginEnabled ? t("memory.plugin.serviceDisabled")
    : !settings.memory.enabled || settings.memory.paused ? t("memory.workflow.requiresActive") : null;
  const save = async (memoryPhoneFacade: boolean) => {
    if (pending.current) return;
    pending.current = true; setSaving(true); setRetryValue(null);
    const saved = await settingsStore.update({ memoryPhoneFacade }, t("memory.phone.saveFailed"), { errorScope: "local" });
    setRetryValue(saved ? null : memoryPhoneFacade);
    pending.current = false; setSaving(false);
  };
  const saveWorkflow = async (value: boolean) => {
    if (!bridge || workflowPending.current || value && workflowReason) return;
    workflowPending.current = true; setWorkflowSaving(true); setWorkflowFailed(false);
    try {
      const answer = await bridge.setSettings("memory", { "workflow-roles": value });
      if (answer.status !== "applied") throw new Error("memory-workflow-save-failed");
      setWorkflowOpen(false);
    } catch { setWorkflowFailed(true); }
    finally { workflowPending.current = false; setWorkflowSaving(false); }
  };
  return <><SettingsSection title={t("memory.workflow.sectionTitle")}>
    <SettingsList>
      <SettingsRow label={t("memory.phone.label")} htmlFor="memory-phone-facade" description={<>
        {t("memory.phone.description")}
        {retryValue !== null && <span role="alert" className="mt-1 block text-destructive">
          {t("memory.phone.saveFailed")}{" "}<SettingsButton variant="link" onClick={() => void save(retryValue)}>{t("settings.general.settingsRetry")}</SettingsButton>
        </span>}
      </>} control={<SettingsSwitch id="memory-phone-facade" label={t("memory.phone.label")} describedBy="memory-phone-facade-description"
        checked={checked} disabled={saving} onToggle={value => void save(value)} />} />
      <SettingsRow label={t("memory.workflow.label")} htmlFor="memory-workflow-roles" description={<>
        {t("memory.workflow.description")}
        {workflowReason && <span className="mt-1 block">{workflowReason}</span>}
        {workflowFailed && !workflowOpen && <span role="alert" className="mt-1 block text-destructive">{t("memory.workflow.saveFailed")}</span>}
      </>} control={<SettingsSwitch id="memory-workflow-roles" label={t("memory.workflow.label")} describedBy="memory-workflow-roles-description"
        checked={workflowChecked} disabled={workflowSaving || !bridge || !workflowChecked && !!workflowReason}
        onToggle={value => { setWorkflowFailed(false); if (value) setWorkflowOpen(true); else void saveWorkflow(false); }} />} />
    </SettingsList>
  </SettingsSection><ConfirmationDialog open={workflowOpen} title={t("memory.workflow.consentTitle")}
    description={<div data-memory-workflow-consent=""><p>{t("memory.workflow.consentBody")}</p>
      {workflowFailed && <p role="alert" className="mt-2 text-destructive">{t("memory.workflow.saveFailed")}</p>}</div>}
    confirmLabel={t("memory.workflow.confirm")} cancelLabel={t("common.cancel")} busy={workflowSaving}
    confirmDisabled={!!workflowReason} onOpenChange={setWorkflowOpen} onConfirm={() => void saveWorkflow(true)} /></>;
}
