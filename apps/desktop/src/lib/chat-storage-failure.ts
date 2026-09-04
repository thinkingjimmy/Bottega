/**
 * [INPUT]: Depends on shared ChatStorageFailure and renderer translation functions
 * [OUTPUT]: Provides the single Chat-storage failure-to-human-copy projection, safe diagnostic extraction, and the GitHub issue draft built from that copy
 * [POS]: Renderer presentation seam between storage facts and Sidebar product language
 */

import type { ChatStorageFailure } from "../../shared/product-failure";

type Translate = (key: string, options?: Record<string, unknown>) => string;

export type ChatStorageFailureCopy = Readonly<{
  title: string;
  explanation: string;
  resolution: string;
  diagnostic?: string;
}>;

export function chatStorageFailureCopy(
  t: Translate,
  failure: ChatStorageFailure
): ChatStorageFailureCopy {
  return {
    title: t(`chatStorage.code.${failure.code}.title`),
    explanation: t(`chatStorage.code.${failure.code}.explanation`),
    resolution: t(`chatStorage.code.${failure.code}.resolution`),
    ...(failure.safeDetails.kind === "diagnostic"
      ? { diagnostic: failure.safeDetails.message }
      : {}),
  };
}

/* issue 草稿：标题用「域/失败码: 标题」便于归类；正文先说人话，再把技术详情原样附上。 */
export function chatStorageIssueDraft(
  failure: ChatStorageFailure,
  copy: ChatStorageFailureCopy
) {
  const diagnostic = copy.diagnostic
    ? `\n\n## Technical details\n\`\`\`\n${copy.diagnostic}\n\`\`\``
    : "";
  return {
    title: `${failure.domain}/${failure.code}: ${copy.title}`,
    body: `${copy.explanation}${diagnostic}`,
  };
}
