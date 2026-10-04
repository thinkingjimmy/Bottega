/**
 * [INPUT]: Depends on the panel context and the four detail renderers.
 * [OUTPUT]: Provides `DetailView`, choosing the Downloads, Trash, AI limits or AI usage detail for the item main is serving, with an honest fallback when the item is gone.
 * [POS]: system-dock/panel/views/detail dispatcher; one panel host serves every detail (5.2), so a second item switches content instead of opening a window.
 */
import { usePanel } from "../../context";
import { DownloadsDetail } from "./downloads";
import { LimitsDetail } from "./limits";
import { TokensDetail } from "./tokens";
import { TrashDetail } from "./trash";

export function DetailView({ itemId }: { itemId: string }) {
  const { snapshot, t } = usePanel();
  const item = snapshot.items.find((value) => value.id === itemId);
  if (!item) return <p className="empty-state" role="status">{t("systemDock.panel.itemGone")}</p>;
  if (item.entry === "system.downloads") return <DownloadsDetail />;
  if (item.entry === "system.trash") return <TrashDetail />;
  if (item.widget?.type === "builtin.ai-limits") return <LimitsDetail itemId={itemId} />;
  if (item.widget?.type === "builtin.ai-activity") return <TokensDetail itemId={itemId} />;
  return <p className="empty-state" role="status">{t("systemDock.panel.itemGone")}</p>;
}
