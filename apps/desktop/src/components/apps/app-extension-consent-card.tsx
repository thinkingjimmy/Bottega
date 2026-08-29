/**
 * [INPUT]: Depends on AppRecord's pending generation binding, Base GUI decision, frozen extension graph and apps-client consent/promote commands
 * [OUTPUT]: Provides AppExtensionConsentCard; Consumption discretionary consent status, only the participant can edit, zero-punctuation "allows", and all of which are explicitly promoted after termination
 * [POS]: The generation capability license card details the App; It is the only export of the pending era, the terminal capability is no longer disguised as editable draft
 */

import { useState } from "react";
import { Button } from "@ai-chat/ui/components/ui/button";
import type { AppRecord } from "../../../shared/apps-ipc";
import {
  promoteAppGeneration,
  resolveAppBaseGuiConsent,
  resolveAppExtensionConsent,
} from "@/lib/apps-client";
import { errorMessage } from "@/lib/errors";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { pendingConsentState } from "./app-consent-state";

/* 不收 onChanged：两条命令都在 main 侧 emit `status`，AppsProvider 据此换掉
   record——再加一个回调只会制造第二条刷新路径。 */
export function AppExtensionConsentCard({ record }: { record: AppRecord }) {
  const pending = record.generationBinding.pending;
  if (!pending) return null;
  const capabilitiesKey = pending.baseGuiDecision?.requestedCapabilities.join("\u0000") ?? "";
  return (
    <PendingGenerationConsentCard
      key={`${pending.generationId}:${capabilitiesKey}`}
      record={record}
    />
  );
}

function PendingGenerationConsentCard({ record }: { record: AppRecord }) {
  const { t } = useAppTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = record.generationBinding.pending!;
  const requestedCapabilities = pending?.baseGuiDecision?.requestedCapabilities ?? [];
  const [grantedCapabilities, setGrantedCapabilities] = useState([...requestedCapabilities]);
  const generation = record.generations.find(
    (item) => item.generationId === pending?.generationId
  );
  const resolution = generation?.extensionRequirementResolution;
  const run = async (task: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await task();
    } catch (cause) {
      setError(errorMessage(cause, t("apps.baseGuiConsent.operationFailed")));
    } finally {
      setBusy(false);
    }
  };
  const requirements =
    resolution?.kind === "frozen"
      ? resolution.frozenSet.extensionRequirements
      : [];
  const awaitingExtension =
    resolution?.kind === "frozen" &&
    (pending.extensionState ?? pending.state) === "consent-required";
  const awaitingBaseGui =
    pending.baseGuiDecision?.state === "consent-required";
  const consent = pendingConsentState(
    awaitingExtension,
    awaitingBaseGui
  );

  return (
    <section className="m-4 rounded-lg border bg-card p-4 text-sm">
      <h3 className="font-medium">
        {t(consent.title)}
      </h3>
      <p className="mt-1 text-muted-foreground text-xs">
        {t(consent.description)}
      </p>

      {consent.resolveBaseGui && requestedCapabilities.length > 0 && (
        <fieldset className="mt-3 space-y-2 rounded-md border bg-muted/40 p-3 text-xs">
          <legend className="px-1 font-medium">{t("apps.baseGuiConsent.capabilities")}</legend>
          {requestedCapabilities.map((capability) => (
            <label className="flex min-h-11 items-center gap-2" key={capability}>
              <input
                checked={grantedCapabilities.includes(capability)}
                disabled={busy}
                onChange={(event) => setGrantedCapabilities((current) =>
                  event.target.checked
                    ? [...new Set([...current, capability])]
                    : current.filter((item) => item !== capability)
                )}
                type="checkbox"
              />
              {t(`apps.baseGuiConsent.capability.${capability}`)}
            </label>
          ))}
          {grantedCapabilities.length === 0 && (
            <p className="text-muted-foreground">
              {t("apps.baseGuiConsent.approveEmptyHint")}
            </p>
          )}
        </fieldset>
      )}

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
                    code: item.reason.code,
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
      {error && <p className="mt-2 text-destructive text-xs">{error}</p>}

      <div className="mt-3 flex flex-wrap gap-2">
        {consent.resolveExtension && (
          <>
            <Button
              disabled={busy}
              onClick={() =>
                void run(() =>
                  resolveAppExtensionConsent({ appId: record.id, granted: true })
                )
              }
              size="sm"
            >
              {t("apps.baseGuiConsent.extensionApprove")}
            </Button>
            <Button
              disabled={busy}
              onClick={() =>
                void run(() =>
                  resolveAppExtensionConsent({ appId: record.id, granted: false })
                )
              }
              size="sm"
              variant="outline"
            >
              {t("apps.baseGuiConsent.extensionDecline")}
            </Button>
          </>
        )}
        {consent.resolveBaseGui && (
          <>
            {/* 零勾选提交等于 declined tombstone——与「拒绝」同果却挂着
                「批准」的 label。不让它可点，路径就只剩一条。 */}
            <Button
              aria-disabled={busy || grantedCapabilities.length === 0}
              disabled={busy || grantedCapabilities.length === 0}
              onClick={() =>
                void run(() =>
                  resolveAppBaseGuiConsent({
                    appId: record.id,
                    grantedCapabilities,
                  })
                )
              }
              size="sm"
            >
              {t("apps.baseGuiConsent.approve")}
            </Button>
            <Button
              disabled={busy}
              onClick={() =>
                void run(() =>
                  resolveAppBaseGuiConsent({ appId: record.id, grantedCapabilities: [] })
                )
              }
              size="sm"
              variant="outline"
            >
              {t("apps.baseGuiConsent.decline")}
            </Button>
          </>
        )}
        {consent.kind === "ready" && (
          <Button
            disabled={busy}
            onClick={() =>
              void run(() =>
                promoteAppGeneration({
                  appId: record.id,
                  expectedConsentRevision: pending.expectedConsentRevision,
                })
              )
            }
            size="sm"
          >
            {t("apps.baseGuiConsent.enableGeneration")}
          </Button>
        )}
      </div>
    </section>
  );
}
