/**
 * [INPUT]: Depends on shared ManagedSkillReason/ManagedSkillLayerState and UNIFIED_SKILLS_ERROR code tables, lib/errors errorMessage, lib/format-bytes formatBytes
 * [OUTPUT]: Provides SKILL_AGENTS, skillReasonText, skillErrorCode/skillErrorText (one code decision, text derived), skillSizeText, skillBytesText, and the types of SkillPillView and skillPillView
 * [POS]: The settings/skills are "code → words" and "four levels → one point"; The three views no longer have their own rationale, nor do they each compress four layers into a bull
 */

import { errorMessage } from "@/lib/errors";
import { formatBytes } from "@/lib/format-bytes";
import {
  UNIFIED_SKILLS_ERROR,
  type ManagedSkillLayerState,
  type ManagedSkillReason,
} from "../../../../shared/unified-skills-ipc";

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** 四家的展示顺序只有一份：来源清单、导入页签与行内状态点共用它。 */
export const SKILL_AGENTS = ["codex", "claude", "kimi", "opencode"] as const;

/* ── 理由：码在 main，话在这里 ────────────────────────────────────
 * detail 是 Skill 自己那棵树里的相对路径（`images/banner.png`），
 * 它属于用户交出来的内容，不是本机坐标——所以可以直说，也只该直说。
 * 拼接收在这里而非两个调用点：同一句话写第二遍就是漂移的开始。
 * ──────────────────────────────────────────────────────────── */
export function skillReasonText(t: Translate, reason: ManagedSkillReason) {
  const text = t(`settings.skills.reason.${reason.code}`);
  return reason.detail ? `${text} · ${reason.detail}` : text;
}

const ERROR_CODES = new Set<string>(Object.values(UNIFIED_SKILLS_ERROR));
const ERROR_PREFIX = "unified-skills/";

/* main 只发三个码；认不出来的一律按「失败了，再试一次」处理——
   把一条穿不过来的原始 message 端上桌，等于什么也没说。 */
export function skillErrorCode(cause: unknown): "conflict" | "read-only" | "failed" {
  const message = errorMessage(cause);
  return ERROR_CODES.has(message)
    ? (message.slice(ERROR_PREFIX.length) as "conflict" | "read-only" | "failed")
    : "failed";
}

export function skillErrorText(t: Translate, cause: unknown) {
  return t(`settings.skills.error.${skillErrorCode(cause)}`);
}

/* ── 体积：一句事实，不是一次判决 ────────────────────────────────
 * 导入不是「读一下」，是把这份 Skill 复制进库、再按 agent 复制进最多四个
 * HOME 目录——13 MiB 于是是 65 MiB。这个数字必须在按下按钮之前看得见。
 * 单位符号（KiB/MiB）是国际写法，不进语言目录；只有「几个文件」要过复数。
 * ──────────────────────────────────────────────────────────── */
export function skillSizeText(t: Translate, files: number, bytes: number) {
  return `${t("settings.skills.candidateFiles", { count: files })} · ${skillBytesText(bytes)}`;
}

/** 「全部导入」那一条要报四家合计，与逐条体积必须是同一把尺。 */
export function skillBytesText(bytes: number) {
  return formatBytes(bytes);
}

export type SkillPillView = Readonly<{
  tone: "on" | "muted" | "off" | "warn";
  /* 只有「文件在那儿、却还控制不了」才需要补一个词；
     亮着和没有都由点自己说清，多写一遍就是噪音。 */
  note: "original" | "sessionOff" | "drifted" | null;
}>;

/* ── 四层压成一枚点 ──────────────────────────────────────────────
 * 四层模型（present → native → product → session）是领域的诚实，
 * 不是版面的诚实：84 行 × 4 家 × 4 层 = 1344 个事实，没人扫得动。
 * 行上只回答「这家现在能不能用」，四层完整值留在展开区。
 * 归一放在这里，是因为「合成结论」只能有一个说法。
 * ──────────────────────────────────────────────────────────── */
export function skillPillView(state: ManagedSkillLayerState): SkillPillView {
  if (state.ownership === "foreign") return { tone: "warn", note: "drifted" };
  if (state.ownership === "imported-source") return { tone: "muted", note: "original" };
  if (state.ownership === "absent") return { tone: "off", note: null };
  return state.nativeEnabled === false || state.productEnabled === false
    ? { tone: "muted", note: "sessionOff" }
    : { tone: "on", note: null };
}
