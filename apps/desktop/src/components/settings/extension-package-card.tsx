/**
 * [INPUT]: Depends on i18n, the shared ExtensionPackageView lifecycle projection, and Settings layout primitives
 * [OUTPUT]: Provides the sole package lifecycle card with update/uninstall controls, enabled-Skill facts, zero-Skill package visibility, MCP delivery status, custody, and convergence diagnostics
 * [POS]: Package lifecycle authority in Settings › Skills › Packages; component activation controls live only on capability surfaces
 */

import type {
  ExtensionConvergenceStep,
  ExtensionPackageView,
  ExtensionUninstallStep,
} from "../../../shared/extensions-ipc";
import {
  SettingsButton,
  SettingsList,
  SettingsNoteList,
  SettingsRow,
  SettingsSection,
} from "./settings-layout";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import type { TFunction } from "i18next";
import { Link } from "react-router";

export function ExtensionPackageCard({
  record,
  busy,
  onUpdate,
  onDisable,
  onUninstall,
  onCancelUninstall,
  onRetryUninstall,
  onMigrate,
}: {
  record: ExtensionPackageView;
  busy: boolean;
  onUpdate: () => void;
  onDisable?: () => void;
  onUninstall: () => void;
  onCancelUninstall: () => void;
  onRetryUninstall: () => void;
  onMigrate: (appId: string) => void;
}) {
  const { t } = useAppTranslation();
  const skillComponents = record.components.filter((component) => component.kind === "skill");
  const enabledSkills = skillComponents.filter((component) => component.enabled).length;
  return (
    <SettingsSection
      title={record.displayName}
      description={t("settings.extensions.package.description", {
        admission: t(
          `settings.extensions.package.admission.${record.admission}`
        ),
        administration: t(
          `settings.extensions.package.administration.${record.administrativeState}`
        ),
        catalog: t(
          `settings.extensions.package.catalog.${record.globalCatalogEnabled ? "on" : "off"}`
        ),
        commit: record.source.resolvedCommit.slice(0, 12),
      })}
      action={
        <div className="flex gap-2">
          {skillComponents.length > 0 && (
            <Link
              className="inline-flex min-h-11 touch-manipulation items-center rounded-md border px-3 text-xs hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
              to={manageSkillsHref(record)}
            >
              {t("settings.extensions.package.manageSkills")}
            </Link>
          )}
          <SettingsButton disabled={busy} onClick={onUpdate} variant="ghost">
            {t("settings.extensions.package.checkUpdate")}
          </SettingsButton>
          {record.administrativeState === "active" && (
            <SettingsButton
              disabled={busy}
              onClick={() => onDisable?.()}
              variant="ghost"
            >
              {t("settings.extensions.package.disable")}
            </SettingsButton>
          )}
          {record.uninstall ? (
            <SettingsButton
              disabled={busy}
              onClick={onCancelUninstall}
              variant="ghost"
            >
              {t("settings.extensions.package.cancelUninstall")}
            </SettingsButton>
          ) : (
            <SettingsButton
              disabled={busy || record.administrativeState !== "denied"}
              onClick={onUninstall}
              variant="ghost"
            >
              {t("settings.extensions.package.uninstall")}
            </SettingsButton>
          )}
        </div>
      }
    >
      {record.uninstall && (
        <UninstallPanel
          busy={busy}
          onMigrate={onMigrate}
          onRetry={onRetryUninstall}
          record={record.uninstall}
        />
      )}
      <p className="mb-2 text-xs text-muted-foreground">
        {t("settings.extensions.package.enabledCount", { enabled: enabledSkills, total: skillComponents.length })}
      </p>
      <SettingsList>
        {record.components.map((component) => (
          <SettingsRow
            control={
              <div className="flex items-center gap-3 text-muted-foreground text-xs">
                {hasDeliveryDifference(component) && (
                  <span
                    className="text-muted-foreground text-xs"
                    data-testid="extension-delivery-difference"
                  >
                    {deliveryDifferenceFacts(component, t).join(" · ")}
                  </span>
                )}
                <span>{component.kind === "mcp-server"
                  ? t("settings.extensions.package.mcpUnavailable")
                  : t(`settings.extensions.package.catalog.${component.enabled ? "on" : "off"}`)}</span>
              </div>
            }
            description={t("settings.extensions.package.componentDescription", {
              kind: t(`settings.extensions.package.kind.${component.kind}`),
              transport: component.transport,
            })}
            key={component.componentInstanceIdentity}
            label={component.componentId}
          />
        ))}
      </SettingsList>
      {(record.convergence || record.foreignOccupancies.length > 0) && (
        <ConvergenceNotes record={record} />
      )}
      {record.retainedGenerations.length > 0 && (
        <SettingsNoteList
          items={record.retainedGenerations.map((generation) => ({
            term: t("settings.extensions.package.generation", {
              generation:
                generation.resolvedCommit.slice(0, 12) ||
                generation.generationId,
            }),
            detail: generation.blockerCount
              ? t("settings.extensions.package.generationBlocked", {
                  count: generation.blockerCount,
                })
              : t("settings.extensions.package.generationFree"),
          }))}
        />
      )}
    </SettingsSection>
  );
}

function manageSkillsHref(record: ExtensionPackageView) {
  const query = `tab=skills&package=${encodeURIComponent(record.installIdentity)}`;
  return record.scope.kind === "project"
    ? `/projects/${encodeURIComponent(record.scope.projectId)}/settings?${query}`
    : `/settings/skills?${query}`;
}

function ConvergenceNotes({ record }: { record: ExtensionPackageView }) {
  const { t } = useAppTranslation();
  const convergence = record.convergence;
  const done = new Set(convergence?.completedSteps ?? []);
  return (
    <SettingsNoteList
      items={[
        ...(convergence
          ? CONVERGENCE_STEPS.map((step) => ({
              term: t(`settings.extensions.package.convergenceStep.${step}`),
              detail: done.has(step)
                ? t("settings.extensions.package.done")
                : t("settings.extensions.package.pending"),
            }))
          : []),
        ...(convergence?.blocked
          ? [{ term: t("settings.extensions.package.convergenceBlocked"), detail: convergence.blocked }]
          : []),
        ...record.foreignOccupancies.map((item) => ({
          term: t("settings.extensions.package.foreignCopy", {
            projectionId: item.projectionId,
          }),
          detail: t("settings.extensions.package.foreignCopyDetail", {
            componentInstanceIdentity: item.componentInstanceIdentity,
            strength: t(
              `settings.extensions.package.strength.${item.strength}`
            ),
          }),
        })),
      ]}
    />
  );
}

function UninstallPanel({
  record,
  busy,
  onRetry,
  onMigrate,
}: {
  record: NonNullable<ExtensionPackageView["uninstall"]>;
  busy: boolean;
  onRetry: () => void;
  onMigrate: (appId: string) => void;
}) {
  const { t } = useAppTranslation();
  const done = new Set(record.completedSteps);
  return (
    <>
      <SettingsNoteList
        items={[
          ...UNINSTALL_STEPS.map((step) => ({
            term: t(`settings.extensions.package.uninstallStep.${step}`),
            detail: done.has(step)
              ? t("settings.extensions.package.done")
              : t("settings.extensions.package.pending"),
          })),
          ...(record.blocked
            ? [{ term: t("settings.extensions.package.uninstallBlocked"), detail: record.blocked }]
            : []),
          ...(record.otherOwners.length
            ? [{ term: t("settings.extensions.package.otherOwners"), detail: record.otherOwners.join(", ") }]
            : []),
          ...(record.projectionLeases || record.sharedArtifacts
            ? [
                {
                  term: t("settings.extensions.package.runtimeReferences"),
                  detail: t(
                    "settings.extensions.package.runtimeReferencesDetail",
                    {
                      leases: record.projectionLeases,
                      artifacts: record.sharedArtifacts,
                    }
                  ),
                },
              ]
            : []),
          ...(record.custody.length
            ? [{ term: t("settings.extensions.package.custody"), detail: record.custody.join(", ") }]
            : []),
        ]}
      />
      {record.boundApps.length > 0 && (
        <SettingsList>
          {record.boundApps.map((app) => (
            <SettingsRow
              control={
                <SettingsButton disabled={busy} onClick={() => onMigrate(app.appId)}>
                  {t("settings.extensions.package.migrate")}
                </SettingsButton>
              }
              description={t("settings.extensions.package.migrateDescription", {
                generation: app.appGenerationId,
              })}
              key={`${app.appId}:${app.appGenerationId}`}
              label={`App ${app.appId}`}
            />
          ))}
        </SettingsList>
      )}
      {!record.boundApps.length && (
        <SettingsButton disabled={busy} onClick={onRetry}>
          {t("settings.extensions.package.retryUninstall")}
        </SettingsButton>
      )}
    </>
  );
}

const CONVERGENCE_STEPS: readonly ExtensionConvergenceStep[] = [
  "projection-binding-revoked",
  "shared-artifacts-released",
  "product-sessions-drained",
  "discovery-cache-invalidated",
];

const UNINSTALL_STEPS: readonly ExtensionUninstallStep[] = [
  "durable-references-resolved",
  "runtime-custody-drained",
  "package-generations-removed",
  "package-bytes-collected",
];

function eligibilityStatus(
  item: ExtensionPackageView["components"][number]["eligibility"][number],
  t: TFunction
) {
  return item.eligible
    ? t(`settings.extensions.package.strength.${item.strength}`)
    : t(
        `settings.extensions.package.exclusion.${item.exclusionCode ?? "turn-policy-ineligible"}`
      );
}

function hasDeliveryDifference(
  component: ExtensionPackageView["components"][number]
) {
  return (
    component.eligibility.some((item) => !item.eligible) ||
    (component.kind === "mcp-server" &&
      component.deliveryHealth.some((item) => item.status !== "healthy"))
  );
}

function deliveryDifferenceFacts(
  component: ExtensionPackageView["components"][number],
  t: TFunction
) {
  return [
    component.eligibility
      .filter((item) => !item.eligible)
      .map((item) =>
        t("settings.extensions.package.eligibilityEntry", {
          backend: item.backendId,
          status: eligibilityStatus(item, t),
        })
      )
      .join(" | "),
    component.kind === "mcp-server"
      ? component.deliveryHealth
          .filter((item) => item.status !== "healthy")
          .map((item) =>
            t("settings.extensions.package.healthEntry", {
              backend: item.backendId,
              status: t(
                `settings.extensions.package.deliveryHealth.${item.status}`
              ),
            })
          )
          .join(" | ")
      : "",
  ].filter(Boolean);
}
