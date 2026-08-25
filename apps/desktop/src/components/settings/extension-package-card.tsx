/**
 * [INPUT]: Depends on i18n, shared ExtensionPackageView Full lifecycle projection and settings-layout
 * [OUTPUT]: Provides ExtensionPackageCard, which displays the three-axis components in the administrative/global/App, activate, pack packaging, retained generation and unload blocks that can be removed/moved/re-tested
 * [POS]: The only view of the package lifecycle of settings; Skill Warehouse and Agent Plugins are just adapters, and no longer have a single set of state-of-the-art UI
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

export function ExtensionPackageCard({
  record,
  busy,
  onEnable,
  onDisable,
  onDisableComponent,
  onUpdate,
  onUninstall,
  onCancelUninstall,
  onRetryUninstall,
  onMigrate,
}: {
  record: ExtensionPackageView;
  busy: boolean;
  onEnable: (componentIdentity: string) => void;
  onDisable: () => void;
  onDisableComponent: (componentIdentity: string) => void;
  onUpdate: () => void;
  onUninstall: () => void;
  onCancelUninstall: () => void;
  onRetryUninstall: () => void;
  onMigrate: (appId: string) => void;
}) {
  const { t } = useAppTranslation();
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
          <SettingsButton disabled={busy} onClick={onUpdate} variant="ghost">
            {t("settings.extensions.package.checkUpdate")}
          </SettingsButton>
          <SettingsButton
            disabled={busy || record.administrativeState !== "active"}
            onClick={onDisable}
            variant="ghost"
          >
            {t("settings.extensions.package.disable")}
          </SettingsButton>
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
      <SettingsList>
        {record.components.map((component) => (
          <SettingsRow
            control={
              <div className="flex items-center gap-3">
                <span className="text-muted-foreground text-xs">
                  {component.kind === "mcp-server"
                    ? t("settings.extensions.package.mcpUnavailable")
                    : component.eligibility
                        .map((item) =>
                          t("settings.extensions.package.eligibilityEntry", {
                            backend: item.backendId,
                            status: eligibilityStatus(item, t),
                          })
                        )
                        .join(" | ")}
                  {` · ${t("settings.extensions.package.health")}: `}
                  {component.deliveryHealth
                    .map((item) =>
                      t("settings.extensions.package.healthEntry", {
                        backend: item.backendId,
                        status: t(
                          `settings.extensions.package.deliveryHealth.${item.status}`
                        ),
                      })
                    )
                    .join(" | ")}
                  {` · ${t("settings.extensions.package.turnEffect")}`}
                </span>
                <SettingsButton
                  disabled={busy || record.administrativeState !== "active"}
                  onClick={() =>
                    component.enabled
                      ? onDisableComponent(component.componentIdentity)
                      : onEnable(component.componentIdentity)
                  }
                >
                  {component.enabled
                    ? t("settings.extensions.package.disable")
                    : t("settings.extensions.package.enable")}
                </SettingsButton>
              </div>
            }
            description={t("settings.extensions.package.componentDescription", {
              kind: t(`settings.extensions.package.kind.${component.kind}`),
              transport: component.transport,
            })}
            htmlFor={`extension-${component.componentIdentity}`}
            key={component.componentIdentity}
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
            componentIdentity: item.componentIdentity,
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
              htmlFor={`extension-uninstall-${app.appId}`}
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
