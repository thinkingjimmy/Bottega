/**
 * [INPUT]: Depends on the panel context (Trash projection, focus, Escape layers) and lucide status glyphs.
 * [OUTPUT]: Provides `TrashDetail`: honest empty/contains/unknown wording, the Finder Automation branches (ask first, denied with the System Settings path, unavailable), an in-panel irreversible confirmation before the single empty command, progress, and every result — with Open Finder instead of any retry.
 * [POS]: system-dock/panel/views/detail Trash renderer (3.5, INV-12, INV-14); an unknown outcome is never retried or reported as empty.
 */
import { useEffect, useRef, useState } from "react";
import { FolderOpen, LoaderCircle, TriangleAlert } from "lucide-react";
import type { TrashDetail as TrashProjection } from "../../../../../shared/system-dock/ipc";
import { useEscapeLayer, usePanel } from "../../context";

const STATE_KEYS = { empty: "systemDock.trash.empty", full: "systemDock.trash.full", unknown: "systemDock.trash.unknown" } as const;
const RESULT_KEYS = {
  emptied: "systemDock.trash.resultEmptied", partial: "systemDock.trash.resultPartial", failed: "systemDock.trash.resultFailed",
  unknown: "systemDock.trash.resultUnknown", denied: "systemDock.trash.resultDenied", cancelled: "systemDock.trash.resultCancelled",
} as const;

export function TrashDetail() {
  const { snapshot, t, send } = usePanel();
  const trash: TrashProjection | null = snapshot.trash;
  const [confirming, setConfirming] = useState(false);
  const confirmRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLButtonElement>(null);
  useEscapeLayer(confirming, () => { setConfirming(false); requestAnimationFrame(() => openerRef.current?.focus()); });
  /* Emptying started (here or from the native menu) ends any open confirmation; adjusting during
     render keeps a stale confirmation from reappearing once the command finishes. */
  const emptying = Boolean(trash?.emptying);
  const [seenEmptying, setSeenEmptying] = useState(emptying);
  if (emptying !== seenEmptying) { setSeenEmptying(emptying); if (emptying) setConfirming(false); }
  // Moving into the confirmation is a user action, so focus follows it to the safe choice.
  useEffect(() => { if (confirming) confirmRef.current?.querySelector<HTMLButtonElement>("button[data-cancel]")?.focus(); }, [confirming]);
  if (!trash) return <p className="empty-state" role="status">{t("systemDock.trash.loading")}</p>;
  const automation = trash.automation;
  const blocked = automation === "denied" || automation === "unavailable";
  return <>
    <div className="scroll">
      <p className="lead" data-trash={trash.state}>{t(STATE_KEYS[trash.state])}</p>
      {trash.lastResult !== "none" && !trash.emptying && <p className="note" role="status"
        data-tone={trash.lastResult === "emptied" || trash.lastResult === "cancelled" ? undefined : "caution"}>{t(RESULT_KEYS[trash.lastResult])}</p>}
      {trash.emptying ? <p className="progress" role="status"><LoaderCircle className="spin" aria-hidden="true" />{t("systemDock.trash.emptying")}</p>
        : confirming ? <div className="confirm" ref={confirmRef} role="group" aria-labelledby="dock-trash-confirm-title" aria-describedby="dock-trash-confirm-body">
          <p className="confirm-title" id="dock-trash-confirm-title"><TriangleAlert aria-hidden="true" />{t("systemDock.trash.confirmTitle")}</p>
          <p id="dock-trash-confirm-body">{t("systemDock.trash.confirmBody")}</p>
          <div className="button-row">
            <button type="button" className="button" data-cancel onClick={() => { setConfirming(false); requestAnimationFrame(() => openerRef.current?.focus()); }}>{t("systemDock.panel.cancel")}</button>
            <button type="button" className="button danger" onClick={() => {
              // The one command is sent once; progress and the result come back from main, never a second confirmation.
              setConfirming(false); send({ kind: "empty-trash", confirmed: true });
            }}>{t("systemDock.trash.confirmAction")}</button>
          </div>
        </div>
          : automation === "needs-prompt" ? <div className="explain">
            <p>{t("systemDock.trash.automationPrompt")}</p>
            <button type="button" className="button primary" onClick={() => send({ kind: "request-automation" })}>{t("systemDock.trash.automationContinue")}</button>
          </div>
            : blocked ? <p className="explain">{t(automation === "denied" ? "systemDock.trash.automationDenied" : "systemDock.trash.automationUnavailable")}</p>
              : <button ref={openerRef} type="button" className="button danger-outline" data-autofocus disabled={trash.state === "empty"}
                onClick={() => setConfirming(true)}>{t("systemDock.trash.emptyAction")}</button>}
    </div>
    <footer className="panel-footer">
      <button type="button" className="text-button" onClick={() => send({ kind: "open-finder" })}><FolderOpen aria-hidden="true" />{t("systemDock.trash.openFinder")}</button>
    </footer>
  </>;
}
