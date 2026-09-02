/**
 * [INPUT]: Depends on React state, an optional stable toolbar action host, i18n, scope-aware Extension client commands, package cards/dialog, and Settings primitives
 * [OUTPUT]: Provides one flat owned-package lifecycle surface reusable by global and Project Settings, with a portal-mounted global acquisition action or section-level fallback
 * [POS]: Canonical Extension UI; CLI Agent-plugin diagnostics stay main-only and invalidations trigger qualified refetches
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Blocks, Plus } from "lucide-react";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import type {
  ExtensionRetainedInstallDataView,
  ExtensionScopeMutation,
  ExtensionsSnapshot,
} from "../../shared/extensions-ipc";
import {
  GLOBAL_PRODUCT_RESOURCE_SCOPE,
  productResourceScopeKey,
  sameProductResourceScope,
  type ProductResourceScope,
} from "../../shared/product-resource-scope";
import {
  ExtensionInstallDialog,
  type ExtensionInstallSource,
} from "@/components/settings/extension-install-dialog";
import { ExtensionPackageCard } from "@/components/settings/extension-package-card";
import {
  SettingsAlert,
  SettingsButton,
  SettingsEmpty,
  SettingsList,
  SettingsRow,
  SettingsSection,
} from "@/components/settings/settings-layout";
import {
  beginDisableExtension,
  beginUninstallExtension,
  cancelUninstallExtension,
  hasExtensionsBridge,
  listExtensions,
  onExtensionsChanged,
  purgeExtensionInstallData,
  resolveUninstallExtension,
} from "@/lib/extensions-client";
import { errorMessage } from "@/lib/errors";
import { Button } from "@ai-chat/ui/components/ui/button";

export function ExtensionsContent({
  scope = GLOBAL_PRODUCT_RESOURCE_SCOPE,
  projectLifecycleRevision = null,
  description,
  packageIdentity = null,
  toolbarActionHost,
}: {
  scope?: ProductResourceScope;
  projectLifecycleRevision?: number | null;
  description?: string;
  packageIdentity?: string | null;
  toolbarActionHost?: HTMLElement | null;
}) {
  const { t } = useAppTranslation();
  const authorityKey = `${productResourceScopeKey(scope)}@${projectLifecycleRevision ?? "none"}`;
  const authorityRef = useRef(authorityKey);
  useEffect(() => {
    authorityRef.current = authorityKey;
  }, [authorityKey]);
  const [snapshotState, setSnapshotState] = useState<{
    authorityKey: string;
    snapshot: ExtensionsSnapshot | null;
    ready: boolean;
  }>(() => ({ authorityKey, snapshot: null, ready: false }));
  const snapshot = snapshotState.authorityKey === authorityKey
    ? snapshotState.snapshot
    : null;
  const authorityReady = snapshot !== null && snapshotState.ready;
  const [installState, setInstallState] = useState<{
    authorityKey: string;
    epoch: number;
    source: ExtensionInstallSource;
  } | null>(null);
  const install = installState?.authorityKey === authorityKey
    ? installState.source
    : null;
  const requestEpoch = useRef(0);
  const [currentRequestEpoch, setCurrentRequestEpoch] = useState(0);
  const [busyState, setBusyState] = useState<{
    authorityKey: string;
    epoch: number | null;
  }>({ authorityKey, epoch: null });
  const busy = busyState.authorityKey === authorityKey &&
    busyState.epoch !== null && busyState.epoch === currentRequestEpoch;
  const [errorState, setErrorState] = useState({ authorityKey, message: "" });
  const error = errorState.authorityKey === authorityKey
    ? errorState.message
    : "";
  const bridgeMissing = !hasExtensionsBridge();
  const isCurrent = useCallback(
    (epoch: number, key: string) =>
      requestEpoch.current === epoch && authorityRef.current === key,
    []
  );
  const nextEpoch = useCallback(() => {
    const epoch = ++requestEpoch.current;
    setCurrentRequestEpoch(epoch);
    return epoch;
  }, []);

  const refresh = useCallback(async (preserveError = false) => {
    const epoch = nextEpoch();
    setBusyState({ authorityKey, epoch: null });
    setInstallState(null);
    setSnapshotState((current) => ({
      authorityKey,
      snapshot: current.authorityKey === authorityKey ? current.snapshot : null,
      ready: false,
    }));
    if (!preserveError) setErrorState({ authorityKey, message: "" });
    try {
      const next = await listExtensions({
        scope,
        expectedProjectLifecycleRevision: projectLifecycleRevision,
      });
      if (isCurrent(epoch, authorityKey)) {
        setSnapshotState({ authorityKey, snapshot: next, ready: true });
        setBusyState({ authorityKey, epoch: null });
      }
      return next;
    } catch (cause) {
      if (isCurrent(epoch, authorityKey)) {
        setErrorState({ authorityKey, message: errorMessage(cause) });
      }
      throw cause;
    }
  }, [authorityKey, isCurrent, nextEpoch, projectLifecycleRevision, scope]);

  useEffect(() => {
    if (!hasExtensionsBridge()) return;
    queueMicrotask(() => void refresh().catch(() => undefined));
    const unsubscribe = onExtensionsChanged((event) => {
      if (
        sameProductResourceScope(event.scope, scope) &&
        event.projectLifecycleRevision === projectLifecycleRevision
      ) {
        void refresh().catch(() => undefined);
      }
    });
    return () => {
      requestEpoch.current += 1;
      unsubscribe();
    };
  }, [authorityKey, projectLifecycleRevision, refresh, scope]);

  const mutation = useCallback(
    (installIdentity: string): ExtensionScopeMutation => ({
      installIdentity,
      expectedScope: scope,
      expectedProjectLifecycleRevision: projectLifecycleRevision,
      expectedScopeRevision: snapshot!.version.scopeRevision,
    }),
    [projectLifecycleRevision, scope, snapshot]
  );

  const run = useCallback(async (task: () => Promise<ExtensionsSnapshot>) => {
    if (!authorityReady) return;
    const epoch = nextEpoch();
    setBusyState({ authorityKey, epoch });
    setErrorState({ authorityKey, message: "" });
    setSnapshotState((current) => ({ ...current, ready: false }));
    try {
      const next = await task();
      if (isCurrent(epoch, authorityKey)) {
        setSnapshotState({ authorityKey, snapshot: next, ready: true });
      }
    } catch (cause) {
      if (isCurrent(epoch, authorityKey)) {
        setErrorState({ authorityKey, message: errorMessage(cause) });
        setBusyState({ authorityKey, epoch: null });
        void refresh(true).catch(() => undefined);
      }
    } finally {
      if (isCurrent(epoch, authorityKey)) {
        setBusyState({ authorityKey, epoch: null });
      }
    }
  }, [authorityKey, authorityReady, isCurrent, nextEpoch, refresh]);

  const alert = bridgeMissing
    ? t("settings.extensions.page.bridgeMissing")
    : error;
  const beginInstall = () => {
    const epoch = nextEpoch();
    setInstallState({ authorityKey, epoch, source: { repoUrl: "" } });
  };

  return (
    <>
      {toolbarActionHost &&
        createPortal(
          <Button
            disabled={busy || bridgeMissing || !authorityReady}
            onClick={beginInstall}
            size="lg"
          >
            <Plus />
            {t("settings.extensions.page.installGithub")}
          </Button>,
          toolbarActionHost
        )}
      <div className="space-y-8">
        {snapshot?.productSessionAdmissionClosed && (
          <SettingsAlert tone="warn">
            {t("settings.extensions.page.admissionClosed")}
          </SettingsAlert>
        )}
        <SettingsSection
          action={toolbarActionHost === undefined ? (
            <SettingsButton
              disabled={busy || bridgeMissing || !authorityReady}
              onClick={beginInstall}
              variant="outline"
            >
              <Plus className="size-4" />
              {t("settings.extensions.page.installGithub")}
            </SettingsButton>
          ) : undefined}
          alert={alert || undefined}
          description={description ?? t("settings.extensions.page.installedDescription")}
          title={t("settings.extensions.page.installedTitle")}
        >
          {!authorityReady ? (
            <div
              aria-live="polite"
              aria-busy="true"
              className="min-h-24 animate-pulse rounded-lg bg-muted/40 motion-reduce:animate-none"
              role="status"
            >
              <span className="sr-only">
                {t("settings.extensions.page.installedTitle")}
              </span>
            </div>
          ) : snapshot!.packages.filter(
              (record) => !packageIdentity || record.installIdentity === packageIdentity
            ).length ? (
            <div className="space-y-3">
              {snapshot!.packages
                .filter((record) =>
                  !packageIdentity || record.installIdentity === packageIdentity
                )
                .map((record) => (
                <ExtensionPackageCard
                  busy={busy || Boolean(install)}
                  key={record.installIdentity}
                  onCancelUninstall={() =>
                    void run(() =>
                      cancelUninstallExtension(mutation(record.installIdentity))
                    )
                  }
                  onDisable={() =>
                    void run(() =>
                      beginDisableExtension(mutation(record.installIdentity))
                    )
                  }
                  onMigrate={(appId) =>
                    void run(() =>
                      resolveUninstallExtension({
                        ...mutation(record.installIdentity),
                        migrateAppIds: [appId],
                      })
                    )
                  }
                  onRetryUninstall={() =>
                    void run(() =>
                      resolveUninstallExtension(mutation(record.installIdentity))
                    )
                  }
                  onUninstall={() =>
                    void run(() =>
                      beginUninstallExtension(mutation(record.installIdentity))
                    )
                  }
                  onUpdate={() =>
                    setInstallState({
                      authorityKey,
                      epoch: nextEpoch(),
                      source: {
                        repoUrl: record.source.normalizedUrl,
                        ...(record.source.subdirectory
                          ? { subdirectory: record.source.subdirectory }
                          : {}),
                      },
                    })
                  }
                  record={record}
                />
                ))}
            </div>
          ) : (
            <SettingsEmpty
              hint={t("settings.extensions.page.emptyHint")}
              icon={<Blocks />}
              title={t("settings.extensions.page.emptyTitle")}
            />
          )}
        </SettingsSection>

        {authorityReady && snapshot!.retainedInstallData.length > 0 && (
          <SettingsSection
            description={t("settings.extensions.page.retainedDescription")}
            title={t("settings.extensions.page.retainedTitle")}
          >
            <SettingsList>
              {snapshot!.retainedInstallData.map((record) => (
                <RetainedDataRow
                  busy={busy}
                  key={record.installIdentity}
                  onPurge={() =>
                    void run(() =>
                      purgeExtensionInstallData(mutation(record.installIdentity))
                    )
                  }
                  record={record}
                />
              ))}
            </SettingsList>
          </SettingsSection>
        )}
      </div>

      {snapshot && (
        <ExtensionInstallDialog
          authority={snapshot.version}
          authorityEpoch={installState?.epoch ?? currentRequestEpoch}
          onInstalled={(next, epoch) => {
            if (!isCurrent(epoch, authorityKey)) return;
            setSnapshotState({ authorityKey, snapshot: next, ready: true });
            setInstallState(null);
          }}
          onOpenChange={(next) => !next && setInstallState(null)}
          source={authorityReady ? install : null}
        />
      )}
    </>
  );
}

function RetainedDataRow({
  record,
  busy,
  onPurge,
}: {
  record: ExtensionRetainedInstallDataView;
  busy: boolean;
  onPurge: () => void;
}) {
  const { t } = useAppTranslation();
  const digest = record.installIdentity.replace("sha256:", "").slice(0, 12);
  const state = record.custody.length
    ? t("settings.extensions.page.retainedCustody", {
        custody: record.custody.join(", "),
      })
    : t("settings.extensions.page.retainedEpochs", {
        count: record.epochIds.length,
      });
  return (
    <SettingsRow
      control={
        <SettingsButton
          disabled={busy || record.custody.length > 0}
          onClick={onPurge}
          variant="ghost"
        >
          {t("settings.extensions.page.purgeData")}
        </SettingsButton>
      }
      description={[state, record.sourceLabel, digest].filter(Boolean).join(" · ")}
      label={record.displayLabel}
    />
  );
}
