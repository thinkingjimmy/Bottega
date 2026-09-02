/**
 * [INPUT]: Depends on AppRecord's pending frozen manifest, the shared consent disclosure/state machine, and the main-owned unified Studio authorization command
 * [OUTPUT]: Provides AppExtensionConsentCard: the complete requested set (data capabilities + host actions + workspace scope) with symmetric allow/decline and a neutral declined state
 * [POS]: Recovery/update authorization card in App detail; main re-derives the complete requested set before grant and promotion
 */

import { Button } from "@ai-chat/ui/components/ui/button";
import type { AppRecord } from "../../../shared/apps-ipc";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import {
  StudioConsentPermissions,
  studioConsentRequest,
  useStudioConsent,
} from "./app-consent-disclosure";

/* ============================================================
 * 不收 onChanged：两条命令都在 main 侧 emit `status`，AppsProvider 据此
 * 换掉 record——再加一个回调只会制造第二条刷新路径。
 *
 * 这里从前套着一层按 pending 身份换 key 的外壳，用来在新请求到来时清掉
 * 旧的 busy/error。它防的是本来就不存在的东西：每次操作开头都清 error，
 * busy 在 finally 里必然归位。而它换 key 的那一刻，恰好是拒绝成功、
 * pending 消失的那一刻——把刚要说出口的「已拒绝」一并卸掉了。
 *
 * 于是外壳整个消失：declined 只在没有 pending 时说话；新请求一到它自然
 * 被覆盖，因为那时该回答的是新问题。能消失的分支比能写对的分支更可靠。
 * ============================================================ */
export function AppExtensionConsentCard({ record }: { record: AppRecord }) {
  const { t } = useAppTranslation();
  const consent = useStudioConsent(record.id);
  const pending = record.generationBinding.pending;
  const generation = record.generations.find(
    (item) => item.generationId === pending?.generationId
  );
  const resolution = generation?.extensionRequirementResolution;
  const requirements =
    resolution?.kind === "frozen"
      ? resolution.frozenSet.extensionRequirements
      : [];

  if (consent.declined && !pending) {
    return (
      <section className="m-4 rounded-lg border bg-card p-4 text-sm" role="status">
        <h3 className="font-medium">{t("apps.baseGuiConsent.declinedTitle")}</h3>
        <p className="mt-1 text-muted-foreground text-xs">
          {t("apps.baseGuiConsent.declinedDescription")}
        </p>
      </section>
    );
  }
  if (!pending) return null;

  return (
    <section className="m-4 rounded-lg border bg-card p-4 text-sm">
      <h3 className="font-medium">
        {t("apps.baseGuiConsent.simpleTitle", {
          name: generation?.manifest?.name ?? record.displayName,
        })}
      </h3>
      <p className="mt-1 text-muted-foreground text-xs">
        {t("apps.installAuthorizationDescription")}
      </p>
      <StudioConsentPermissions request={studioConsentRequest(record)} />

      {resolution?.kind === "frozen" && <ul className="mt-3 space-y-1">
        {requirements.map((item) => (
          <li className="text-xs" key={item.declarationDigest}>
            <span className="font-mono">
              {item.declaredComponentIdentity}
            </span>
            <span className="ml-2 text-muted-foreground">
              {t(item.required
                ? "apps.baseGuiConsent.extensionRequired"
                : "apps.baseGuiConsent.extensionOptional")} ·{" "}
              {item.state === "resolved"
                ? t("apps.baseGuiConsent.extensionResolved")
                : t("apps.baseGuiConsent.extensionUnresolved", {
                    code: item.reason?.code ?? "unresolved",
                  })}
            </span>
          </li>
        ))}
      </ul>}

      {/* blocked 时也给出路：required 解析不了就只能拒绝或删 App，不能假装能同意。 */}
      {resolution?.kind === "frozen" && resolution.frozenSet.status === "blocked" && (
        <p className="mt-2 text-destructive text-xs">
          {t("apps.baseGuiConsent.extensionBlocked")}
        </p>
      )}
      {consent.error && (
        <p className="mt-2 text-destructive text-xs" role="alert">{consent.error}</p>
      )}

      <p className="mt-3 text-muted-foreground text-xs">
        {t("apps.baseGuiConsent.declineHint")}
      </p>
      <div className="mt-2 flex justify-end gap-2">
        <Button
          disabled={consent.busy}
          onClick={consent.decline}
          size="sm"
          variant="ghost"
        >
          {t("apps.baseGuiConsent.decline")}
        </Button>
        <Button disabled={consent.busy} onClick={consent.allow} size="sm">
          {consent.busy
            ? t("apps.authorizing")
            : t("apps.baseGuiConsent.allowAndOpen")}
        </Button>
      </div>
    </section>
  );
}
