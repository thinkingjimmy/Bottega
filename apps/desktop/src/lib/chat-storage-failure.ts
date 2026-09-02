/**
 * [INPUT]: Depends on shared ChatStorageFailure and renderer translation functions
 * [OUTPUT]: Provides the single Chat-storage failure-to-human-copy projection and safe diagnostic extraction
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
