/**
 * [INPUT]: Depends on the trusted native save dialog, current app locale and native catalog, account display state and nonblocking diagnostic snapshots.
 * [OUTPUT]: Exports a bounded local recovery report with capture times, stable codes and no account identity or content.
 * [POS]: Main-window diagnostic export; works while offline and never requests a network operation.
 */
import { app, dialog, type BrowserWindow } from "electron";
import { writeFile } from "node:fs/promises";
import type { AppLocale } from "@ai-chat/ui/lib/locale";
import { translate } from "../../../../../shared/i18n/native";
import { serialQueueDiagnostics } from "../../../persistence/serial-queue";
import type { CloudAccountService } from "../service";
import { recoveryDiagnostics } from "./timeline";
export async function exportRecoveryDiagnostics(window: BrowserWindow, service: CloudAccountService, locale: AppLocale) {
  const capturedAt = Date.now(), state = service.snapshot();
  const report = { format: "bottega-recovery/v1", capturedAt, version: app.getVersion(),
    account: { status: state.status, error: state.error },
    encryption: { status: state.encryption.status, error: state.encryption.error },
    sync: { status: state.sync.status, phase: state.sync.phase, error: state.sync.error,
      pending: state.sync.pending, conflicts: state.sync.conflicts, waiting: state.sync.waiting },
    remoteHealth: service.remoteHealth(), presence: service.presenceDiagnostics(), queues: serialQueueDiagnostics(), timeline: recoveryDiagnostics.snapshot() };
  const result = await dialog.showSaveDialog(window, { defaultPath: `bottega-recovery-${new Date(capturedAt).toISOString().replace(/[:.]/g, "-")}.json`,
    filters: [{ name: translate(locale, "settings.native.filterJson"), extensions: ["json"] }] });
  if (result.canceled || !result.filePath || window.isDestroyed()) return;
  await writeFile(result.filePath, JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
}
