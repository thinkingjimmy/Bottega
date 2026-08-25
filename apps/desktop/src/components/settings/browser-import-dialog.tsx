/**
 * [INPUT]: Depends on React, i18n, shared BrowserImportBridgeApi/ChromeProfile, ui AppDialogContent/Dialog/Select, settings-layout with SettingsAlert/SettingsButton and lucide icons
 * [OUTPUT]: Provides BrowserImportDialog: profile single selection, cookie domain default full selection, "can't read vs. not" separated preview failure and retest, Keychain information tips and importing actions
 * [POS]: Settings › Browser's one-time directory board; Only when a user clicks on the input is Keychain authorization triggered and the cookie is written, resulting in a page shutdown
 */

import { useEffect, useMemo, useState } from "react";
import { LoaderCircleIcon } from "lucide-react";
import {
  AppDialogBody,
  AppDialogContent,
} from "@ai-chat/ui/components/ui/app-dialog";
import {
  SettingsAlert,
  SettingsButton,
} from "@/components/settings/settings-layout";
import { errorMessage } from "@/lib/errors";
import { SlimScroller } from "@ai-chat/ui/components/ui/slim-scroller";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@ai-chat/ui/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@ai-chat/ui/components/ui/select";
import type {
  BrowserImportBridgeApi,
  BrowserImportResult,
  ChromeCookieDomain,
  ChromeProfile,
} from "../../../shared/browser-import-ipc";
import { useAppTranslation } from "@/components/providers/i18n-provider";

/* ── 「读不到」不是「没有」 ────────────────────────────────────────
 * 域名列表曾用 `ChromeCookieDomain[]` 加一个 loading 布尔表达，于是预览失败时
 * 数组停在空，界面便一口咬定「这个 profile 没有可导入的持久 Cookie」——
 * 那是它并不知道的事。空与未知长得一样，就迟早会把未知说成空。
 * 让状态自己把两者分开，界面便无从说谎。
 * ─────────────────────────────────────────────────────────── */
type CookieDomainsState =
  | { kind: "loading" }
  | { kind: "ready"; domains: ChromeCookieDomain[] }
  | { kind: "failed"; detail: string };

/** 非 ready 态的空清单用同一个常量，渲染引用才稳定 */
const NO_DOMAINS: readonly ChromeCookieDomain[] = [];

export function BrowserImportDialog({
  bridge,
  profiles,
  open,
  onOpenChange,
  onSettled,
  onFailed,
}: {
  bridge: BrowserImportBridgeApi;
  profiles: ChromeProfile[];
  open: boolean;
  onOpenChange(next: boolean): void;
  onSettled(result: BrowserImportResult): void;
  onFailed(message: string): void;
}) {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <AppDialogContent className="sm:max-w-[34rem]">
        {/* 面板内容独立成组件：Radix 关闭即卸载，于是每次打开都是全新一次导入。
            生命周期本身就是重置，不必再手写任何 reset 分支。 */}
        <ImportPanel
          bridge={bridge}
          onCancel={() => onOpenChange(false)}
          onFailed={onFailed}
          onSettled={onSettled}
          profiles={profiles}
        />
      </AppDialogContent>
    </Dialog>
  );
}

function ImportPanel({
  bridge,
  profiles,
  onCancel,
  onSettled,
  onFailed,
}: {
  bridge: BrowserImportBridgeApi;
  profiles: ChromeProfile[];
  onCancel(): void;
  onSettled(result: BrowserImportResult): void;
  onFailed(message: string): void;
}) {
  const { t } = useAppTranslation();
  const [profile, setProfile] = useState(profiles[0]?.directory ?? "");
  const [domainsState, setDomainsState] = useState<CookieDomainsState>({
    kind: "loading",
  });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const [reloadToken, setReloadToken] = useState(0);

  /* 「回到读取中」是一次转场，归发起转场的那一方——切 profile 与重试都是
   * 用户动作，就由动作自己把界面拨回 loading；首次读取则根本不需要它，
   * 初始状态本就是 loading。取数因此永远不必同步 setState。 */
  const resetPreview = () => {
    setDomainsState({ kind: "loading" });
    setSelected(new Set());
    setPreviewError("");
  };

  /* 一处取数，两处触发：切 profile 改的是 profile，重试递增 token，
   * 两者都只是把新的依赖交给同一个 effect。若让重试另走一条取数路径，
   * 「取消上一次在途请求」这件事就得在两处各写一遍——写两遍即迟早写岔。
   * 预览也只在面板打开期间发生：不开面板就不去翻用户的 Chrome 数据。 */
  useEffect(() => {
    if (!profile) return;
    let live = true;
    void bridge
      .previewCookieDomains({ profileDirectory: profile })
      .then((next) => {
        if (!live) return;
        setDomainsState({ kind: "ready", domains: next });
        setSelected(new Set(next.map((item) => item.domain)));
      })
      .catch((cause: unknown) => {
        if (!live) return;
        setDomainsState({
          kind: "failed",
          detail: errorMessage(cause, t("settings.browser.previewUnknown")),
        });
        setPreviewError(t("settings.browser.previewFailed"));
      });
    return () => {
      live = false;
    };
  }, [bridge, profile, reloadToken, t]);

  const domains =
    domainsState.kind === "ready" ? domainsState.domains : NO_DOMAINS;
  const selectedCount = selected.size;
  const allSelected = domains.length > 0 && selectedCount === domains.length;
  const totalCookies = useMemo(
    () =>
      domainsState.kind === "ready"
        ? domainsState.domains
            .filter((item) => selected.has(item.domain))
            .reduce((sum, item) => sum + item.cookieCount, 0)
        : 0,
    [domainsState, selected]
  );

  const toggleAll = () =>
    setSelected(
      allSelected ? new Set() : new Set(domains.map((item) => item.domain))
    );
  const toggleDomain = (domain: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(domain)) next.delete(domain);
      else next.add(domain);
      return next;
    });

  const startImport = async () => {
    if (!profile || selectedCount === 0) return;
    setImporting(true);
    try {
      onSettled(
        await bridge.importCookies({
          profileDirectory: profile,
          domains: [...selected],
        })
      );
    } catch {
      onFailed(t("settings.browser.importFailed"));
    } finally {
      setImporting(false);
    }
  };

  return (
    <>
      <DialogHeader className="shrink-0 gap-0 text-left">
        <DialogTitle className="font-semibold text-lg">
          {t("settings.browser.dialogTitle")}
        </DialogTitle>
        <DialogDescription className="mt-2 text-muted-foreground text-xs">
          {t("settings.browser.dialogDescription")}
        </DialogDescription>
      </DialogHeader>

      <AppDialogBody className="mt-4 space-y-4">
        <div className="flex items-center justify-between gap-4">
          <label
            className="font-medium text-sm"
            htmlFor="browser-chrome-profile"
          >
            {t("settings.browser.profile")}
          </label>
          <Select
            onValueChange={(next) => {
              resetPreview();
              setProfile(next);
            }}
            value={profile}
          >
            <SelectTrigger
              aria-label={t("settings.browser.profile")}
              className="w-56"
              size="lg"
              id="browser-chrome-profile"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
              {profiles.map((item) => (
                <SelectItem
                  className="cursor-pointer"
                  key={item.directory}
                  value={item.directory}
                >
                  {item.name} · {item.directory}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {previewError && <SettingsAlert>{previewError}</SettingsAlert>}

        <div>
          <div className="mb-2 flex items-center justify-between gap-3">
            <div>
              <p className="font-medium text-sm">
                {t("settings.browser.cookieDomains")}
              </p>
              {/* 只有真读到了才敢报数——读不到时任何数字都是编的 */}
              {domainsState.kind === "ready" &&
                domainsState.domains.length > 0 && (
                  <p className="mt-1 text-muted-foreground text-xs">
                    {t("settings.browser.selectedDomains", {
                      domains: selectedCount,
                      cookies: totalCookies,
                    })}
                  </p>
                )}
            </div>
            <SettingsButton
              disabled={domains.length === 0}
              onClick={toggleAll}
              variant="ghost"
            >
              {allSelected
                ? t("settings.browser.deselectAll")
                : t("settings.browser.selectAll")}
            </SettingsButton>
          </div>
          {domainsState.kind === "loading" ? (
            <div
              aria-live="polite"
              className="flex items-center gap-2 py-4 text-muted-foreground text-xs"
            >
              <LoaderCircleIcon className="size-4 animate-spin" />
              {t("settings.browser.loadingDomains")}
            </div>
          ) : domainsState.kind === "failed" ? (
            <div className="flex items-start justify-between gap-3 rounded-md border border-dashed px-3 py-3">
              <div className="min-w-0">
                <p className="text-xs">
                  {t("settings.browser.previewFailureTruth")}
                </p>
                <p className="mt-1 break-words font-mono text-[11px] text-muted-foreground">
                  {domainsState.detail}
                </p>
              </div>
              <SettingsButton
                className="shrink-0"
                onClick={() => {
                  resetPreview();
                  setReloadToken((token) => token + 1);
                }}
                variant="outline"
              >
                {t("common.retry")}
              </SettingsButton>
            </div>
          ) : domains.length ? (
            <SlimScroller className="max-h-64 overflow-y-auto rounded-md border">
              {domains.map((item) => (
                <label
                  className="flex min-h-10 cursor-pointer items-center gap-3 border-b px-3 text-xs last:border-b-0 hover:bg-muted/40"
                  key={item.domain}
                >
                  <input
                    checked={selected.has(item.domain)}
                    className="size-4 accent-foreground"
                    onChange={() => toggleDomain(item.domain)}
                    type="checkbox"
                  />
                  <span className="min-w-0 flex-1 truncate font-mono">
                    {item.domain}
                  </span>
                  <span className="text-muted-foreground">
                    {item.cookieCount}
                  </span>
                </label>
              ))}
            </SlimScroller>
          ) : (
            <p className="py-3 text-muted-foreground text-xs">
              {t("settings.browser.noCookies")}
            </p>
          )}
        </div>

        <p className="text-muted-foreground text-xs leading-relaxed">
          {t("settings.browser.keychainNotice")}
        </p>
      </AppDialogBody>

      <DialogFooter className="mt-5 shrink-0 flex-row justify-end gap-3">
        <SettingsButton
          disabled={importing}
          onClick={onCancel}
          variant="ghost"
        >
          {t("common.cancel")}
        </SettingsButton>
        <SettingsButton
          disabled={
            importing || domainsState.kind !== "ready" || selectedCount === 0
          }
          onClick={() => void startImport()}
        >
          {importing && <LoaderCircleIcon className="animate-spin" />}
          {t("settings.browser.importAction")}
        </SettingsButton>
      </DialogFooter>
    </>
  );
}
