/**
 * [INPUT]: Depends on frozen App manifest/probe requirements, the shared manifest-derived Base GUI request helpers, StudioConsentPermissions, SafeReadme/readmeBody, and i18n
 * [OUTPUT]: Provides hasInstallReadme, AppInstallReadme (README body only) and AppInstallGrants (one card: the shared consent list — capabilities, host actions and workspace scope — above the rule, provenance below)
 * [POS]: The two halves of install authorization, composed by the Preset install dialog and the GitHub Base import dialog; technical evidence now sits inside the grant card instead of behind a disclosure
 */

import type { ReactNode } from "react";
import type {
  AppExtensionInstallPreflight,
  AppManifest,
  AppRequirement,
} from "../../../../shared/apps-ipc";
import type { AppExtensionRequirementDeclaration } from "../../../../shared/extensions-ipc";
import {
  requestedBaseGuiCapabilities,
  requestedBaseGuiCapabilityScopes,
  requestedBaseGuiHostActions,
} from "../../../../shared/apps-surface-ipc";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { cn } from "@ai-chat/ui/lib/utils";
import { StudioConsentPermissions } from "../authorization/app-consent-disclosure";
import { readmeBody, SafeReadme } from "../detail/app-readme-adornment";

type CliStatus = Readonly<{
  id: string;
  detectable: boolean;
  installed: boolean;
}>;

/** 来源分两半：认得出的身份（通道或仓库）与核对用的指纹。挤在一行只剩一团灰字。 */
type InstallSource = Readonly<{ label: string; fingerprint?: string }>;

/* ------------------------------------------------------------------------- *
 *  README 在这里是说明书，不是首页。
 *  MessageResponse 的默认标题为聊天流而调（H1 24px / H2 20px），放进弹窗会把
 *  弹窗标题压成面包屑——层级倒挂的根因不是字太大，是两层各自按自己的语境定字号。
 *  故在此容器内把整套标题收进与事实表同一族，弹窗标题重新成为最大的那一个。
 *  覆盖经 className 下传即可胜出（MessageResponse 的 cn 把调用方排在末位，
 *  tw-merge 按冲突组取后者），不必拼 CSS 特异性。此处只声明 h1–h4；h5/h6 无需
 *  另说——默认梯级在那两级本就停在正文同号，与本容器的 text-sm 正文正好同锚。
 * ------------------------------------------------------------------------- */
const README_TYPOGRAPHY = cn(
  "text-sm",
  "[&_h1]:mt-6 [&_h1]:mb-1.5 [&_h1]:text-base",
  "[&_h2]:mt-6 [&_h2]:mb-1.5 [&_h2]:text-[15px]",
  "[&_h3]:mt-5 [&_h3]:mb-1 [&_h3]:text-sm",
  "[&_h4]:mt-4 [&_h4]:mb-1 [&_h4]:text-sm",
  "[&_p]:leading-relaxed [&_li]:leading-relaxed"
);

/* 就绪度是三档而非两档：查得出的 CLI 有结论，声明式配置只有必填与否。
   颜色即结论，文字复述同一件事——色觉不是唯一通道。 */
const REQUIREMENT_TONE = {
  ready: "text-emerald-600 dark:text-emerald-400",
  missing: "text-amber-600 dark:text-amber-400",
  declared: "text-muted-foreground",
} as const;

function requirementState(requirement: AppRequirement, status?: CliStatus) {
  if (!status) {
    return {
      tone: "declared",
      labelKey: requirement.required
        ? "apps.requirementRequired"
        : "apps.requirementOptional",
    } as const;
  }
  const ready = status.detectable && status.installed;
  return {
    tone: ready ? "ready" : "missing",
    labelKey: ready ? "apps.requirementReady" : "apps.requirementMissing",
  } as const;
}

/* 事实行：标签列宽由最宽的那个标签自己决定（grid 的 auto 列），
   不写死宽度——五种语言的标签长短悬殊，任何定值都会在某一门语言里出错。 */
function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground text-xs leading-5">{label}</dt>
      <dd className="min-w-0 text-sm leading-5">{children}</dd>
    </>
  );
}

/* 判空看的是摘掉标题之后的正文：只有一行 H1 的 README 等于没有正文。
   判据只此一处，两个调用方都问它，免得各自写一遍再各自写歪。 */
export function hasInstallReadme(readme: string) {
  return readmeBody(readme).length > 0;
}

/** README 正文。标题归弹窗标题所有，故这里只渲染摘掉 H1 之后的那部分。 */
export function AppInstallReadme({
  readme,
  className,
}: {
  readme: string;
  className?: string;
}) {
  const body = readmeBody(readme);
  if (!body) return null;
  return (
    <SafeReadme className={cn(README_TYPOGRAPHY, className)}>{body}</SafeReadme>
  );
}

/* ------------------------------------------------------------------------- *
 *  授权卡：一张卡，一条内部细线，不是两个盒子。
 *
 *  上半是「你同意什么」——第二人称、明语、可数的几条；
 *  下半是「你同意的是哪一份」——机器需求、Agent 插件、来源与指纹。
 *
 *  为什么合：来源不是旁证，是被授权物的身份。用户授权的从来不是抽象的那个
 *  App，而是「来自这个仓库、这个 pin、这个 digest 的这一份」；机器需求与插件
 *  同样是这次授权的作用范围。三条事实本就长在授权里，拆成第二个容器只是把
 *  同一次决定切成两半摆着。
 *
 *  层级因此改由字号与颜色承担（14px 深色的同意项 vs 12px 灰的事实），
 *  而不再靠多一个盒子——能消失的容器永远比能摆对的容器优雅。
 * ------------------------------------------------------------------------- */
export function AppInstallGrants({
  requirements,
  cliStatuses,
  extensions,
  extensionRequirements = [],
  source,
  manifest,
  permissionLabels,
}: {
  requirements: readonly AppRequirement[];
  cliStatuses: readonly CliStatus[];
  extensions: readonly AppExtensionInstallPreflight[];
  extensionRequirements?: readonly AppExtensionRequirementDeclaration[];
  source: InstallSource;
  manifest: AppManifest;
  /* 逐条覆写按条目身份取值，与同意书用的是同一组 key。 */
  permissionLabels?: Readonly<Record<string, string>>;
}) {
  const { t } = useAppTranslation();
  const machineRequirements = requirements.filter(
    (requirement) => requirement.kind === "cli" || requirement.kind === "config"
  );

  return (
    /* 底色停在 bg-muted/40，不再往 sunken 走：卡里那几行 12px 的
       muted-foreground 压在 sunken 上只剩 4.43:1，过不了 AA 的 4.5。
       这张卡的底色深到这里就是尽头，再深一档就得换字色。 */
    <div className="rounded-lg border bg-muted/40">
      {/* 装机提交的是 `approve-requested`：数据能力之外，宿主动作（往输入框
          插字、往磁盘写文件）与 workspace 范围同样一并批准。这张卡从前只念
          manifest.gui.capabilities 一组，于是用户按下的那颗按钮与它真正做的
          事之间隔着两条没说出口的权限。改念同意书本体，两处便不可能再分家。 */}
      <StudioConsentPermissions
        className="flex flex-col gap-2 p-3 text-sm"
        labels={permissionLabels}
        request={{
          capabilities: requestedBaseGuiCapabilities(manifest),
          hostActions: requestedBaseGuiHostActions(manifest),
          scopes: requestedBaseGuiCapabilityScopes(manifest),
        }}
      />
      {/* 细线以下是「你同意的是哪一份」：读完它要什么，再看它是什么，然后决定。
          这三条不该是与说明书同级的段落——「无额外要求」这种零信息的答案
          占不起那份版面，但它们又确实是这次授权的作用范围，故收在同一张卡里。 */}
      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-3 border-t p-3">
        <Fact label={t("apps.installNeeds")}>
          {machineRequirements.length ? (
            <ul className="flex flex-col gap-1">
              {machineRequirements.map((requirement) => {
                const state = requirementState(
                  requirement,
                  cliStatuses.find((item) => item.id === requirement.id)
                );
                return (
                  <li
                    className="flex flex-wrap items-baseline gap-x-2"
                    key={requirement.id}
                  >
                    <span>{requirement.label}</span>
                    <span className={cn("text-xs", REQUIREMENT_TONE[state.tone])}>
                      {t(state.labelKey)}
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <span className="text-muted-foreground">
              {t("apps.noInstallNeeds")}
            </span>
          )}
        </Fact>
        <Fact label={t("apps.pluginsToEnable")}>
          {extensionRequirements.length ? (
            <ul className="flex flex-col gap-1.5">
              {extensionRequirements.map((requirement) => {
                const extension = extensions.find(
                  (item) =>
                    item.declaredComponentIdentity ===
                    requirement.declaredComponentIdentity
                );
                return (
                  <li key={requirement.declaredComponentIdentity}>
                    <span className="font-mono text-xs">
                      {requirement.declaredComponentIdentity}
                    </span>
                    <p className="text-muted-foreground text-xs">
                      {extension
                        ? t("apps.pluginCapabilitySummary", {
                            skills: extension.capabilities.skills.length,
                            mcp: extension.capabilities.mcpServers.length,
                            scripts:
                              extension.capabilities.executableScripts.length,
                          })
                        : t("apps.pluginPendingSource")}
                    </p>
                  </li>
                );
              })}
            </ul>
          ) : (
            <span className="text-muted-foreground">
              {t("apps.noPluginsToEnable")}
            </span>
          )}
        </Fact>
        <Fact label={t("apps.installSource")}>
          <span className="break-all">{source.label}</span>
          {source.fingerprint && (
            <p className="break-all font-mono text-muted-foreground text-xs">
              {source.fingerprint}
            </p>
          )}
        </Fact>
      </dl>
    </div>
  );
}
