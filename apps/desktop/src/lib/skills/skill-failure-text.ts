/**
 * [INPUT]: Depends on shared ProductFailure and the renderer translation function
 * [OUTPUT]: Provides skillFailureText for runtime and management domains and admissionReasonText for structured admission rejections (a coded refusal such as coordinator-closing speaks its catalog line; an expired file grant is named via fileGrantErrorMessage), without exposing internal details
 * [POS]: apps/desktop/src/lib/skills; Single ProductFailure-to-copy projection for chat, Plan controls, chips, and Skills settings
 */

import { getI18n } from "react-i18next";
import type { ProductFailure } from "../../../shared/product/product-failure";
import type { AdmissionRefusalCode } from "../../../shared/ipc/content/sections-ipc";
import { errorMessage } from "@ai-chat/ui/lib/errors";
import { FILE_GRANT_EXPIRED } from "../../../shared/ipc/apps/app-ipc";
import { translate } from "../../../shared/i18n/runtime";
import { effectiveLocale } from "../appearance/i18n-locale";

export function skillFailureText(
  t: (key: string, options?: Record<string, unknown>) => string,
  failure: ProductFailure
) {
  return t(`chat.skillFailure.${failure.code}`);
}

/** Admission 拒因的人话投影：结构化失败走五语目录（plain module 经全局
 * i18n 实例取当前语言），其余保持既有 message 剥壳路径。 */
export function admissionReasonText(
  result: Readonly<{ reason: string; failure?: ProductFailure; code?: AdmissionRefusalCode }>
) {
  if (result.code === "coordinator-closing") return translate(effectiveLocale(), "chat.runtime.submission.quitting");
  if (result.failure) {
    const failure = result.failure;
    return skillFailureText((key, options) => getI18n().t(key, options), failure);
  }
  return fileGrantErrorMessage(errorMessage(result.reason));
}

/** Main's expired-grant marker crosses IPC as text (`file-grant-expired:<name>`); name the file instead (F-33). */
export function fileGrantErrorMessage(message: string) {
  const at = message.lastIndexOf(`${FILE_GRANT_EXPIRED}:`);
  return at < 0 ? message : translate(effectiveLocale(), "chat.runtime.attachment.grantUnavailable", { name: message.slice(at + FILE_GRANT_EXPIRED.length + 1) });
}
