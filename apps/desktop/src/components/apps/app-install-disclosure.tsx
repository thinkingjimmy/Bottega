/**
 * [INPUT]: Depends on sharing App probe/requirement DTO, SafeReadme/readmeBody with i18n
 * [OUTPUT]: Provides AppInstallDisclosure and InstallSource: README formally before the requirements/plugins/sources are compressed into a definition table
 * [POS]: The installation of components/apps is disclosed from a single source; Preset details with GitHub Base import confirm sharing
 */

import type { ReactNode } from "react";
import type {
  AppExtensionInstallPreflight,
  AppRequirement,
} from "../../../shared/apps-ipc";
import type { AppExtensionRequirementDeclaration } from "../../../shared/extensions-ipc";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { cn } from "@ai-chat/ui/lib/utils";
import { readmeBody, SafeReadme } from "./app-readme-adornment";

type CliStatus = Readonly<{
  id: string;
  detectable: boolean;
  installed: boolean;
}>;

/** 来源分两半：认得出的身份（通道或仓库）与核对用的指纹。挤在一行只剩一团灰字。 */
export type InstallSource = Readonly<{ label: string; fingerprint?: string }>;

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
      key: requirement.required
        ? "apps.requirementRequired"
        : "apps.requirementOptional",
    } as const;
  }
  const ready = status.detectable && status.installed;
  return {
    tone: ready ? "ready" : "missing",
    key: ready ? "apps.requirementReady" : "apps.requirementMissing",
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

export function AppInstallDisclosure({
  readme,
  requirements,
  cliStatuses,
  extensions,
  extensionRequirements = [],
  source,
}: {
  readme: string;
  requirements: readonly AppRequirement[];
  cliStatuses: readonly CliStatus[];
  extensions: readonly AppExtensionInstallPreflight[];
  extensionRequirements?: readonly AppExtensionRequirementDeclaration[];
  source: InstallSource;
}) {
  const { t } = useAppTranslation();
  const machineRequirements = requirements.filter(
    (requirement) => requirement.kind === "cli" || requirement.kind === "config"
  );
  /* 判空看的是摘掉标题之后的正文：只有一行 H1 的 README 等于没有正文，
     照着原串判会留下一条上不着村的分隔线。 */
  const body = readmeBody(readme);

  return (
    <div className="flex flex-col gap-5">
      {body && <SafeReadme className={README_TYPOGRAPHY}>{body}</SafeReadme>}
      {/* 三条事实收在正文之后、动作之前——读完是什么，再看它要什么，然后决定。
          它们不再是三个与 README 同级的段落标题：那会让「不需要额外 CLI」这种
          零信息的答案占掉与说明书同等的版面。 */}
      <dl
        className={cn(
          "grid grid-cols-[auto_1fr] gap-x-6 gap-y-3",
          body && "border-t pt-5"
        )}
      >
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
                      {t(state.key)}
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
