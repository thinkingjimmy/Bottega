/**
 * [INPUT]: Depends on React lazy/Suspense, the panel context and five detail renderers; Tasks loads only when requested.
 * [OUTPUT]: Provides `DetailView`, choosing the Downloads, Trash, Tasks, AI limits or AI usage detail for the item main is serving, with an honest fallback when the item is gone.
 * [POS]: system-dock/panel/views/detail dispatcher; one panel host serves every detail (5.2), so a second item switches content instead of opening a window.
 */
import { usePanel } from "../../context";
import { DownloadsDetail } from "./download-view";
import { LimitsDetail } from "./limits";
import { TokensDetail } from "./tokens";
import { lazy, Suspense } from "react";
import { TrashDetail } from "./trash";

const TasksDetail = lazy(() => import("./tasks").then((module) => ({ default: module.TasksDetail })));
const CustomDetail=lazy(()=>import('./custom').then(module=>({default:module.CustomDetail})));

export function DetailView({ itemId }: { itemId: string }) {
  const { snapshot, t } = usePanel();
  const item = snapshot.items.find((value) => value.id === itemId);
  if (!item) return <p className="empty-state" role="status">{t("systemDock.panel.itemGone")}</p>;
  if (item.entry === "system.downloads") return <DownloadsDetail />;
  if (item.entry === "system.trash") return <TrashDetail />;
  if (item.widget?.type === "builtin.tasks") return <Suspense fallback={<p className="empty-state" role="status">{t("settings.presence.preparing")}</p>}><TasksDetail /></Suspense>;
  if (item.widget?.type === "builtin.ai-limits") return <LimitsDetail itemId={itemId} />;
  if (item.widget?.type === "builtin.ai-activity") return <TokensDetail itemId={itemId} />;
  if(item.widget?.type==='custom')return <Suspense fallback={<p className="empty-state" role="status">{t('settings.presence.preparing')}</p>}><CustomDetail itemId={itemId}/></Suspense>;
  return <p className="empty-state" role="status">{t("systemDock.panel.itemGone")}</p>;
}
