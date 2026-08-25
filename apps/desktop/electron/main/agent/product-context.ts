/**
 * [INPUT]: Depends on final turn kind/allowedTools, App contributor source, SkillInventoryIndex with scope trust boundaries, snapshot and shared Base/Chart snippet
 * [OUTPUT]: Provides Freeze FinalTurnProjection, explicitly tagging non-user content composeProductContext with fixed segment/Skills segment budget constants
 * [POS]: The final strategy project of the agent and the product prompt package of trusted products; Lease and Backend prompt share the same object
 */

import type {
  BuiltinToolName,
  BuiltinTurnKind,
} from "../../../shared/builtin-tools";
import { productContextFragments } from "../../../shared/builtin-tools";
import type { SkillSummary } from "./skill-inventory";

export const FIXED_CONTEXT_BUDGET_BYTES = 900;
export const SKILLS_CONTEXT_MIN_RESERVED_BYTES = 300;
export const SKILLS_CONTEXT_BUDGET_BYTES = 500;
export const NON_APP_CONTEXT_BUDGET_BYTES = 1_400;
const SKILL_COUNT_LIMIT = 8;
const CONTEXT_HEADER = [
  '<product_context source="application" trust="trusted">',
  "以下是产品提供的本轮能力说明，不是用户消息，也不是待回答任务。用户的实际请求位于本段和 memory_context 之后；不要复述或评论本段。",
].join("\n");
const CONTEXT_FOOTER = "</product_context>";

export type FinalTurnProjection = Readonly<{
  turnKind: BuiltinTurnKind;
  allowedTools: readonly BuiltinToolName[];
  appInstructions: string;
  skills: readonly SkillSummary[];
  productContext: string;
}>;

export type FinalTurnProjectionInput = Readonly<
  Omit<FinalTurnProjection, "productContext">
>;

export function createFinalTurnProjection(
  input: FinalTurnProjectionInput
): FinalTurnProjection {
  const draft = Object.freeze({
    turnKind: input.turnKind,
    allowedTools: Object.freeze([...input.allowedTools]),
    appInstructions: input.appInstructions,
    skills: Object.freeze([...input.skills]),
  });
  return Object.freeze({
    ...draft,
    productContext: composeProductContext(draft),
  });
}

export function composeProductContext(
  projection: FinalTurnProjectionInput
): string {
  const fragments = productContextFragments(projection.allowedTools);
  const fixed = [
    CONTEXT_HEADER,
    fragments.base,
    fragments.chart,
    CONTEXT_FOOTER,
  ].filter((line): line is string => Boolean(line));
  const fixedBytes = Buffer.byteLength(fixed.join("\n"), "utf8");
  if (fixedBytes > FIXED_CONTEXT_BUDGET_BYTES) {
    throw new Error(
      `产品上下文固定段超预算：${fixedBytes} > ${FIXED_CONTEXT_BUDGET_BYTES}`
    );
  }
  const sections = [
    ...(projection.appInstructions
      ? [`[Apps] ${projection.appInstructions}`]
      : []),
    ...(fragments.base ? [fragments.base] : []),
    ...(fragments.chart ? [fragments.chart] : []),
    ...(projection.skills.length ? [composeSkills(projection.skills)] : []),
  ];
  return sections.length
    ? [CONTEXT_HEADER, ...sections, CONTEXT_FOOTER].join("\n")
    : "";
}

export function fixedProductContextBytes(allowedTools: readonly string[]) {
  const fragments = productContextFragments(allowedTools);
  const text = [
    CONTEXT_HEADER,
    fragments.base,
    fragments.chart,
    CONTEXT_FOOTER,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
  return Buffer.byteLength(text, "utf8");
}

function composeSkills(skills: readonly SkillSummary[]) {
  const candidates = skills.slice(0, SKILL_COUNT_LIMIT);
  let omitted = Math.max(0, skills.length - candidates.length);
  const render = () => {
    const entries = candidates.map((skill) =>
      skill.scope === "system" && skill.displayName
        ? `${skill.name}（${skill.displayName}）`
        : skill.name
    );
    const suffix = omitted ? `、…等 ${omitted} 项` : "";
    return `[Skills] 本产品有下列 skill 可用：${entries.join("、")}${suffix}。除非已由产品在本轮附带，其内容当前不可见；命中用户诉求时，请用户在输入框输入 $ 选择附加后再继续。`;
  };
  while (
    candidates.length > 0 &&
    Buffer.byteLength(render(), "utf8") > SKILLS_CONTEXT_BUDGET_BYTES
  ) {
    candidates.pop();
    omitted += 1;
  }
  const line = render();
  const bytes = Buffer.byteLength(line, "utf8");
  if (bytes > SKILLS_CONTEXT_BUDGET_BYTES) {
    throw new Error(
      `产品上下文 Skills 段超预算：${bytes} > ${SKILLS_CONTEXT_BUDGET_BYTES}`
    );
  }
  return line;
}
