/**
 * [INPUT]: Depends on UTF-8 byte count and App references/instructions by order
 * [OUTPUT]: Provides selectAppReferences and allocateAppInstructions; Extreme certainty omitted and true return omitted appId
 * [POS]: The Agent App is a visible budgeter for appsD20 requires "silent interruption", so omitting is the result rather than the anomaly
 */

export const APP_INSTRUCTION_BUDGET = 2 * 1024;
export const APP_REFERENCE_LIMIT = 8;

export type AppInstructionReference = Readonly<{
  appId: string;
  instruction: string;
}>;

/* 前缀截断而不是最优装箱：一条规则、可复述、同一候选序永远得到同一结果。
   装箱能多塞一两条，代价是「加一个 App 会让另一个 App 消失」这种不可解释。 */
export function selectAppReferences<T>(
  candidates: readonly T[],
  appIdOf: (candidate: T) => string
) {
  return {
    accepted: candidates.slice(0, APP_REFERENCE_LIMIT),
    omittedAppIds: candidates.slice(APP_REFERENCE_LIMIT).map(appIdOf),
  };
}

/* 超预算的部分不注入——它对本轮 Agent 等于不存在；调用方必须把 omittedAppIds
   送到 UI，否则用户会以为 App 已经生效（D20）。 */
export function allocateAppInstructions(
  references: readonly AppInstructionReference[]
) {
  const accepted: string[] = [];
  const omittedAppIds: string[] = [];
  let instructionBytes = 0;
  for (const reference of references) {
    const size = Buffer.byteLength(reference.instruction, "utf8");
    if (omittedAppIds.length || instructionBytes + size > APP_INSTRUCTION_BUDGET) {
      omittedAppIds.push(reference.appId);
      continue;
    }
    instructionBytes += size;
    accepted.push(reference.instruction);
  }
  return { instructions: accepted.join("\n"), omittedAppIds, instructionBytes };
}
