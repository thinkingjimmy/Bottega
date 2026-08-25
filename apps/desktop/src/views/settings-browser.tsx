/**
 * [INPUT]: Depends on React, shared BrowserImportBridgeApi, PageShell, Settings layout and BrowserImportDialog
 * [OUTPUT]: Provides BrowserSettingsView: The entire page is imported into a single group, the Chrome login entry with the "Learn More" unseparated line is inserted into the same card, the ability details are folded, the import results and failures remain on the page
 * [POS]: Settings › Browser product control panel; Profile detection occurs when uploaded, and reading both Cookie and Keychain permissions is delayed until the user opens the pop-up window
 */

import { useEffect, useState } from "react";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { GlobeIcon, LoaderCircleIcon } from "lucide-react";
import { PageShell } from "@/components/page-shell";
import { BrowserImportDialog } from "@/components/settings/browser-import-dialog";
import {
  SettingsButton,
  SettingsCanvas,
  SettingsDisclosure,
  SettingsList,
  SettingsNoteList,
  SettingsRow,
  SettingsSection,
} from "@/components/settings/settings-layout";
import type {
  BrowserImportBridgeApi,
  BrowserImportResult,
  ChromeProfile,
} from "../../shared/browser-import-ipc";

declare global {
  interface Window {
    browserImport?: BrowserImportBridgeApi;
  }
}

/* ── 细则属于入口卡片 ────────────────────────────────────────────
 * 页面只做一件事：从 Chrome 导入登录态。两条能力细则解释的是入口，
 * 因此折叠触发器与入口共用一张卡片、同一个内容块；两者之间不画分割线，
 * 卡片外也不再悬着一段前置说明和按钮。
 * ─────────────────────────────────────────────────────────── */
export function BrowserSettingsView() {
  const { t } = useAppTranslation();
  const bridge = window.browserImport;
  const [profiles, setProfiles] = useState<ChromeProfile[] | null>(
    bridge ? null : []
  );
  const [importOpen, setImportOpen] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<BrowserImportResult | null>(null);

  useEffect(() => {
    if (!bridge) return;
    let live = true;
    void bridge
      .detectProfiles()
      .then((next) => {
        if (live) setProfiles(next);
      })
      .catch(() => {
        if (!live) return;
        setProfiles([]);
        setError(t("settings.browser.detectFailed"));
      });
    return () => {
      live = false;
    };
  }, [bridge, t]);

  const capabilityNotes = [
    {
      term: t("settings.browser.capability.persistentTitle"),
      detail: t("settings.browser.capability.persistentDetail"),
    },
    {
      term: t("settings.browser.capability.limitedTitle"),
      detail: t("settings.browser.capability.limitedDetail"),
    },
  ];

  return (
    <PageShell title={t("common.browser")} icon={<GlobeIcon />}>
      <SettingsCanvas>
        <div className="space-y-8">
          <SettingsSection
            title={t("settings.browser.sectionTitle")}
            alert={error}
          >
            <SettingsList>
              {/* SettingsList 只看见一个直接子项，因此不会在入口与细则之间
                  生成 divide-y；它们本来就是同一项，不该伪装成两行设置。 */}
              <div>
                <SettingsRow
                  label={t("settings.browser.loginState")}
                  htmlFor="browser-import-open"
                  description={
                    profiles === null
                      ? t("settings.browser.detecting")
                      : profiles.length
                        ? t("settings.browser.readyDescription")
                        : t("settings.browser.noProfiles")
                  }
                  control={
                    profiles === null ? (
                      <LoaderCircleIcon
                        aria-label={t("settings.browser.detectingAria")}
                        className="size-4 animate-spin text-muted-foreground"
                      />
                    ) : (
                      <SettingsButton
                        /* SettingsRow 的 `<label for>` 会盖掉按钮自身的可访问名，
                         * 于是它对外自称「Chrome 登录态」而屏幕上写着「开始导入」——
                         * 可见名不在可访问名之内（WCAG 2.5.3），语音控制念屏幕上那四个字
                         * 反而点不动它。aria-label 优先级高于 label 元素，
                         * 在这里把可见文案接回名字，行标题降为上下文。 */
                        aria-label={t("settings.browser.startImportAria")}
                        disabled={!profiles.length}
                        id="browser-import-open"
                        onClick={() => {
                          setError("");
                          setResult(null);
                          setImportOpen(true);
                        }}
                        variant="outline"
                      >
                        {t("settings.browser.startImport")}
                      </SettingsButton>
                    )
                  }
                />
                <div className="px-4 pb-2">
                  <SettingsDisclosure label={t("settings.browser.learnMore")}>
                    <SettingsNoteList items={capabilityNotes} />
                  </SettingsDisclosure>
                </div>
              </div>
            </SettingsList>

            {result && (
              <div
                className="rounded-lg bg-card px-4 py-3 text-sm ring-1 ring-foreground/10"
                role="status"
              >
                <p className="font-medium">
                  {t("settings.browser.result", {
                    imported: result.imported,
                    skipped: result.skipped,
                    failed: result.failed,
                  })}
                </p>
                {(result.status !== "ok" || result.failed > 0) && (
                  <p className="mt-1 text-muted-foreground text-xs leading-relaxed">
                    {result.message ?? t("settings.browser.resultFallback")}
                  </p>
                )}
              </div>
            )}
          </SettingsSection>
        </div>
      </SettingsCanvas>

      {/* 结果与失败都落回页面：弹窗是一次性的，而结论要留得住 */}
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
    </PageShell>
  );
}
