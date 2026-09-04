/**
 * [INPUT]: Depends on React tabs, PanelSessionContext/eligibility, slot store, Browser tabs, the shared App authorization dialog/badge, the Base navigation/snapshot provider slices, and product-only Base/App/Image/Subagent panels
 * [OUTPUT]: Provides one tablist with a unified installed-App add flow, independent App tabs, per-App authorization triggers, localized fallbacks, restore sanitization, and product-query short circuits
 * [POS]: The side-panel tab composition root and sole renderer of panel regions
 */

import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { XIcon } from "lucide-react";
import { Button } from "@ai-chat/ui/components/ui/button";
import { cn } from "@ai-chat/ui/lib/utils";
import { panelChromeClassName } from "@/components/page-shell";
import {
  baseTabActionButtonClass,
  baseTabShellClass,
} from "@/components/bases/chrome/base-tab-chrome";
import { BaseWorkbench } from "@/components/bases/base-workbench";
import {
  useBaseSnapshots,
  useBasesNavigation,
} from "@/components/providers/bases-provider";
import type { ProjectedSubagent } from "@/lib/chat-turn-attach";
import type { ConversationImageProjection } from "./image/image-projection";
import { BROWSER_TAB_LIMIT } from "../../../../shared/browser-ipc";
import {
  panelConversationKey,
  panelEligibility,
  type PanelCapability,
  type PanelSessionContext,
  type SidePanelTabCommand,
} from "../runtime/chat-session-model";
import { SubagentList } from "../subagent/subagent-list";
import { BrowserPanel } from "../browser/browser-panel";
import { useBrowserTabs } from "../browser/use-browser-tabs";
import {
  AddPanelMenu,
  PanelTabsEmpty,
  WebTabIcon,
  appIdOf,
  imageRegionFor,
  isAppRegion,
  isImageRegion,
  specForRegion,
  type PanelRegion,
  type PanelTabId,
  type TabItem,
} from "./panel-catalog";
import { panelSlotStore, usePanelSlots } from "./panel-slot-store";
import {
  listAvailableApps,
  setDesignAutoOpen,
} from "@/lib/apps-client";
import type { AvailableAttachedApp } from "../../../../shared/apps-ipc";
import { AppTabPanel } from "./app-tab-panel";
import { AppGrantBadge } from "./grant/app-grant-badge";
import {
  ImageTabPanel,
  resolveConversationImage,
} from "./image/image-tab-panel";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { AppAuthorizationDialog } from "@/components/apps/authorization/app-authorization-dialog";

const SubagentPanel = lazy(() =>
  import("../subagent/subagent-panel").then((module) => ({
    default: module.SubagentPanel,
  }))
);

/** tabpanel 外壳：常驻挂载、hidden 切换，宿主不因切 tab 重建 */
function TabPanel({
  id,
  active,
  labelledBy,
  children,
}: {
  id: PanelRegion;
  active: boolean;
  labelledBy?: string;
  children: ReactNode;
}) {
  return (
    <div
      aria-labelledby={labelledBy ?? `panel-tab-${id}-trigger`}
      className="flex min-h-0 flex-1 flex-col overflow-hidden"
      hidden={!active}
      id={`panel-tab-${id}`}
      role="tabpanel"
    >
      {children}
    </div>
  );
}

async function loadAvailableApps(
  conversationId: string,
  conversationIncarnationId: string
): Promise<AvailableAttachedApp[]> {
  if (!conversationIncarnationId) return [];
  return listAvailableApps({
    conversationId,
    conversationIncarnationId,
  });
}

export function PanelTabs({
  context,
  subagents,
  command,
  onClose,
  galleryProjection,
}: {
  context: PanelSessionContext;
  subagents: Record<string, ProjectedSubagent>;
  command?: SidePanelTabCommand;
  onClose: () => void;
  galleryProjection?: ConversationImageProjection;
}) {
  const { t } = useAppTranslation();
  const { movedOwners, resolveForSection } = useBasesNavigation();
  const { snapshots } = useBaseSnapshots();
  const productRef = context.kind === "product" || context.kind === "adopted"
    ? context.productRef
    : null;
  const chatId = productRef?.chatId ?? panelConversationKey(context);
  const incarnationId = productRef?.incarnationId ?? "";
  const slotKey = panelSlotStore.key(context);
  const slots = usePanelSlots(context);
  const tabs = useMemo(() => [...slots.tabs], [slots.tabs]);
  const activeTabId = slots.active;
  const [availableApps, setAvailableApps] = useState<AvailableAttachedApp[]>([]);
  const [addAppOpen, setAddAppOpen] = useState(false);
  const refreshApps = useCallback(async () => {
    if (!productRef) return [];
    const apps = await loadAvailableApps(
      productRef.chatId,
      productRef.incarnationId
    );
    setAvailableApps(apps);
    return apps;
  }, [productRef]);
  useEffect(() => {
    if (!productRef) return;
    let active = true;
    void loadAvailableApps(productRef.chatId, productRef.incarnationId)
      .then((apps) => {
        if (active) setAvailableApps(apps);
      })
      .catch(() => {
        if (active) setAvailableApps([]);
      });
    return () => {
      active = false;
    };
  }, [productRef]);
  const [selectedAgentThreadId, setSelectedAgentThreadId] = useState(() =>
    command?.target === "subagents" ? command.agentThreadId ?? "" : ""
  );
  // Map 而非 Record：网页 tab 会反复生灭，键不清理就一直堆着已卸载的节点。
  const tabRefs = useRef(new Map<string, HTMLDivElement>());
  const handledNonce = useRef<number | null>(null);
  const [baseOwnerResult, setBaseOwnerResult] = useState({
    sectionId: "",
    ownerKey: "",
    absent: false,
    error: "",
  });
  const browser = useBrowserTabs(activeTabId === "browser");
  const resolvedImages = useMemo(
    () =>
      new Map(
        galleryProjection
          ? tabs.filter(isImageRegion).map((region) => [
              region,
              resolveConversationImage(
                region,
                galleryProjection,
                t("chat.sidePanel.image.fallbackTitle")
              ),
            ])
          : []
      ),
    [galleryProjection, t, tabs]
  );

  useEffect(() => {
    if (!productRef) return;
    let active = true;
    void resolveForSection(productRef.chatId)
      .then((target) => {
        if (active) {
          setBaseOwnerResult({
            sectionId: chatId,
            ownerKey: target.ownerKey,
            absent: target.status === "absent",
            error: "",
          });
        }
      })
      .catch((cause) => {
        if (active) {
          setBaseOwnerResult({
            sectionId: chatId,
            ownerKey: "",
            absent: false,
            error:
              cause instanceof Error
                ? cause.message
                : t("chat.sidePanel.baseOwnerResolveFailed"),
          });
        }
      });
    return () => {
      active = false;
    };
  }, [chatId, productRef, resolveForSection, t]);
  const visibleApps = productRef ? availableApps : [];
  const baseResolved = !productRef || baseOwnerResult.sectionId === chatId;
  const baseOwnerKey = productRef && baseResolved ? baseOwnerResult.ownerKey : "";
  const baseOwnerError = productRef && baseResolved ? baseOwnerResult.error : "";
  const effectiveBaseOwnerKey =
    movedOwners[baseOwnerKey] ?? baseOwnerKey;
  /* ── 「这条 chat 有没有 Base」──────────────────────────────────────
   * 否定只有一个来源：解析明确回答 absent。解析失败也当「有」，因为
   * ownerKey 落空时 tab 正文渲染的是那句错误、BaseWorkbench 根本不挂载，
   * 于是 ensure 跑不起来、Base 造不出来——「不隐式建库」与「错误看得见」
   * 同时成立。把一次 IPC 抖动谎报成「你没有 Base」才是两头皆输。
   *
   * snapshots 是单调的旁证：它只会说「见过」，永不说「没有」，故在 || 位
   * 上恒真无害。它兜住的正是本次挂载之后才出现的 Base——Agent 写库，或
   * 用户刚在空白页点出一个 Base 又把 tab 关掉。provider 变更本就会重渲染
   * 本组件，这一项零额外开销、零额外 IPC。
   * ─────────────────────────────────────────────────────────── */
  const baseExists =
    Boolean(productRef) &&
    baseResolved &&
    (!baseOwnerResult.absent || Boolean(snapshots[effectiveBaseOwnerKey]));

  const openPanel = (id: PanelTabId) => {
    const capability: PanelCapability = isImageRegion(id)
      ? "image"
      : isAppRegion(id)
        ? "app"
        : id;
    if (!panelEligibility(context, capability).allowed) return;
    panelSlotStore.open(slotKey, id);
    if (isAppRegion(id) && productRef) {
      void setDesignAutoOpen({
        appId: appIdOf(id),
        conversationId: productRef.chatId,
        conversationIncarnationId: productRef.incarnationId,
        suppressed: false,
      });
    }
    if (id === "subagents") setSelectedAgentThreadId("");
  };
  // 目录里唯一的分叉，只此一处：面板是单例，Browser 是工厂。
  const openFromCatalog = (id: PanelRegion) => {
    const capability: PanelCapability = id === "browser"
      ? "browser"
      : isImageRegion(id)
        ? "image"
      : isAppRegion(id)
        ? "app"
        : id;
    if (!panelEligibility(context, capability).allowed) return;
    if (id !== "browser") return openPanel(id);
    browser.createTab();
    panelSlotStore.activate(slotKey, "browser");
  };
  const catalogDisabled = (id: PanelRegion) => {
    const capability: PanelCapability = id === "browser"
      ? "browser"
      : isImageRegion(id)
        ? "image"
      : isAppRegion(id)
        ? "app"
        : id;
    if (!panelEligibility(context, capability).allowed) return true;
    return id === "browser"
      ? browser.snapshot.tabs.length >= BROWSER_TAB_LIMIT
      : tabs.includes(id);
  };
  const eligibilityReason = (capability: PanelCapability) => {
    const result = panelEligibility(context, capability);
    if (result.allowed) return undefined;
    return t(`chat.sidePanel.eligibility.${result.reason}`);
  };
  const catalogDisabledReason = (id: PanelRegion) =>
    eligibilityReason(
      id === "browser"
        ? "browser"
        : isImageRegion(id)
          ? "image"
          : isAppRegion(id)
            ? "app"
            : id
    );

  /* 处女 slot 的默认落点。写在派生之后而非组件顶部：dep 数组是 render 期
     求值的普通数组，baseExists 在它上面才声明，放回顶部就是 TDZ 崩。 */
  useEffect(() => {
    if (slots.revision > 0 || slots.tabs.length || slots.active) return;
    if (command) return;
    // 开面板不等于建 Base：没有就停在空白页，那张卡片是唯一的创建入口
    if (!baseExists) return;
    panelSlotStore.open(slotKey, "base");
  }, [
    baseExists,
    command,
    slotKey,
    slots.active,
    slots.revision,
    slots.tabs.length,
  ]);

  useEffect(() => {
    if (!command || handledNonce.current === command.nonce) return;
    const target = command.target;
    if (target === "openShell") {
      handledNonce.current = command.nonce;
      return;
    }
    if (target === "image") {
      if (!panelEligibility(context, "image").allowed) {
        handledNonce.current = command.nonce;
        return;
      }
      if (!galleryProjection?.hydrated) return;
      handledNonce.current = command.nonce;
      const source = command.source;
      const sourceChatId =
        source.kind === "generated" ? source.sourceRef.chatId : source.chatId;
      const sourceIncarnationId =
        source.kind === "generated"
          ? source.sourceRef.incarnationId
          : source.incarnationId;
      const region = imageRegionFor(source);
      if (
        !productRef ||
        sourceChatId !== productRef.chatId ||
        sourceIncarnationId !== productRef.incarnationId ||
        !resolveConversationImage(
          region,
          galleryProjection,
          t("chat.sidePanel.image.fallbackTitle")
        )
      ) {
        return;
      }
      panelSlotStore.open(slotKey, region);
      requestAnimationFrame(() => tabRefs.current.get(region)?.focus());
      return;
    }
    /* Base 与其余 target 只差一件事：它可能不存在。未定论时不落 handledNonce——
       本 effect 依赖 baseResolved，解析落地会把这条命令原样交回来；落早了，
       这一次点击就永远没有人处理。没有 Base 就什么都不动：面板照常展开，
       落点交给空白页，用户自己开过的 tab 不该被一次点击踢掉。 */
    if (target === "base") {
      if (!panelEligibility(context, "base").allowed) {
        handledNonce.current = command.nonce;
        return;
      }
      if (!baseResolved) return;
      handledNonce.current = command.nonce;
      if (baseExists) panelSlotStore.open(slotKey, "base");
      return;
    }
    if (target === "app") {
      handledNonce.current = command.nonce;
      /* command 是父级 nonce 投递的外部事件；刷新 main-owned projection 正是
         这个 effect 的同步职责，不是用 effect 派生本地 render state。 */
      // eslint-disable-next-line react-hooks/set-state-in-effect
      refreshApps();
      panelSlotStore.open(slotKey, `app:${command.appId}`);
      return;
    }
    handledNonce.current = command.nonce;
    // browser 不占面板席位——它是区域不是面板，命令只把激活态挪过去。
    if (target === "browser") panelSlotStore.activate(slotKey, target);
    else if (panelEligibility(context, "subagents").allowed) {
      panelSlotStore.open(slotKey, target);
    }
    if (target === "subagents") {
      // command 是父级递增 nonce 表达的外部事件；此处与 ensure/activate 同批落地。
      setSelectedAgentThreadId(command.agentThreadId ?? "");
    }
  }, [
    baseExists,
    baseResolved,
    chatId,
    command,
    context,
    galleryProjection,
    incarnationId,
    productRef,
    refreshApps,
    slotKey,
    t,
  ]);

  /* ── 区域失去内容时退位 ──────────────────────────────────────────
   * 最后一个网页 tab 可能被 Agent 关掉（browser_close），那条路径不经过本组件；
   * 区域已不存在，激活态必须跟着退位，否则会停在一个永远画不出内容的 tabpanel 上。
   *
   * 认的是「有 → 无」这一次跃迁，不是「此刻为无」这个状态。差别是致命的：
   * 点「+」→ Browser 会先乐观激活区域，main 的新 tab 投影要等一个来回才到，
   * 那期间 selectedTabId 仍是 null——按状态判定会当场把用户刚打开的区域踢回 Base。
   * 按跃迁判定则天然免疫：区域从未有过内容，也就无从失去。
   * ─────────────────────────────────────────────────────────── */
  const lastSelectedTabId = useRef<string | null>(null);
  useEffect(() => {
    const previous = lastSelectedTabId.current;
    lastSelectedTabId.current = browser.snapshot.selectedTabId;
    if (activeTabId !== "browser") return;
    if (!previous || browser.snapshot.selectedTabId) return;
    panelSlotStore.activate(slotKey, tabs[tabs.length - 1] ?? "");
  }, [activeTabId, browser.snapshot.selectedTabId, slotKey, tabs]);

  const selectedAgent = selectedAgentThreadId
    ? subagents[selectedAgentThreadId]
    : undefined;
  const activeHeaderActions = activeTabId
    ? effectiveBaseOwnerKey && productRef
      ? specForRegion(activeTabId).renderHeaderActions?.(
          effectiveBaseOwnerKey,
          productRef.chatId,
          onClose
        )
      : undefined
    : undefined;

  const items: TabItem[] = [
    ...tabs.map((id): TabItem => {
      const spec = specForRegion(id);
      const Icon = spec.icon;
      const catalogLabel = t(spec.labelKey);
      const attachedApp = isAppRegion(id)
        ? visibleApps.find((app) => app.appId === appIdOf(id))
        : undefined;
      const label = isAppRegion(id)
        ? attachedApp?.name ?? catalogLabel
        : isImageRegion(id)
          ? resolvedImages.get(id)?.label ?? catalogLabel
          : catalogLabel;
      return {
        key: id,
        region: id,
        label,
        icon: <Icon className="size-3.5 shrink-0" />,
        selected: activeTabId === id,
        panelId: `panel-tab-${id}`,
        widthClass: "min-w-0",
        closeLabel: t("chat.sidePanel.closeNamedTab", { name: label }),
        /* 权限徽标长在 App 自己的 tab 上：tab 条是 Base/Browser/Image 共用的
           chrome，挂在它右端的一颗盾说不清属于谁。所有者与标识同生共死。 */
        actions: attachedApp && productRef
          ? (
            <AppGrantBadge
              app={attachedApp}
              chatId={productRef.chatId}
              incarnationId={productRef.incarnationId}
              onChanged={() => refreshApps().then(() => undefined)}
              onRemoved={async () => {
                panelSlotStore.close(slotKey, id);
                await refreshApps();
              }}
            />
          )
          : effectiveBaseOwnerKey && productRef
            ? spec.renderTabActions?.(effectiveBaseOwnerKey, productRef.chatId)
            : undefined,
        select: () => panelSlotStore.activate(slotKey, id),
        close: () => {
          panelSlotStore.close(slotKey, id);
          if (isAppRegion(id) && productRef) {
            void setDesignAutoOpen({
              appId: appIdOf(id),
              conversationId: productRef.chatId,
              conversationIncarnationId: productRef.incarnationId,
              suppressed: true,
            });
          }
          if (id === "subagents") setSelectedAgentThreadId("");
        },
      };
    }),
    ...browser.snapshot.tabs.map((tab): TabItem => ({
      key: tab.tabId,
      region: "browser",
      label: tab.title || t("chat.sidePanel.newTab"),
      icon: <WebTabIcon tab={tab} />,
      selected:
        activeTabId === "browser" &&
        tab.tabId === browser.snapshot.selectedTabId,
      panelId: "panel-tab-browser",
      widthClass: "min-w-24",
      closeLabel: t("chat.sidePanel.closeNamedTab", {
        name: tab.title || t("chat.sidePanel.webPage"),
      }),
      select: () => {
        panelSlotStore.activate(slotKey, "browser");
        // 已选中就别再喊一遍：activateTab 会让 main 重挂 WebContentsView，
        // 而方向键连按会把这条路径踩成一串无谓的 re-parent。
        if (tab.tabId !== browser.snapshot.selectedTabId) {
          browser.activateTab(tab.tabId);
        }
      },
      close: () => browser.closeTab(tab.tabId),
    })),
  ];
  // 无人选中时（首帧、或激活区域正在退位）仍要留一个键盘入口，否则整条 tablist 不可达。
  const rovingKey = (items.find((item) => item.selected) ?? items[0])?.key;

  const closeAt = (index: number) => {
    const item = items[index]!;
    const rest = items.filter((_, position) => position !== index);
    item.close();
    if (!item.selected) return;
    // 只交接「哪片区域」。网页之间的接任归 main 的 closeTab 邻居规则，
    // 此处再插一手就是第二套策略，两套必然打架。
    panelSlotStore.activate(
      slotKey,
      rest[Math.min(index, rest.length - 1)]?.region ?? ""
    );
  };

  const onTabKeyDown = (
    event: KeyboardEvent<HTMLDivElement>,
    index: number
  ) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      items[index]!.select();
      return;
    }
    const targetIndex =
      event.key === "ArrowRight"
        ? (index + 1) % items.length
        : event.key === "ArrowLeft"
          ? (index - 1 + items.length) % items.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? items.length - 1
              : -1;
    if (targetIndex < 0) return;
    event.preventDefault();
    const target = items[targetIndex]!;
    target.select();
    tabRefs.current.get(target.key)?.focus();
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <header className="flex h-[var(--page-shell-header-height)] shrink-0 items-center gap-1 border-b px-2 [-webkit-app-region:drag]">
        <div className="flex min-w-0 flex-1 items-center gap-1 [-webkit-app-region:no-drag]">
          <div
            aria-label={t("chat.sidePanel.tabsAriaLabel")}
            className="flex min-w-0 items-center gap-1 overflow-x-auto"
            role="tablist"
          >
            {items.map((item, index) => (
              <div
                aria-controls={item.panelId}
                aria-selected={item.selected}
                className={cn(
                  baseTabShellClass(item.selected),
                  "h-7 shrink-0 gap-1.5",
                  item.widthClass
                )}
                id={`panel-tab-${item.key}-trigger`}
                key={item.key}
                onClick={item.select}
                onKeyDown={(event) => onTabKeyDown(event, index)}
                ref={(node) => {
                  if (node) tabRefs.current.set(item.key, node);
                  return () => {
                    tabRefs.current.delete(item.key);
                  };
                }}
                role="tab"
                tabIndex={item.key === rovingKey ? 0 : -1}
              >
                {item.icon}
                <span className="truncate">{item.label}</span>
                {item.actions}
                <button
                  aria-label={item.closeLabel}
                  className={baseTabActionButtonClass}
                  onClick={(event) => {
                    event.stopPropagation();
                    closeAt(index);
                  }}
                  title={t("chat.sidePanel.closeTab")}
                  type="button"
                >
                  <XIcon className="size-3" />
                </button>
              </div>
            ))}
          </div>
          <AddPanelMenu
            appsDisabled={!productRef}
            disabledFor={catalogDisabled}
            disabledReasonFor={catalogDisabledReason}
            onOpen={openFromCatalog}
            onOpenApp={() => setAddAppOpen(true)}
          />
        </div>
        <div className="[-webkit-app-region:no-drag]">
          {activeHeaderActions ?? (
            <Button
              aria-label={t("chat.sidePanel.closePanel")}
              className={cn("cursor-pointer", panelChromeClassName)}
              onClick={onClose}
              size="icon-lg"
              title={t("chat.sidePanel.closePanel")}
              type="button"
              variant="ghost"
            >
              <XIcon />
            </Button>
          )}
        </div>
      </header>
      {productRef && tabs.includes("base") && (
        <TabPanel active={activeTabId === "base"} id="base">
          {effectiveBaseOwnerKey ? (
            <BaseWorkbench
              key={effectiveBaseOwnerKey}
              ownerKey={effectiveBaseOwnerKey}
              compact
              attachmentOwner={
                galleryProjection?.incarnationId
                  ? {
                      chatId: productRef.chatId,
                      incarnationId: productRef.incarnationId,
                    }
                  : undefined
              }
            />
          ) : (
            <div className="grid min-h-0 flex-1 place-items-center px-6 text-center text-muted-foreground text-sm">
              {baseOwnerError || t("chat.sidePanel.resolvingBase")}
            </div>
          )}
        </TabPanel>
      )}
      {productRef && tabs.includes("subagents") && (
        <TabPanel active={activeTabId === "subagents"} id="subagents">
          {selectedAgent ? (
            <Suspense fallback={null}>
              <SubagentPanel
                agent={selectedAgent}
                onBack={() => setSelectedAgentThreadId("")}
                onOpenSubagent={setSelectedAgentThreadId}
                subagents={subagents}
              />
            </Suspense>
          ) : (
            <SubagentList
              onOpen={setSelectedAgentThreadId}
              subagents={subagents}
            />
          )}
        </TabPanel>
      )}
      {productRef && tabs.filter(isAppRegion).map((region) => {
        const app = visibleApps.find((item) => item.appId === appIdOf(region));
        return (
          <TabPanel active={activeTabId === region} id={region} key={region}>
            {app ? (
              <AppTabPanel
                app={app}
                chatId={productRef.chatId}
                incarnationId={productRef.incarnationId}
                visible={activeTabId === region}
              />
            ) : (
              <div className="grid min-h-0 flex-1 place-items-center px-6 text-center text-muted-foreground text-sm">
                {t("chat.sidePanel.appSlotUnavailable")}
              </div>
            )}
          </TabPanel>
        );
      })}
      {tabs.filter(isImageRegion).map((region) => (
        <TabPanel active={activeTabId === region} id={region} key={region}>
          <ImageTabPanel
            active={activeTabId === region}
            hydrated={galleryProjection?.hydrated ?? false}
            image={resolvedImages.get(region) ?? null}
          />
        </TabPanel>
      ))}
      {(browser.snapshot.tabs.length > 0 || activeTabId === "browser") && (
        <TabPanel
          active={activeTabId === "browser"}
          id="browser"
          labelledBy={
            browser.snapshot.selectedTabId
              ? `panel-tab-${browser.snapshot.selectedTabId}-trigger`
              : undefined
          }
        >
          <BrowserPanel
            controller={browser}
            visible={activeTabId === "browser"}
          />
        </TabPanel>
      )}
      {/* 栅栏用 baseResolved 而非 baseExists：只抑制首帧那一下「空白页→Base」
          的闪现，此后任何重渲染都不会把已经端出去的空白页再闪掉。 */}
      {!items.length && !activeTabId && baseResolved && (
        <PanelTabsEmpty
          disabledFor={catalogDisabled}
          disabledReasonFor={catalogDisabledReason}
          onOpen={openFromCatalog}
          onOpenApp={() => setAddAppOpen(true)}
        />
      )}
      {productRef && (
        <AppAuthorizationDialog
          mode="add"
          onCommitted={async (appId) => {
            const refreshed = await refreshApps();
            if (!refreshed.some((app) => app.appId === appId)) {
              throw new Error(t("apps.authorization.savedRefreshFailed"));
            }
            openPanel(`app:${appId}`);
          }}
          onOpenChange={setAddAppOpen}
          open={addAppOpen}
          openAppIds={tabs.filter(isAppRegion).map(appIdOf)}
          target={{
            kind: "chat",
            chatId: productRef.chatId,
            expectedConversationIncarnationId: productRef.incarnationId,
          }}
        />
      )}
    </div>
  );
}
