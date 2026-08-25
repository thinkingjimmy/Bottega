/**
 * [INPUT]: Depends on lucide icons, UI Button/DropdownMenu, Base-tab-chrome action style, Base App operation, conversation, image source and shared web tab Projection
 * [OUTPUT]: Provides PanelTabId/PanelRegion/ImageRegionId/TabItem, word, image region, decoding,
 * [POS]: The tabs of the chat/side-panel are the source of identity truth; This is the boundary between manually open directories and dynamic Image regions that can only be opened from conversation
 */

import { useState, type ReactNode } from "react";
import {
  BotIcon,
  DatabaseIcon,
  DownloadIcon,
  ExternalLinkIcon,
  GlobeIcon,
  ImageIcon,
  LoaderCircleIcon,
  MoreHorizontal,
  PanelsTopLeftIcon,
  PackagePlusIcon,
  PlusIcon,
  type LucideIcon,
} from "lucide-react";
import { Link } from "react-router";
import { Button } from "@ai-chat/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@ai-chat/ui/components/ui/dropdown-menu";
import {
  BaseHeaderActions,
  useBaseAppActions,
} from "@/components/bases/chrome/base-header-actions";
import { cn } from "@ai-chat/ui/lib/utils";
import { baseTabActionButtonClass } from "@/components/bases/chrome/base-tab-chrome";
import { panelChromeClassName } from "@/components/page-shell";
import { SaveAsAppDialog } from "@/components/apps/save-as-app-dialog";
import type { BrowserTabProjection } from "../../../../shared/browser-ipc";
import type { AvailableAttachedApp } from "../../../../shared/apps-ipc";
import type { ConversationImageSource } from "../runtime/chat-session-model";

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

export type ImageRegionIdentity =
  | { kind: "generated"; assistantSeq: number; itemId: string }
  | { kind: "attachment"; attachmentId: string };

const ATTACHMENT_ID = /^[A-Za-z0-9_-]{10,64}$/;

export function imageRegionFor(source: ConversationImageSource): ImageRegionId {
  return source.kind === "generated"
    ? `image:generated:${source.sourceRef.assistantSeq}:${encodeURIComponent(source.sourceRef.itemId)}`
    : `image:attachment:${source.attachment.id}`;
}

export function imageIdentityOf(region: string): ImageRegionIdentity | null {
  if (region.startsWith("image:attachment:")) {
    const attachmentId = region.slice("image:attachment:".length);
    return ATTACHMENT_ID.test(attachmentId)
      ? { kind: "attachment", attachmentId }
      : null;
  }
  if (!region.startsWith("image:generated:")) return null;
  const encoded = region.slice("image:generated:".length);
  const separator = encoded.indexOf(":");
  if (separator <= 0 || separator === encoded.length - 1) return null;
  const assistantSeq = Number(encoded.slice(0, separator));
  if (!Number.isSafeInteger(assistantSeq) || assistantSeq < 0) return null;
  try {
    const itemId = decodeURIComponent(encoded.slice(separator + 1));
    return itemId && itemId.length <= 256
      ? { kind: "generated", assistantSeq, itemId }
      : null;
  } catch {
    return null;
  }
}

export const isImageRegion = (region: string): region is ImageRegionId =>
  imageIdentityOf(region) !== null;

/* ── 面板目录：可开清单的唯一真相源 ────────────────────────────────
 * tab 条、add 菜单、空白页曾各自知道「有哪些面板、长什么图标」，
 * 于是每加一个面板要在三处落笔，漏一处就是静默的能力残缺。
 * 把身份收进这张表后，三者都只是它的投影——
 * 新增面板 = 追加一条数据，UI 自己长出来。
 * ─────────────────────────────────────────────────────────── */
type PanelTabSpec<Id extends string = PanelCatalogId> = {
  id: Id;
  label: string;
  icon: LucideIcon;
  /** 空白页卡片副标题：一句话说清这个面板给你什么 */
  hint: string;
  /** tab 内联动作（如 Base 的 ⋯ 菜单）；没有就没有 */
  renderTabActions?: (ownerKey: string, chatId: string) => ReactNode;
  /** 该 tab 激活时的头部右簇；缺省则只给「关闭面板」 */
  renderHeaderActions?: (
    ownerKey: string,
    chatId: string,
    onClose: () => void
  ) => ReactNode;
};

export const PANEL_TAB_SPECS: readonly PanelTabSpec[] = [
  {
    id: "base",
    label: "Base",
    icon: DatabaseIcon,
    hint: "结构化收集本次对话沉淀的数据",
    renderTabActions: (ownerKey, chatId) => (
      <BaseTabMenu chatId={chatId} ownerKey={ownerKey} />
    ),
    renderHeaderActions: (ownerKey, chatId, onClose) => (
      <BaseHeaderActions
        chatId={chatId}
        ownerKey={ownerKey}
        mode="panel"
        onClose={onClose}
      />
    ),
  },
  {
    id: "subagents",
    label: "Subagents",
    icon: BotIcon,
    hint: "查看子代理的分工与执行详情",
  },
  {
    id: "browser",
    label: "Browser",
    icon: GlobeIcon,
    hint: "新开网页，Agent 与你共用登录态",
  },
  {
    id: "app",
    label: "App",
    icon: PanelsTopLeftIcon,
    hint: "打开已授权 App；建 tab 不会启动 App",
  },
];

export const PANEL_TAB_SPEC = Object.fromEntries(
  PANEL_TAB_SPECS.map((spec) => [spec.id, spec])
) as Record<PanelCatalogId, PanelTabSpec>;

const IMAGE_TAB_SPEC: PanelTabSpec<"image"> = {
  id: "image",
  label: "Image",
  icon: ImageIcon,
  hint: "查看 conversation 图片",
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
  actions?: ReactNode;
  select: () => void;
  close: () => void;
};

/** Base tab 的 App/CSV 菜单：随 Base tab 生灭，不存在时不订阅 Base 状态 */
function BaseTabMenu({
  ownerKey,
  chatId,
}: {
  ownerKey: string;
  chatId: string;
}) {
  const {
    app,
    busy,
    defaultName,
    ready,
    saveChatId,
    exportCsv,
  } = useBaseAppActions(ownerKey, chatId);
  const [saveOpen, setSaveOpen] = useState(false);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            aria-label="More Base actions"
            className={baseTabActionButtonClass}
            onClick={(event) => event.stopPropagation()}
            title="More"
            type="button"
          >
            <MoreHorizontal className="size-3" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-36">
          {app ? (
            <DropdownMenuItem asChild>
              <Link to={`/apps/${app.id}`}>
                <ExternalLinkIcon />
                Open App
              </Link>
            </DropdownMenuItem>
          ) : saveChatId ? (
            <DropdownMenuItem
              disabled={busy || !ready}
              onSelect={() => setSaveOpen(true)}
            >
              <PackagePlusIcon />
              Save as App
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem
            disabled={busy || !ready}
            onSelect={() => void exportCsv()}
          >
            <DownloadIcon />
            Download CSV
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {saveChatId && (
        <SaveAsAppDialog
          chatId={saveChatId}
          defaultName={defaultName}
          onOpenChange={setSaveOpen}
          open={saveOpen}
        />
      )}
    </>
  );
}

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

/** tab 条右端的 add：清单全部不可开则整枚置灰，否则逐项判定 */
export function AddPanelMenu({
  disabledFor,
  onOpen,
  availableApps = [],
  appsDisabled = false,
}: {
  disabledFor: (id: PanelRegion) => boolean;
  onOpen: (id: PanelRegion) => void;
  availableApps?: readonly AvailableAttachedApp[];
  appsDisabled?: boolean;
}) {
  const full = PANEL_TAB_SPECS.every((spec) =>
    spec.id === "app"
      ? appsDisabled ||
        !availableApps.some((app) => !disabledFor(`app:${app.appId}`))
      : disabledFor(spec.id)
  );
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label="添加面板"
          className={cn(
            "shrink-0 cursor-pointer text-muted-foreground",
            panelChromeClassName
          )}
          disabled={full}
          size="icon-lg"
          title={full ? "面板已全部打开" : "添加面板"}
          type="button"
          variant="ghost"
        >
          <PlusIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-40">
        {PANEL_TAB_SPECS.map((spec) => {
          const Icon = spec.icon;
          if (spec.id === "app") {
            return availableApps.length ? (
              availableApps.map((app) => (
                <DropdownMenuItem
                  disabled={appsDisabled || disabledFor(`app:${app.appId}`)}
                  key={`app:${app.appId}`}
                  onSelect={() => onOpen(`app:${app.appId}`)}
                >
                  <Icon />
                  {app.name}
                </DropdownMenuItem>
              ))
            ) : (
              <DropdownMenuItem disabled key="app-empty">
                <Icon />
                先在 Chat 或 Project 授权 App
              </DropdownMenuItem>
            );
          }
          const region = spec.id as PanelRegion;
          return (
            <DropdownMenuItem
              disabled={disabledFor(region)}
              key={region}
              onSelect={() => onOpen(region)}
            >
              <Icon />
              {spec.label}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** 空白页：目录的卡片式投影，条目增长只是多一行，无需改版式 */
export function PanelTabsEmpty({
  onOpen,
  availableApps = [],
}: {
  onOpen: (id: PanelRegion) => void;
  availableApps?: readonly AvailableAttachedApp[];
}) {
  return (
    <div className="grid min-h-0 flex-1 place-items-center px-5 py-6">
      <div className="flex w-full max-w-72 flex-col gap-1.5">
        {PANEL_TAB_SPECS.map((spec) => {
          const Icon = spec.icon;
          if (spec.id === "app") {
            return availableApps.map((app) => (
              <button
                aria-label={`打开 ${app.name}`}
                className="group/panel-card flex w-full cursor-pointer items-center gap-2.5 rounded-lg border bg-card px-3 py-2.5 text-left transition-colors hover:border-foreground/15 hover:bg-accent"
                key={`app:${app.appId}`}
                onClick={() => onOpen(`app:${app.appId}`)}
                type="button"
              >
                <span className="grid size-7 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
                  <Icon className="size-3.5" />
                </span>
                <span className="min-w-0 flex-1 truncate font-medium text-sm">
                  {app.name}
                </span>
                <PlusIcon className="size-3.5 shrink-0 text-muted-foreground" />
              </button>
            ));
          }
          const region = spec.id as PanelRegion;
          return (
            <button
              aria-label={`打开 ${spec.label}`}
              className="group/panel-card flex w-full cursor-pointer items-center gap-2.5 rounded-lg border bg-card px-3 py-2.5 text-left transition-colors hover:border-foreground/15 hover:bg-accent"
              key={region}
              onClick={() => onOpen(region)}
              type="button"
            >
              <span className="grid size-7 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground transition-colors group-hover/panel-card:text-foreground">
                <Icon className="size-3.5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-sm">
                  {spec.label}
                </span>
                <span className="block truncate text-muted-foreground text-xs">
                  {spec.hint}
                </span>
              </span>
              <PlusIcon className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/panel-card:opacity-100" />
            </button>
          );
        })}
      </div>
    </div>
  );
}
