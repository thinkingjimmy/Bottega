/**
 * [INPUT]: Depends on i18n, icons, UI menu primitives, Base/App actions, the unified App authorization entry, panel eligibility, image identity, and Browser tab projections
 * [OUTPUT]: Provides canonical panel tab/region types, parsers, i18n-keyed catalog descriptors, and keyboard-readable directory UI with one contextual App entry
 * [POS]: The tab identity and add-menu truth source for chat/side-panel
 */

import { useAppTranslation } from "@/components/providers/i18n-provider";
import { SidePanelAddMenu,SidePanelCatalog } from "@ai-chat/ui/components/workspace/side-panel/catalog";
import {
GlobeIcon,
ImageIcon,
LoaderCircleIcon,
type LucideIcon
} from "lucide-react";
import { lazy,Suspense,useState,type ReactNode } from "react";
import type { BrowserTabProjection } from "../../../../shared/browser-ipc";
import type { ConversationImageSource } from "../runtime/chat-session-model";

import { encodeImageIdentity, decodeImageIdentity } from "@ai-chat/chat-ui/image/identity";
import { PANEL_CATALOG } from "@ai-chat/chat-ui/side-panel/catalog";
const BaseTabMenu = lazy(() => import("./catalog/base-actions"));
const BaseHeaderActions = lazy(() => import("@/components/bases/chrome/base-header-actions").then(module => ({ default: module.BaseHeaderActions })));

/* ── 区域与身份：为何 browser 不在 PanelTabId 里 ────────────────────
 * base/subagents 是面板——一个 id 对应一个实例，开与关归本组件。
 * browser 不是面板，是一片区域：里面住着多少网页、此刻选中哪个，
 * 全由 main 的 BrowserPanelService 说了算。渲染端若也存一份「选中哪个网页」，
 * 这个状态就有了两个主人，接着就得写同步规则、防 ping-pong、防抢焦点。
 *
 * 于是这里只回答一个问题：browser 这片区域是不是当前激活的。
 * 具体是哪个网页，永远现问 snapshot.selectedTabId——不抄，就不会不同步。
 * ─────────────────────────────────────────────────────────── */
export type AppRegionId = `app:${string}`;
export type ImageRegionId = `image:generated:${string}` | `image:attachment:${string}`;
export type PanelTabId = "base" | "subagents" | AppRegionId | ImageRegionId;
export type PanelRegion = PanelTabId | "browser";
export type PanelCatalogId = "base" | "subagents" | "browser" | "app";

export const isAppRegion = (region: string): region is AppRegionId =>
  region.startsWith("app:") && region.length > 4;
export const appIdOf = (region: AppRegionId) => region.slice(4);

export function imageRegionFor(source: ConversationImageSource): ImageRegionId {
  return encodeImageIdentity(source.kind === "generated"
    ? { kind: "generated", messageId: `seq:${source.sourceRef.assistantSeq}`, subagentId: source.subagentId ?? null, itemId: source.sourceRef.itemId }
    : { kind: "attachment", attachmentId: source.attachment.id });
}
export const isImageRegion = (region: string): region is ImageRegionId =>
  decodeImageIdentity(region) !== null;

/* ── 面板目录：可开清单的唯一真相源 ────────────────────────────────
 * tab 条、add 菜单、空白页曾各自知道「有哪些面板、长什么图标」，
 * 于是每加一个面板要在三处落笔，漏一处就是静默的能力残缺。
 * 把身份收进这张表后，三者都只是它的投影——
 * 新增面板 = 追加一条数据，UI 自己长出来。
 * ─────────────────────────────────────────────────────────── */
type PanelTabSpec<Id extends string = PanelCatalogId> = {
  id: Id;
  labelKey: `chat.sidePanel.catalog.${Id}.label`;
  icon: LucideIcon;
  /** 空白页卡片副标题：一句话说清这个面板给你什么 */
  hintKey: `chat.sidePanel.catalog.${Id}.hint`;
  /** tab 内联动作（如 Base 的 ⋯ 菜单）；没有就没有 */
  renderTabActions?: (ownerKey: string, chatId: string) => ReactNode;
  /** 该 tab 激活时的头部右簇；缺省则只给「关闭面板」 */
  renderHeaderActions?: (
    ownerKey: string,
    chatId: string,
    onClose: () => void
  ) => ReactNode;
};

export const PANEL_TAB_SPECS: readonly PanelTabSpec[] = PANEL_CATALOG.map(spec => ({ ...spec,
  ...(spec.id === "base" ? {
    renderTabActions: (ownerKey: string, chatId: string) => <Suspense fallback={null}><BaseTabMenu chatId={chatId} ownerKey={ownerKey} /></Suspense>,
    renderHeaderActions: (ownerKey: string, chatId: string, onClose: () => void) => <Suspense fallback={null}><BaseHeaderActions chatId={chatId} ownerKey={ownerKey} mode="panel" onClose={onClose} /></Suspense>,
  } : {}),
}));

export const PANEL_TAB_SPEC = Object.fromEntries(
  PANEL_TAB_SPECS.map((spec) => [spec.id, spec])
) as Record<PanelCatalogId, PanelTabSpec>;

const IMAGE_TAB_SPEC: PanelTabSpec<"image"> = {
  id: "image",
  labelKey: "chat.sidePanel.catalog.image.label",
  icon: ImageIcon,
  hintKey: "chat.sidePanel.catalog.image.hint",
};

export function specForRegion(region: PanelRegion) {
  if (isAppRegion(region)) return PANEL_TAB_SPEC.app;
  if (isImageRegion(region)) return IMAGE_TAB_SPEC;
  return PANEL_TAB_SPEC[region];
}

/**
 * tab 条的统一投影。条本身不认「面板还是网页」——异构性在这一层就消化掉，
 * 于是渲染、roving 键盘导航、关闭接任全都只有一条路径。
 */
export type TabItem = {
  /** 面板用自己的 id，网页用 main 发的 tabId；两个命名空间不可能相撞 */
  key: string;
  /** 激活它意味着激活哪片区域——关闭接任只交接区域，不越权决定哪个网页 */
  region: PanelRegion;
  label: string;
  icon: ReactNode;
  selected: boolean;
  /** aria-controls 目标；所有网页 tab 共用同一个 tabpanel，因为 main 一次只挂一个 view */
  panelId: string;
  widthClass: string;
  closeLabel: string;
  /** Native tooltip; the accessible name still comes from the visible label. */
  hint?: string;
  /** Dimmed chrome for a tab whose page process has been released. */
  dim?: boolean;
  actions?: ReactNode;
  select: () => void;
  close: () => void;
};

/**
 * 网页 tab 的图标位：加载中 → 站点图标 → 兜底地球，三态互斥。
 *
 * Chromium 会为「站点根下有没有 favicon.ico」这件事一律报一个地址，取不到是常态；
 * 不接 onError 的话那些站点得到的是浏览器的碎图标——比兜底地球更难看也更没信息。
 * 失败记的是 URL 而非布尔：换个站点、或本站后来补上了图标，都能自己恢复。
 */
export function WebTabIcon({ tab }: { tab: BrowserTabProjection }) {
  const [failedUrl, setFailedUrl] = useState("");
  if (tab.loading) {
    return <LoaderCircleIcon className="size-3.5 shrink-0 animate-spin" />;
  }
  if (tab.faviconUrl && tab.faviconUrl !== failedUrl) {
    const url = tab.faviconUrl;
    // 站点图标由产品 renderer 直接取，不走浏览器分区：不能顺手把用户带去过的
    // 页面地址回报给图标所在的站点。
    return (
      <img
        alt=""
        className="size-3.5 shrink-0 rounded-[2px]"
        onError={() => setFailedUrl(url)}
        referrerPolicy="no-referrer"
        src={url}
      />
    );
  }
  return <GlobeIcon className="size-3.5 shrink-0" />;
}

/** Desktop adapters preserve the canonical directory identities and localized names. */
function useCatalog() {
  const { t } = useAppTranslation();
  return { t, items: PANEL_TAB_SPECS.map(spec => ({ id: spec.id === "app" ? "app:catalog" : spec.id, label: t(spec.labelKey), hint: t(spec.hintKey), icon: spec.icon, menuHint: spec.id === "app" })) };
}
export function AddPanelMenu({ disabledFor, disabledReasonFor, onOpen, onOpenApp, appsDisabled = false }: {
  disabledFor(id: PanelRegion): boolean; disabledReasonFor?(id: PanelRegion): string | undefined; onOpen(id: PanelRegion): void; onOpenApp(): void; appsDisabled?: boolean;
}) {
  const { t, items } = useCatalog();
  return <SidePanelAddMenu items={items} disabledFor={id => id === "app:catalog" && appsDisabled || disabledFor(id as PanelRegion)} disabledReasonFor={id => disabledReasonFor?.(id as PanelRegion)}
    onOpen={id => id === "app:catalog" ? onOpenApp() : onOpen(id as PanelRegion)} label={t("chat.sidePanel.addPanel")} fullLabel={t("chat.sidePanel.allPanelsOpen")}
    accessibleLabel={(item, reason) => reason ? t("chat.sidePanel.unavailableNamedPanel", { name: item.label, reason }) : t("chat.sidePanel.openNamedPanel", { name: item.label })} />;
}
export function PanelTabsEmpty({ onOpen, onOpenApp, disabledFor = () => false, disabledReasonFor }: {
  onOpen(id: PanelRegion): void; onOpenApp(): void; disabledFor?(id: PanelRegion): boolean; disabledReasonFor?(id: PanelRegion): string | undefined;
}) {
  const { t, items } = useCatalog();
  return <SidePanelCatalog items={items} disabledFor={id => disabledFor(id as PanelRegion)} disabledReasonFor={id => disabledReasonFor?.(id as PanelRegion)}
    onOpen={id => id === "app:catalog" ? onOpenApp() : onOpen(id as PanelRegion)}
    accessibleLabel={(item, reason) => reason ? t("chat.sidePanel.unavailableNamedPanel", { name: item.label, reason }) : t("chat.sidePanel.openNamedPanel", { name: item.label })} />;
}
