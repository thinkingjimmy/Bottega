/**
 * [INPUT]: Depends on i18n, PageShell, extensions-client, full lifecycle commands, shared, extended DTO, shared ExtensionPackageCard and ExtensionInstallDialog, settings, routines
 * [OUTPUT]: Provides ExtensionsPanel: The entire page that starts with "Installed Extensions" has the only GitHub installation input, automatically grouped by adapter family to the list of installed extensions, and the enclosed banner and separate data are deleted
 * [POS]: Settings › Expand the subject; The only conclusion of this page is that the non-compliant variable is "every package in the registry must be visible on this page"
 */

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Blocks, Plus } from "lucide-react";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { PageShell } from "@/components/page-shell";
import type {
  ExtensionRetainedInstallDataView,
  ExtensionsSnapshot,
} from "../../shared/extensions-ipc";
import {
  ExtensionInstallDialog,
  type ExtensionInstallSource,
} from "@/components/settings/extension-install-dialog";
import { ExtensionPackageCard } from "@/components/settings/extension-package-card";
import {
  SettingsAlert,
  SettingsButton,
  SettingsCanvas,
  SettingsEmpty,
  SettingsList,
  SettingsRow,
  SettingsSection,
} from "@/components/settings/settings-layout";
import {
  beginDisableExtension,
  beginUninstallExtension,
  cancelUninstallExtension,
  disableExtensionComponent,
  enableExtensionComponent,
  hasExtensionsBridge,
  listExtensions,
  onExtensionsChanged,
  purgeExtensionInstallData,
  resolveUninstallExtension,
} from "@/lib/extensions-client";
import { errorMessage } from "@/lib/errors";

const EMPTY: ExtensionsSnapshot = {
  packages: [],
  productSessionAdmissionClosed: false,
  retainedInstallData: [],
};

/* ============================================================
 * 为什么 Skill 仓库与 Agent Plugins 合回一页。
 *
 * 它们曾是两页，按「包里装了什么」拆的。可拆页的判据在隔壁那次
 * 重构里已经立好了，而且立得对：**拆分的判据是状态而非名字**——
 * Skill 仓库当初该从 Tools 搬走，是因为它与内置工具、MCP 零共享
 * 状态。按同一条判据回头看这两页：同一个 ExtensionsSnapshot、
 * 同一套十一条 IPC、同一张 ExtensionPackageCard、同一个安装弹窗，
 * 共享的是**全部**状态。它们恰恰是「按名字拆的」那一类。
 *
 * 代价不是重复，是说谎。判型的唯一真相在 install/source.ts：有
 * plugin.json 即 Agent Plugin，否则找 skills/<name>/SKILL.md 即
 * Skill 仓库。这个结论要等字节冻结之后才产生，而用户在粘地址那
 * 一刻手上并没有它。于是在 Agent Plugins 页粘一个裸 skill 仓库：
 * 预检过、确认过、装进 registry 了，而这一页按 adapterId 把它筛
 * 掉，回落成「还没有安装 Agent Plugin」。成功与失败在同一张脸下
 * 说同一句话——空态说的那句「还没有」是假的。
 *
 * 合并之后这一页有了一条可检验的不变量：
 *   **registry 里的每一个包，在这一页上必然可见。**
 * 用户不必先替产品判一次型，判型退回它本来的位置——后端。
 *
 * 安装动作住在「已安装扩展」的段头，与 Tools 的「添加 server」同一形态。
 * 判据一个字没改，仍是「往这一段加一件」——只要那一段是**整份清单**，
 * 判据就重新成立：段收的是所有已装扩展，动作往里加一件，落在它的哪个
 * 分组由字节决定。曾经拧巴的不是判据，是把两族当成了两个平级的段。
 *
 * 它不该上页头：那里的既有住户是 Memory/Usage 那颗 28px 图标刷新——
 * chrome 级、不产生新对象，而那条横带是窗口拖拽区不是内容区。把本页
 * 最主要的、会长出新对象的动作塞进窗口 chrome，等于说它不属于这一页
 * 的内容，可它恰恰是。
 *
 * 两族因此降为段内的分组：一行轻量标签 + 一句边界说明，不再各自撑起
 * 一个 SettingsSection。这同时消掉一处早于本次改动就存在的层级错乱——
 * ExtensionPackageCard 自己就是 SettingsSection，族若也是，两个 h2 就
 * 会互相嵌套。分组改用 `<section aria-label>`：读屏拿得到边界，视觉上
 * 也不再有第二种「段」。
 *
 * 空段不摆：段是货架不是分类目录，没有东西的货架不必占一行。于是
 * 「空段」这个概念连同它的空态文案一起消失，整页只剩一种空——一件
 * 都没装，一句话说清两族各要什么。
 * ============================================================ */

/* 两族货架。顺序按「当前真能交付的形态在前」：skill 走的
   manual-snapshot 是四家后端都验过的通道，而 package MCP 受
   product-policy 四条 gate 全 false 约束，眼下交付不了。

   分组说明刻意不复述判型规则（`plugin.json` 之有无），也不复述「安装不
   等于启用」——前者是段头的话（装之前需要什么），后者对两族都成立、
   属于整段。这里只说这一族独有的边界。同一句话写在两处，迟早各自漂移。 */
const FAMILIES = [
  {
    adapterPrefix: "skill-repo-",
    kind: "skill",
  },
  {
    adapterPrefix: "agent-plugins-",
    kind: "plugin",
  },
] as const;

export function ExtensionsPanel() {
  const { t } = useAppTranslation();
  const [snapshot, setSnapshot] = useState<ExtensionsSnapshot>(EMPTY);
  /* null 即弹窗关着；开着时 repoUrl 空是新装、非空是某个已装包的更新检查 */
  const [install, setInstall] = useState<ExtensionInstallSource | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  /* 桥缺席是「读不到」，不是「还没装」：它是渲染期常量，不进 state。 */
  const bridgeMissing = !hasExtensionsBridge();

  useEffect(() => {
    if (!hasExtensionsBridge()) return;
    let active = true;
    void listExtensions()
      .then((value) => active && setSnapshot(value))
      .catch((cause: unknown) => active && setError(errorMessage(cause)));
    const unsubscribe = onExtensionsChanged(
      (value) => active && setSnapshot(value)
    );
    /* 退订与在飞 list 必须一起收：只退订的话，首帧那次 list 仍会在卸载后
       setState。 */
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const run = useCallback(async (task: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await task();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }, []);

  const shelves = FAMILIES.map((family) => ({
    ...family,
    packages: snapshot.packages.filter((item) =>
      item.adapterId.startsWith(family.adapterPrefix)
    ),
  })).filter((shelf) => shelf.packages.length > 0);

  /* 失败挂在「已安装扩展」段头：启停/卸载/迁移都来自这一段里的卡片，
     安装失败也发生在它的段头动作上——范围恰好就是这一段。 */
  const alert = bridgeMissing
    ? t("settings.extensions.page.bridgeMissing")
    : error;

  return (
    <>
      <PageShell icon={<Blocks />} title={t("common.extensions")}>
        <SettingsCanvas>
          <div className="space-y-8">
            {/* 收敛横幅说的是「整个产品会话此刻不收新 Agent」，不是某一段
                清单的状态，所以停在段外。 */}
            {snapshot.productSessionAdmissionClosed && (
              <SettingsAlert tone="warn">
                {t("settings.extensions.page.admissionClosed")}
              </SettingsAlert>
            )}

            <SettingsSection
              action={
                <SettingsButton
                  disabled={busy || bridgeMissing}
                  onClick={() => setInstall({ repoUrl: "" })}
                  variant="outline"
                >
                  <Plus className="size-4" />
                  {t("settings.extensions.page.installGithub")}
                </SettingsButton>
              }
              alert={alert || undefined}
              description={t("settings.extensions.page.installedDescription")}
              title={t("settings.extensions.page.installedTitle")}
            >
              {shelves.length ? (
                <div className="space-y-6">
                  {shelves.map((shelf) => (
                    <FamilyGroup
                      description={t(
                        `settings.extensions.page.family.${shelf.kind}Description`
                      )}
                      key={shelf.adapterPrefix}
                      title={t(
                        `settings.extensions.page.family.${shelf.kind}Title`
                      )}
                    >
                      {shelf.packages.map((record) => (
                        <ExtensionPackageCard
                          busy={busy}
                          key={record.installIdentity}
                          onCancelUninstall={() =>
                            void run(() =>
                              cancelUninstallExtension(record.installIdentity)
                            )
                          }
                          onDisable={() =>
                            void run(() =>
                              beginDisableExtension(record.installIdentity)
                            )
                          }
                          onDisableComponent={(componentIdentity) =>
                            void run(() =>
                              disableExtensionComponent(componentIdentity)
                            )
                          }
                          onEnable={(componentIdentity) =>
                            void run(() =>
                              enableExtensionComponent(componentIdentity)
                            )
                          }
                          onMigrate={(appId) =>
                            void run(() =>
                              resolveUninstallExtension({
                                installIdentity: record.installIdentity,
                                migrateAppIds: [appId],
                              })
                            )
                          }
                          onRetryUninstall={() =>
                            void run(() =>
                              resolveUninstallExtension({
                                installIdentity: record.installIdentity,
                              })
                            )
                          }
                          onUninstall={() =>
                            void run(() =>
                              beginUninstallExtension(record.installIdentity)
                            )
                          }
                          /* 更新走的是安装那条流水线，只是种子来自这个已装包 */
                          onUpdate={() =>
                            setInstall({
                              repoUrl: record.source.normalizedUrl,
                              ...(record.source.subdirectory
                                ? { subdirectory: record.source.subdirectory }
                                : {}),
                            })
                          }
                          record={record}
                        />
                      ))}
                    </FamilyGroup>
                  ))}
                </div>
              ) : (
                <EmptyExtensionsPanel />
              )}
            </SettingsSection>

            {snapshot.retainedInstallData.length > 0 && (
              <SettingsSection
                description={t("settings.extensions.page.retainedDescription")}
                title={t("settings.extensions.page.retainedTitle")}
              >
                <SettingsList>
                  {snapshot.retainedInstallData.map((item) => (
                    <RetainedDataRow
                      busy={busy}
                      key={item.installIdentity}
                      onPurge={() =>
                        void run(() =>
                          purgeExtensionInstallData(item.installIdentity)
                        )
                      }
                      record={item}
                    />
                  ))}
                </SettingsList>
              </SettingsSection>
            )}
          </div>
        </SettingsCanvas>
      </PageShell>

      <ExtensionInstallDialog
        onInstalled={setSnapshot}
        onOpenChange={(next) => !next && setInstall(null)}
        source={install}
      />
    </>
  );
}

/* 族分组：一行轻量标签 + 一句边界说明，刻意**不是** SettingsSection。
   卡片自己已经是 SettingsSection 了，族若也是，同一层就出现两种「段」，
   而且两个 h2 互相嵌套。`aria-label` 让读屏仍拿得到这条边界——分组是
   真的分组，只是不必长成标题。 */
function FamilyGroup({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section aria-label={title} className="space-y-3">
      <div className="space-y-0.5">
        <p className="font-medium text-muted-foreground text-xs">{title}</p>
        <p className="max-w-[65ch] text-[11px] text-muted-foreground/80 leading-relaxed">
          {description}
        </p>
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

/* 空态不复述段头：那段常驻，已经把「装之前需要什么」说完了。这里只说
   「装完之后会怎样」——两件事互补而不重叠，顺带解释了为什么此刻连两个
   族标签都看不到（空组不摆）。 */
function EmptyExtensionsPanel() {
  const { t } = useAppTranslation();
  return (
    <SettingsEmpty
      hint={t("settings.extensions.page.emptyHint")}
      icon={<Blocks />}
      title={t("settings.extensions.page.emptyTitle")}
    />
  );
}

function RetainedDataRow({
  record,
  busy,
  onPurge,
}: {
  record: ExtensionRetainedInstallDataView;
  busy: boolean;
  onPurge: () => void;
}) {
  const { t } = useAppTranslation();
  return (
    <SettingsRow
      control={
        <SettingsButton
          disabled={busy || record.custody.length > 0}
          onClick={onPurge}
          variant="ghost"
        >
          {t("settings.extensions.page.purgeData")}
        </SettingsButton>
      }
      description={
        record.custody.length
          ? t("settings.extensions.page.retainedCustody", {
              custody: record.custody.join("、"),
            })
          : t("settings.extensions.page.retainedEpochs", {
              count: record.epochIds.length,
            })
      }
      htmlFor={`extension-data-${record.installIdentity}`}
      label={record.installIdentity.replace("sha256:", "").slice(0, 12)}
    />
  );
}
