/**
 * [INPUT]: Depends on scoped install ports, package disclosure, localized copy, native selection and Settings dialog controls.
 * [OUTPUT]: Provides ExtensionInstallDialog and ExtensionInstallSource for GitHub/local preview, exact-byte confirmation and App migration choices.
 * [POS]: apps/desktop/src/components/settings/extensions; Shared frozen preview; Plugins and Extensions remain family-bound and unconfirmed receipts are discarded on close.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AppDialogBody,
  AppDialogContent,
} from "@ai-chat/ui/components/ui/app-dialog";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@ai-chat/ui/components/ui/dialog";
import { Input } from "@ai-chat/ui/components/ui/input";
import {
  SettingsButton,
  SettingsList,
  SettingsNoteList,
  SettingsRow,
  SettingsSwitch,
} from "@/components/settings/settings-layout";
import {
  confirmExtension,
  discardExtensionPreflight,
  preflightExtension,
  preflightLocalExtension,
  localExtensionInstallAvailable,
} from "@/lib/clients/extensions-client";
import { errorMessage } from "@ai-chat/ui/lib/errors";
import type {
  ExtensionPreflightView,
  ExtensionsSnapshot,
} from "../../../../shared/ipc/settings/extensions-ipc";
import {
  GLOBAL_PRODUCT_RESOURCE_SCOPE,
  type ScopedResourceVersion,
} from "../../../../shared/product/product-resource-scope";
import { useAppTranslation } from "@/components/providers/preferences/i18n-provider";
import { packageCopy } from "@ai-chat/ui/lib/plugin-install/copy";
import { packageDisclosureCopy, packagePermissionLabels } from "@ai-chat/ui/lib/plugin-install/disclosure";

/* ── 一颗种子分开两个入口 ────────────────────────────────────────
 * 「安装新扩展」与「检查某个已装扩展的更新」在产品语义上是两件事，
 * 在流水线上却是同一条：解析来源 → 披露能力 → 选择迁移 → 确认。
 * 差别只有一个——后者知道要解析哪个仓库。于是不必有两个组件，
 * 只需要一颗可空的种子：repoUrl 为空即空表单，非空即直奔预检。
 * ─────────────────────────────────────────────────────────── */
export type ExtensionInstallSource = {
  remoteRequestId?: string;
  repoUrl: string;
  requestedRef?: string;
  subdirectory?: string;
};

type Stage = "source" | "install" | "update";

export function ExtensionInstallDialog({
  source,
  surface,
  authority = {
    scope: GLOBAL_PRODUCT_RESOURCE_SCOPE,
    projectLifecycleRevision: null,
    scopeRevision: 0,
  },
  authorityEpoch = 0,
  onOpenChange,
  onInstalled,
}: {
  /** null 即关闭；非 null 时 repoUrl 为空是新装、非空是带来源的更新检查 */
  source: ExtensionInstallSource | null;
  surface?: "plugins";
  authority?: ScopedResourceVersion;
  onOpenChange: (next: boolean) => void;
  onInstalled: (snapshot: ExtensionsSnapshot, authorityEpoch: number) => void;
  authorityEpoch?: number;
}) {
  return (
    <Dialog onOpenChange={onOpenChange} open={source !== null}>
      <AppDialogContent className="sm:max-w-[34rem]">
        {/* 面板独立成组件：Radix 关闭即卸载，于是每次打开都是全新一次安装，
            生命周期本身就是重置，不必手写任何 reset 分支。 */}
        {source && (
          <InstallPanel
            onClose={() => onOpenChange(false)}
            onInstalled={onInstalled}
            authority={authority}
            authorityEpoch={authorityEpoch}
            source={source}
            surface={surface}
          />
        )}
      </AppDialogContent>
    </Dialog>
  );
}

function InstallPanel({
  source,
  surface,
  authority,
  authorityEpoch,
  onClose,
  onInstalled,
}: {
  source: ExtensionInstallSource;
  surface?: "plugins";
  authority: ScopedResourceVersion;
  authorityEpoch: number;
  onClose: () => void;
  onInstalled: (snapshot: ExtensionsSnapshot, authorityEpoch: number) => void;
}) {
  const { t, i18n } = useAppTranslation();
  const copy = packageCopy(i18n.language);
  const installationError = useCallback((cause: unknown, fallback: string) => {
    const message = errorMessage(cause, fallback);
    return message.includes("plugin-request-unavailable") ? copy.unavailable : message;
  }, [copy.unavailable]);
  const [repoUrl, setRepoUrl] = useState(source.repoUrl);
  const [preflight, setPreflight] = useState<ExtensionPreflightView | null>(
    null
  );
  const [migrating, setMigrating] = useState<readonly string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [localAvailable, setLocalAvailable] = useState(false);
  useEffect(() => {
    let alive = true;
    void localExtensionInstallAvailable(surface).then(value => { if (alive) setLocalAvailable(value); }).catch(() => {});
    return () => { alive = false; };
  }, [surface]);
  const authorityEpochRef = useRef(authorityEpoch);
  useEffect(() => {
    authorityEpochRef.current = authorityEpoch;
  }, [authorityEpoch]);
  const operationEpoch = useRef(0);

  /* ── 未确认的预检只归这一处管 ──────────────────────────────────
   * 预检在 main 侧留着实体（解析出的 commit 与 staging），确认之前它不属于
   * 任何人。旧版只在「取消」按钮上丢弃它，于是 Esc、点弹窗外、点 × 三条
   * 同样合法的离开路径各漏一份。出口有四个而清理只有一个，账就永远对不上。
   *
   * 改由卸载清理统一收口：离开这个面板 = 丢弃未确认的预检，一条规则覆盖
   * 全部出口。确认成功后把账号清零——它已被消费，再丢就是丢别人的东西。
   * alive 与 preflightId 同住一个 ref：两者都是「比渲染活得久」的事实，
   * 在飞的预检落地时若面板已经走了，就地丢弃，不留悬空的 staging。
   * ─────────────────────────────────────────────────────────── */
  const pending = useRef({ alive: true, preflightId: "" });
  useEffect(
    () => () => {
      pending.current.alive = false;
      if (pending.current.preflightId)
        void discardExtensionPreflight(pending.current.preflightId);
    },
    []
  );

  /* 解析期间输入框一并禁用，于是「在飞」这件事只由禁用态守住，
     resolve 不必自带重入判断，也就没有依赖可漂移。 */
  const resolve = useCallback(async (input: ExtensionInstallSource | null) => {
    const operation = ++operationEpoch.current;
    const authorityReceipt = authorityEpoch;
    setBusy(true);
    setError("");
    try {
      const authorityInput = {
        ...(surface ? { surface } : {}),
        scope: authority.scope,
        expectedProjectLifecycleRevision:
          authority.projectLifecycleRevision,
        expectedScopeRevision: authority.scopeRevision,
      };
      const next = input ? await preflightExtension({...input, ...authorityInput}) : await preflightLocalExtension(authorityInput);
      if (!next) return;
      if (
        !pending.current.alive ||
        operation !== operationEpoch.current ||
        authorityReceipt !== authorityEpochRef.current
      ) {
        void discardExtensionPreflight(next.preflightId);
        return;
      }
      pending.current.preflightId = next.preflightId;
      setPreflight(next);
    } catch (cause) {
      if (
        operation === operationEpoch.current &&
        authorityReceipt === authorityEpochRef.current
      ) {
        setError(
          installationError(cause, t("settings.extensions.install.resolveFailed"))
        );
      }
    } finally {
      if (
        operation === operationEpoch.current &&
        authorityReceipt === authorityEpochRef.current
      ) setBusy(false);
    }
  }, [authority, authorityEpoch, surface, t, installationError]);

  /* 带着来源打开就直接解析：用户点的是「检查更新」，不是「再填一次地址」。
     种子是打开这一刻的事实，故只在挂载时读一次。 */
  const seed = useRef<ExtensionInstallSource | null>(source);
  useEffect(() => {
    const initial = seed.current;
    seed.current = null;
    if (initial?.repoUrl) void resolve(initial);
  }, [resolve]);

  const submit = () => {
    if (repoUrl.trim()) void resolve({ ...source, repoUrl });
  };

  const commit = async () => {
    if (!preflight) return;
    const operation = ++operationEpoch.current;
    const authorityReceipt = authorityEpoch;
    setBusy(true);
    setError("");
    /* confirm transfers byte/claim ownership to the durable operation before
       its first awaited commit. This renderer token must never call discard
       again, even when the outcome is uncertain. */
    pending.current.preflightId = "";
    try {
      const snapshot = await confirmExtension({
        ...(surface ? { surface } : {}),
        preflightId: preflight.preflightId,
        expectedContentDigest: preflight.contentDigest,
        expectedResolvedCommit: preflight.source.resolvedCommit,
        migrateAppIds: migrating,
      });
      if (
        pending.current.alive &&
        operation === operationEpoch.current &&
        authorityReceipt === authorityEpochRef.current
      ) {
        onInstalled(snapshot, authorityReceipt);
        onClose();
      }
    } catch (cause) {
      if (
        operation === operationEpoch.current &&
        authorityReceipt === authorityEpochRef.current
      ) {
        setPreflight(null);
        setMigrating([]);
        setError(
          installationError(cause, t("settings.extensions.install.installFailed"))
        );
      }
    } finally {
      if (
        operation === operationEpoch.current &&
        authorityReceipt === authorityEpochRef.current
      ) setBusy(false);
    }
  };

  const back = () => {
    if (pending.current.preflightId)
      void discardExtensionPreflight(pending.current.preflightId);
    pending.current.preflightId = "";
    setPreflight(null);
    setMigrating([]);
    setError("");
  };

  const stage: Stage = !preflight
    ? "source"
    : preflight.capabilityDiff
      ? "update"
      : "install";
  return (
    <>
      <DialogHeader className="shrink-0 gap-0 text-left">
        <DialogTitle className="font-semibold text-lg">
          {surface ? copy[stage === "source" ? "source" : stage === "update" ? "update" : "review"] : t(`settings.extensions.install.stage.${stage}.title`)}
        </DialogTitle>
        <DialogDescription className="mt-2 text-muted-foreground text-xs">
          {preflight
            ? t("settings.extensions.install.summary", {
                url: preflight.source.normalizedUrl,
                commit: preflight.source.resolvedCommit.slice(0, 12),
                files: preflight.fileCount,
                kilobytes: Math.ceil(preflight.totalBytes / 1024),
              })
            : surface ? copy.description : t("settings.extensions.install.stage.source.description")}
        </DialogDescription>
      </DialogHeader>

      <AppDialogBody className="mt-4 space-y-4">
        {preflight ? (
          <DisclosureBody
            busy={busy}
            migrating={migrating}
            onToggleMigration={(appId, next) =>
              setMigrating((current) =>
                next
                  ? [...new Set([...current, appId])]
                  : current.filter((item) => item !== appId)
              )
            }
            preflight={preflight}
          />
        ) : (
          <div className="flex flex-col gap-1.5">
            <label className="font-medium text-xs" htmlFor="extension-repo-url">
              {t("settings.extensions.install.repository")}
            </label>
            <Input
              readOnly={Boolean(source.remoteRequestId)}
              aria-describedby={error ? "extension-install-error" : undefined}
              aria-invalid={Boolean(error)}
              autoComplete="off"
              autoFocus
              className="font-mono"
              disabled={busy}
              id="extension-repo-url"
              onChange={(event) => {
                setRepoUrl(event.target.value);
                setError("");
              }}
              onKeyDown={(event) => event.key === "Enter" && submit()}
              placeholder={"https://github.com/owner/repo"}
              spellCheck={false}
              value={repoUrl}
            />
            <p className="mt-1 text-[11px] text-muted-foreground leading-relaxed">
              {t("settings.extensions.install.repositoryHint")}
            </p>
            {localAvailable && !source.repoUrl && (
              <SettingsButton className="mt-2 self-start" disabled={busy} onClick={() => void resolve(null)} variant="outline">
                {t("settings.extensions.install.localFolder")}
              </SettingsButton>
            )}
          </div>
        )}

        {error && (
          <p
            className="rounded-md bg-destructive/10 px-3 py-2 text-destructive text-xs ring-1 ring-destructive/20"
            id="extension-install-error"
            role="alert"
          >
            {error}
          </p>
        )}
      </AppDialogBody>

      <DialogFooter className="mt-5 shrink-0 flex-row justify-end gap-3">
        <SettingsButton
          disabled={busy}
          onClick={preflight ? back : onClose}
          variant="ghost"
        >
          {preflight ? t("settings.extensions.install.back") : t("common.cancel")}
        </SettingsButton>
        <SettingsButton
          disabled={busy || (!preflight && !repoUrl.trim())}
          onClick={() => (preflight ? void commit() : submit())}
        >
          {t(
            `settings.extensions.install.stage.${stage}.${busy ? "pending" : "commit"}`
          )}
        </SettingsButton>
      </DialogFooter>
    </>
  );
}

/* 披露正文：可执行脚本、Skill 的 allowed-tools、MCP transport 与 endpoint、
   只列名字不列值的静态 header、是否需要持久数据写根、逐代能力 diff，
   以及受影响 App 的逐个迁移开关。 */
function DisclosureBody({
  preflight,
  busy,
  migrating,
  onToggleMigration,
}: {
  preflight: ExtensionPreflightView;
  busy: boolean;
  migrating: readonly string[];
  onToggleMigration: (appId: string, next: boolean) => void;
}) {
  const { t, i18n } = useAppTranslation();
  const copy = packageCopy(i18n.language);
  const diff = preflight.capabilityDiff;
  const host = preflight.disclosure.hostPackage, disclosureCopy = packageDisclosureCopy(i18n.language);
  const list = (values: readonly string[]) =>
    values.join(", ") || t("settings.extensions.install.disclosure.none");
  return (
    <>
      <SettingsNoteList
        items={[
          { term: copy.digest, detail: preflight.contentDigest },
          ...(preflight.trust ? [{ term: copy.signature, detail: preflight.trust.status === "trusted"
            ? `${copy.verified}: ${preflight.trust.publisher}` : copy.unverified }] : []),
          ...(host ? [{ term: copy.permissions, detail: list(packagePermissionLabels(host.requestedCapabilities, i18n.language)) }] : []),
          {
            /* 判型是这次预检最先产生、也最容易被读者错过的事实：它决定这
               个仓库被当成什么收下。归属段仍要说，但不再是「去另一页找」
               ——两族已在同一页，这里说的是它落在哪一段。 */
            term: t("settings.extensions.install.disclosure.format"),
            detail:
              preflight.adapterId === "agent-plugins-1.0.0"
                ? t("settings.extensions.install.disclosure.pluginFormat")
                : preflight.adapterId === "bottega-host-package-1"
                  ? host?.entries.every(entry => entry.role === "ui") ? disclosureCopy.ui : disclosureCopy.process
                  : t("settings.extensions.install.disclosure.skillFormat"),
          },
          {
            term: t("settings.extensions.install.disclosure.scripts"),
            detail: list(preflight.disclosure.executableScripts),
          },
          ...preflight.disclosure.skills.map((skill) => ({
            term: t("settings.extensions.install.disclosure.skill", {
              name: skill.name,
            }),
            detail: t("settings.extensions.install.disclosure.allowedTools", {
              tools:
                skill.allowedTools.join(", ") ||
                t("settings.extensions.install.disclosure.undeclared"),
            }),
          })),
          ...preflight.disclosure.mcpServers.map((server) => ({
            term: t("settings.extensions.install.disclosure.mcp", {
              serverId: server.serverId,
              transport: server.transport,
            }),
            detail: `${t("settings.extensions.install.disclosure.mcpUnavailable", {
              target: server.endpoint ?? server.command ?? "—",
            })}${
              server.staticHeaderNames.length
                ? t("settings.extensions.install.disclosure.staticHeaders", {
                    headers: server.staticHeaderNames.join(", "),
                  })
                : ""
            }`,
          })),
          {
            term: t("settings.extensions.install.disclosure.writeRoot"),
            detail: preflight.disclosure.requiresPluginDataWriteRoot
              ? t("settings.extensions.install.disclosure.writeRootRequired")
              : t("settings.extensions.install.disclosure.writeRootNone"),
          },
          ...(diff
            ? [
                {
                  term: t("settings.extensions.install.disclosure.capabilityChange"),
                  detail:
                    diff.added.length || diff.removed.length
                      ? t("settings.extensions.install.disclosure.addedRemoved", {
                          added: list(diff.added),
                          removed: list(diff.removed),
                        })
                      : t("settings.extensions.install.disclosure.noChange"),
                },
              ]
            : []),
          ...preflight.reports.map((report) => ({
            term: t("settings.extensions.install.disclosure.report"),
            detail: report,
          })),
          {
            term: diff
              ? t("settings.extensions.install.disclosure.postUpdate")
              : t("settings.extensions.install.disclosure.postInstall"),
            detail: diff
              ? diff.requiresReauthorization
                ? t("settings.extensions.install.disclosure.reauthorize")
                : t("settings.extensions.install.disclosure.retainAuthorization")
              : host ? disclosureCopy.enabled : t("settings.extensions.install.disclosure.defaultEnabled"),
          },
        ]}
      />
      {diff && preflight.affectedApps.length > 0 && (
        <SettingsList>
          {preflight.affectedApps.map((app) => (
            <SettingsRow
              control={
                <SettingsSwitch
                  checked={migrating.includes(app.appId)}
                  disabled={busy}
                  id={`extension-migrate-${app.appId}`}
                  label={t("settings.extensions.install.disclosure.migrateAria", {
                    appId: app.appId,
                  })}
                  onToggle={(next) => onToggleMigration(app.appId, next)}
                />
              }
              /* 迁移不是原地换绑：它会为这个 App 起一条新的 pending 代，
                 需要重新授权；不迁移就继续用旧代，旧代不会被回收。 */
              description={t(
                "settings.extensions.install.disclosure.migrateDescription",
                { generation: app.appGenerationId }
              )}
              htmlFor={`extension-migrate-${app.appId}`}
              key={app.appId}
              label={t("settings.extensions.install.disclosure.migrateLabel", {
                appId: app.appId,
              })}
            />
          ))}
        </SettingsList>
      )}
    </>
  );
}
