"use client";

/**
 * [INPUT]: Depends on trusted Apps client Design candidate/import/list/restore IPC, React identity refs, UI Button, and localized copy
 * [OUTPUT]: Provides DesignHistoryControls with live trusted import candidates, file-bound version selection, stale-response fencing, and lease-safe confirmed restore/list convergence before GUI refresh
 * [POS]: Trusted Studio chrome above the untrusted Design GUI iframe; it is the only renderer mutation entry for canvas history
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@ai-chat/ui/components/ui/button";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import {
  importDesignCanvas,
  listDesignImportCandidates,
  listDesignFiles,
  listDesignVersions,
  onAppsEvent,
  restoreDesignVersion,
} from "@/lib/apps-client";
import type { DesignCanvasVersion } from "../../../../shared/apps-ipc";

export function DesignHistoryControls({
  appId,
  appSurfaceLeaseId,
  onRestored,
}: {
  appId: string;
  appSurfaceLeaseId: string;
  onRestored(): void;
}) {
  const { t } = useAppTranslation();
  const [file, setFile] = useState("");
  const [candidate, setCandidate] = useState("");
  const [files, setFiles] = useState<string[]>([]);
  const [candidates, setCandidates] = useState<string[]>([]);
  const [versions, setVersions] = useState<DesignCanvasVersion[]>([]);
  const [versionsFile, setVersionsFile] = useState("");
  const [versionId, setVersionId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef("");
  const versionRequestRef = useRef(0);
  const selectFile = useCallback((next: string) => {
    if (fileRef.current === next) return;
    fileRef.current = next;
    versionRequestRef.current += 1;
    setFile(next);
    setVersions([]);
    setVersionsFile("");
    setVersionId("");
  }, []);
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const [nextFiles, nextCandidates] = await Promise.all([
          listDesignFiles({ appId, appSurfaceLeaseId }),
          listDesignImportCandidates({ appId, appSurfaceLeaseId }),
        ]);
        if (!active) return;
        setFiles(nextFiles);
        selectFile(nextFiles.includes(fileRef.current) ? fileRef.current : nextFiles[0] || "");
        setCandidates(nextCandidates);
        setCandidate((current) => nextCandidates.includes(current) ? current : nextCandidates[0] || "");
        setError("");
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : String(cause));
      }
    };
    void refresh();
    const unsubscribe = onAppsEvent((event) => {
      if (event.type === "design-canvases-changed" && event.appId === appId) {
        void refresh();
      }
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [appId, appSurfaceLeaseId, selectFile]);
  const loadVersions = async (targetFile = fileRef.current) => {
    if (!targetFile) return false;
    const request = ++versionRequestRef.current;
    const next = await listDesignVersions({ appId, appSurfaceLeaseId, file: targetFile });
    if (request !== versionRequestRef.current || fileRef.current !== targetFile) return false;
    setVersions(next);
    setVersionsFile(targetFile);
    setVersionId(next[0]?.versionId ?? "");
    return true;
  };
  const run = (operation: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    void operation()
      .catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => setBusy(false));
  };
  return (
    <div className="flex min-w-0 items-center gap-1" data-testid="design-history-controls">
      <select
        aria-label={t("apps.designImportCandidate")}
        className="h-7 w-44 rounded-md border bg-background px-2 text-xs"
        disabled={busy}
        onChange={(event) => setCandidate(event.target.value)}
        value={candidate}
      >
        {!candidate && <option value="">{t("apps.designNoImportCandidates")}</option>}
        {candidates.map((candidate) => <option key={candidate} value={candidate}>{candidate}</option>)}
      </select>
      <Button
        disabled={busy || !candidate}
        onClick={() => run(async () => {
          await importDesignCanvas({ appId, appSurfaceLeaseId, file: candidate });
          selectFile(candidate);
          await loadVersions(candidate);
          const [nextFiles, nextCandidates] = await Promise.all([
            listDesignFiles({ appId, appSurfaceLeaseId }),
            listDesignImportCandidates({ appId, appSurfaceLeaseId }),
          ]);
          setFiles(nextFiles);
          setCandidates(nextCandidates);
          setCandidate(nextCandidates[0] || "");
          onRestored();
        })}
        size="sm"
        variant="outline"
      >
        {t("apps.designImport")}
      </Button>
      <select
        aria-label={t("apps.designCanvasFile")}
        className="h-7 w-44 rounded-md border bg-background px-2 text-xs"
        disabled={busy}
        onChange={(event) => selectFile(event.target.value)}
        value={file}
      >
        {!file && <option value="">{t("apps.designCanvasFile")}</option>}
        {files.map((item) => <option key={item} value={item}>{item}</option>)}
      </select>
      <Button disabled={busy || !file} onClick={() => run(loadVersions)} size="sm" variant="ghost">
        {t("apps.designVersions")}
      </Button>
      {versions.length > 0 && (
        <select
          aria-label={t("apps.designVersion")}
          className="h-7 max-w-40 rounded-md border bg-background px-2 text-xs"
          disabled={busy}
          onChange={(event) => setVersionId(event.target.value)}
          value={versionId}
        >
          {versions.map((version) => (
            <option key={version.versionId} value={version.versionId}>
              {new Date(version.createdAt).toLocaleString()} · {version.source}
            </option>
          ))}
        </select>
      )}
      <Button
        disabled={busy || versionsFile !== file || !versions.some((item) => item.versionId === versionId)}
        onClick={() => {
          const targetFile = fileRef.current;
          const targetVersionId = versionId;
          if (versionsFile !== targetFile || !versions.some((item) => item.versionId === targetVersionId)) return;
          if (!window.confirm(t("apps.designRestoreConfirm"))) return;
          run(async () => {
            await restoreDesignVersion({ appId, appSurfaceLeaseId, versionId: targetVersionId, confirmed: true });
            if (await loadVersions(targetFile)) onRestored();
          });
        }}
        size="sm"
        variant="outline"
      >
        {t("apps.designRestore")}
      </Button>
      {error && <span className="max-w-48 truncate text-destructive text-xs" role="alert">{error}</span>}
    </div>
  );
}
