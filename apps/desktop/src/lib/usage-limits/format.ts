/**
 * [INPUT]: Depends on shared quota projections, localized copy and the effective Intl locale.
 * [OUTPUT]: Formats calendar periods, resets, quota summaries and complete details with compact, combined timestamp metadata.
 * [POS]: The sole presentation policy shared by Settings rows and passive picker details.
 */
import { createQuotaFormat } from "@ai-chat/chat-ui/quota/format";
import { intlLocale } from "../i18n-locale";
export type { QuotaDetail } from "@ai-chat/chat-ui/quota/format";
export const { quotaPercent, quotaDate, quotaPeriod, quotaResetClock, quotaReset, quotaStatus, quotaHeadline, quotaSummaryParts, quotaSummary, quotaDetail, quotaDescription } = createQuotaFormat(intlLocale);
