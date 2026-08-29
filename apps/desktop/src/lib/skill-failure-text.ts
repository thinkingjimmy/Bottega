/**
 * [INPUT]: Depends on shared ProductFailure and the renderer translation function
 * [OUTPUT]: Provides skillFailureText for runtime and management domains and admissionReasonText for structured admission rejections, without exposing internal details
 * [POS]: Single ProductFailure-to-copy projection for chat, Plan controls, chips, and Skills settings
 */

import { getI18n } from "react-i18next";
import type { ProductFailure } from "../../shared/product-failure";
import { errorMessage } from "@/lib/errors";

export function skillFailureText(
  t: (key: string, options?: Record<string, unknown>) => string,
  failure: ProductFailure
) {
  return t(`chat.skillFailure.${failure.code}`);
}

/** Admission 拒因的人话投影：结构化失败走五语目录（plain module 经全局
 * i18n 实例取当前语言），其余保持既有 message 剥壳路径。 */
export function admissionReasonText(
  result: Readonly<{ reason: string; failure?: ProductFailure }>
) {
  if (result.failure) {
    const failure = result.failure;
    return skillFailureText((key, options) => getI18n().t(key, options), failure);
  }
  return errorMessage(result.reason);
}
