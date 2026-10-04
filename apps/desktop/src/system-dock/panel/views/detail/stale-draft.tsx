/**
 * [INPUT]: Depends on the panel context (draft, translator, intents).
 * [OUTPUT]: Provides `StaleDraftNotice`: when the applied Widget changed elsewhere after this draft began, say so and offer "use my changes" (forced apply) or "discard mine".
 * [POS]: system-dock/panel/views/detail shared draft guard (3.4, INV-15); a remote edit is never overwritten without this explicit choice.
 */
import { usePanel } from "../../context";

export function StaleDraftNotice({ itemId, onDone }: { itemId: string; onDone?: () => void }) {
  const { snapshot, t, send } = usePanel();
  if (snapshot.draft?.itemId !== itemId || !snapshot.draft.stale) return null;
  return <div className="note" role="alert" data-tone="caution">
    <p>{t("systemDock.panel.draftStale")}</p>
    <div className="button-row">
      <button type="button" className="button" onClick={() => { send({ kind: "widget-cancel", itemId }); onDone?.(); }}>{t("systemDock.panel.draftDiscard")}</button>
      <button type="button" className="button primary" onClick={() => { send({ kind: "widget-apply", itemId, force: true }); onDone?.(); }}>{t("systemDock.panel.draftKeepMine")}</button>
    </div>
  </div>;
}
