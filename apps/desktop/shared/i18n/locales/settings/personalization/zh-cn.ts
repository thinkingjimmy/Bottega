/**
 * [INPUT]: Depends on the settingsPersonalizationEn structural type
 * [OUTPUT]: Provides settingsPersonalizationZhCN, the Simplified Chinese Settings › Personalization catalog
 * [POS]: Simplified Chinese leaf of shared/i18n/locales/settings/personalization; loaded on demand by the matching top-level locale
 */

import type { settingsPersonalizationEn } from "./en";

export const settingsPersonalizationZhCN: typeof settingsPersonalizationEn = {
  title: "个性化", sectionTitle: "自定义指令", description: "直接编辑每个已安装 Agent 使用的全局指令文件。",
  loading: "正在读取指令文件…", emptyTitle: "尚未安装 Agent", emptyHint: "请先在后端设置中安装 Agent，再返回这里。",
  placeholder: "为这个 Agent 编写纯文本指令…", createHint: "文件尚不存在；保存后会创建于 {{path}}。",
  save: "保存指令", saving: "正在保存…", copyPath: "复制路径", copied: "路径已复制", reveal: "在文件管理器中显示",
  oversized: "文件大于 256 KiB，因此不会在这里加载或编辑。",
  find: { open: "在文件中查找", placeholder: "在文件中查找", count: "{{current}} / {{total}}", noMatches: "无匹配", previous: "上一个匹配", next: "下一个匹配", close: "关闭查找" },
  metrics: { lines: "{{lines}} 行", limit: "上限 {{size}}", recommendedLines: "建议不超过 {{lines}} 行", recommendedSize: "建议不超过 {{size}}" },
  errors: { bridge: "当前应用版本不支持个性化。", conflict: "文件已在应用外被修改。你的未保存修改仍保留；再次保存将覆盖磁盘上的新版本。", tooLarge: "指令不能超过 256 KiB。", oversizedFile: "文件大于 256 KiB，无法在这里编辑。", symlinkUnresolvable: "符号链接已断开或形成循环，请修复后再保存。", readFailed: "无法安全读取指令文件。", writeFailed: "无法保存指令文件。" },
};
