/**
 * [INPUT]: Depends on the shared BaseAppManifest contract plus the shared locale and translation runtime
 * [OUTPUT]: Provides localized Base App manifests, app.json/README/AGENTS/CLAUDE scaffolds, and the create-skill prompt
 * [POS]: The Save as App template boundary; persisted user-facing manifest copy is localized while authored scaffold language remains an explicit product decision
 */

import type { BaseAppManifest } from "../../../shared/apps-ipc";
import type { AppLocale } from "../../../shared/i18n/locale";
import { translate } from "../../../shared/i18n/runtime";

export const APP_SKILL_PLACEHOLDER = "<!-- create-app-skill:pending -->";
/** README 骨架占位句；share 前置检查据此判断「介绍尚未完善」，两处必须同源。 */
export const README_SKELETON_HINT = "请在这里补充一句清晰的用途说明";

export function baseAppManifest(
  name: string,
  icon: string,
  locale: AppLocale = "en"
): BaseAppManifest {
  return {
    kind: "base",
    packageSchemaVersion: 2,
    name,
    description: translate(locale, "apps.saveAs.generatedDescription", { name }),
    icon,
    requirements: null,
  };
}

export function baseAppScaffold(manifest: BaseAppManifest) {
  return {
    "app.json": `${JSON.stringify(manifest, null, 2)}\n`,
    "README.md": `# ${manifest.icon} ${manifest.name}

## 这个 App 做什么

${README_SKELETON_HINT}。

## 怎么用

打开 App 后直接查看 Base；需要录入或整理数据时，展开右侧使用 chat。

<!-- 分享前请把用途、使用步骤、输入示例与依赖说明写完整；不要复制真实敏感数据。 -->

## 验证 skill

向使用 chat 发送一条典型输入，确认 Agent 按 Base 列结构与录入规则写入新行。
`,
    "AGENTS.md": `# ${manifest.name}

${APP_SKILL_PLACEHOLDER}

这是一个 Base App。数据录入协议将由保存后的 create-app-skill turn 补写；完成前请先读取当前对话与 Base 结构。
`,
    "CLAUDE.md": "@AGENTS.md\n",
  } as const;
}

export function createAppSkillPrompt(appName: string, slug: string) {
  return `请使用 $create-app-skill，把当前对话沉淀为「${appName}」的长期运行协议。

必须完成：
1. 读取当前对话与 Project Base 的列结构、既有数据和录入约定。
2. 用简短、可长期加载的内容完整覆盖 AGENTS.md，并删除 ${APP_SKILL_PLACEHOLDER} 标记。
3. 创建 .agents/skills/${slug}/SKILL.md，写清列结构、录入规则、常见输入、冲突处理与示例。
4. 保持 CLAUDE.md 的唯一内容为 @AGENTS.md。
5. 不复制真实敏感数据到协议示例。`;
}
