/**
 * [INPUT]: Depends on React, shared BrowserImportBridgeApi, SettingsPage, Settings layout primitives including SettingsSetupGuide, and BrowserImportDialog
 * [OUTPUT]: Provides BrowserSettingsView: the not-imported face is only the refined setup guide (S21), with this session's last import result kept as one status row under it; the source persists no last-import record, so the guide stays and the result lives for the session
 * [POS]: apps/desktop/src/views/settings/browser; Settings › Browser's product control panel; profile detection runs on mount, while Cookie and Keychain permission prompts are deferred until the user opens the import dialog
 */

import { useCallback, useEffect, useState } from "react";
import { useAppTranslation } from "@/components/providers/preferences/i18n-provider";
import { Globe, Info, Server, ShieldCheck } from "lucide-react";
import { SettingsPage } from "@/components/page-shell";
import { BrowserImportDialog } from "@/components/settings/browser-import-dialog";
import {
  SettingsAlert,
  SettingsButton,
  SettingsCanvas,
  SettingsList,
  SettingsRow,
  SettingsSetupGuide,
} from "@/components/settings/settings-layout";
import type {
  BrowserImportBridgeApi,
  BrowserImportResult,
  ChromeProfile,
} from "../../../../shared/ipc/workspace/browser-import-ipc";

declare global {
  interface Window {
    browserImport?: BrowserImportBridgeApi;
  }
}

/* ── 细则属于入口卡片 ────────────────────────────────────────────
 * 页面只做一件事：从 Chrome 导入登录态。能力细则改写为向导右侧的三条
 * fact；本次导入的结果留在向导下方一行——源侧不持久化导入记录，
 * 所以向导常驻，结果只在本次会话内出现。
 * ─────────────────────────────────────────────────────────── */
export function BrowserSettingsView() {
  const { t } = useAppTranslation();
  const bridge = window.browserImport;
  const [profiles, setProfiles] = useState<ChromeProfile[] | null>(
    bridge ? null : []
  );
  const [importOpen, setImportOpen] = useState(false);
  const [error, setError] = useState("");
  const [platformBlocked, setPlatformBlocked] = useState(false);
  const [result, setResult] = useState<BrowserImportResult | null>(null);

  const detect = useCallback(() => {
    if (!bridge) return;
    void bridge
      .availability()
      .then((availability) => {
        /* A retry clears the previous outcome only once the new one is on the way. */
        setError("");
        setPlatformBlocked(false);
        setProfiles(null);
        if (!availability.available) {
          setProfiles([]);
          setPlatformBlocked(true);
          return [];
        }
        return bridge.detectProfiles();
      })
      .then((next) => {
        setProfiles(next ?? []);
      })
      .catch(() => {
        setProfiles([]);
        setError(t("settings.browser.detectFailed"));
      });
  }, [bridge, t]);

  useEffect(detect, [detect]);

  const canImport = Boolean(profiles?.length) && !importOpen;

  return (
    <SettingsPage title={t("common.browser")}>
      <SettingsCanvas>
        <div className="space-y-4">
          {platformBlocked && (
            <SettingsAlert tone="warn">
              {t("settings.browser.platformUnavailable")}
            </SettingsAlert>
          )}
          {error && (
            <SettingsAlert
              tone="danger"
              title={error}
              action={
                <SettingsButton variant="outline" onClick={detect}>
                  {t("common.retry")}
                </SettingsButton>
              }
            />
          )}
          {profiles?.length === 0 && !platformBlocked && !error && (
            <SettingsAlert tone="warn">
              {t("settings.browser.noProfiles")}
            </SettingsAlert>
          )}
          <SettingsSetupGuide
            icon={<Globe />}
            title={t("settings.browser.guideTitle")}
            description={t("settings.browser.guideDescription")}
            action={
              <SettingsButton
                className="h-9 px-4"
                disabled={!canImport || platformBlocked}
                onClick={() => {
                  setError("");
                  setResult(null);
                  setImportOpen(true);
                }}
              >
                {profiles === null
                  ? t("settings.browser.detecting")
                  : t("settings.browser.guideAction")}
              </SettingsButton>
            }
            facts={[
              {
                icon: <ShieldCheck />,
                title: t("settings.browser.facts.readOnlyTitle"),
                description: t("settings.browser.facts.readOnlyDetail"),
              },
              {
                icon: <Server />,
                title: t("settings.browser.facts.localTitle"),
                description: t("settings.browser.facts.localDetail"),
              },
              {
                icon: <Info />,
                title: t("settings.browser.facts.keychainTitle"),
                description: t("settings.browser.facts.keychainDetail"),
              },
            ]}
          />

          {/* 结果与失败都落回页面：弹窗是一次性的，而结论要留得住 */}
          {result && (
            <SettingsList>
              <SettingsRow
                label={t("settings.browser.lastImport")}
                description={
                  (result.status !== "ok" || result.failed > 0)
                    ? (result.message ?? t("settings.browser.resultFallback"))
                    : undefined
                }
                control={
                  <span className="text-muted-foreground text-sm" role="status">
                    {t("settings.browser.result", {
                      imported: result.imported,
                      skipped: result.skipped,
                      failed: result.failed,
                    })}
                  </span>
                }
              />
            </SettingsList>
          )}
        </div>
      </SettingsCanvas>

      {bridge && profiles && profiles.length > 0 && (
        <BrowserImportDialog
          bridge={bridge}
          onFailed={(message) => {
            setError(message);
            setImportOpen(false);
          }}
          onOpenChange={setImportOpen}
          onSettled={(next) => {
            setResult(next);
            setImportOpen(false);
          }}
          open={importOpen}
          profiles={profiles}
        />
      )}
    </SettingsPage>
  );
}
