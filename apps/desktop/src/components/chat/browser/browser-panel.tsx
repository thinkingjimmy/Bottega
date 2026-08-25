/**
 * [INPUT]: Depends on React, use BrowserTabsController of BrowserTabsTabs, project, and use the UI Button/Input
 * [OUTPUT]: Provides BrowserPanel: Address tabs/navigation, DIP viewpoints and Agent control status bar
 * [POS]: The chrome renderer of the chat/browser; The web tabs are mentioned above, and the web pixels are drawn by the main WebContentsView
 */

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  RefreshCwIcon,
  SquareIcon,
} from "lucide-react";
import { Button } from "@ai-chat/ui/components/ui/button";
import { Input } from "@ai-chat/ui/components/ui/input";
import { cn } from "@ai-chat/ui/lib/utils";
import { normalizeBrowserUrl } from "../../../../shared/browser-ipc";
import type { BrowserTabsController } from "./use-browser-tabs";

export function BrowserPanel({
  visible,
  controller,
}: {
  visible: boolean;
  controller: BrowserTabsController;
}) {
  const { bridge, snapshot, busy, error, clearError, run } = controller;
  const [address, setAddress] = useState("");
  const [addressError, setAddressError] = useState("");
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const activeId = snapshot.selectedTabId;
  const active = useMemo(
    () => snapshot.tabs.find((tab) => tab.tabId === activeId),
    [activeId, snapshot.tabs]
  );
  const fieldError = addressError || error;

  /* ── 地址栏防覆写 ────────────────────────────────────────────────
   * 只在「换 tab 或该 tab 真的导航了」时回同步。title/loading/agentAction
   * 是高频投影，它们不改变下面这两个值，也就永远覆盖不了用户正在输入的内容。
   *
   * 用渲染期校正而非 effect：effect 会先把上一个 tab 的地址画一帧再纠正，
   * 网页 tab 升为顶层公民后切 tab 是高频动作，那一帧闪烁看得见。
   * ─────────────────────────────────────────────────────────── */
  const [addressSync, setAddressSync] = useState({ tabId: "", url: "" });
  if (
    active &&
    (addressSync.tabId !== active.tabId || addressSync.url !== active.url)
  ) {
    setAddressSync({ tabId: active.tabId, url: active.url });
    if (active.url) setAddress(active.url);
  }

  useEffect(() => {
    const node = viewportRef.current;
    if (!bridge || !node || !visible) return;
    const report = () => {
      const rect = node.getBoundingClientRect();
      void bridge.setViewport({
        x: Math.max(0, rect.x),
        y: Math.max(0, rect.y),
        width: Math.max(0, rect.width),
        height: Math.max(0, rect.height),
      });
    };
    report();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(report);
    observer.observe(node);
    window.addEventListener("resize", report);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", report);
    };
  }, [bridge, visible, active?.agentActive]);

  const submitAddress = (event: FormEvent) => {
    event.preventDefault();
    if (!bridge) return;
    const url = normalizeBrowserUrl(address);
    if (!url) {
      setAddressError("请输入 http(s) 地址或裸域名");
      return;
    }
    void run(async () => {
      if (active) {
        await bridge.navigate({ tabId: active.tabId, url });
      } else {
        await bridge.createTab({ url });
      }
    });
  };

  if (!bridge) {
    return (
      <div className="grid min-h-0 flex-1 place-items-center px-6 text-center text-muted-foreground text-sm">
        Browser 仅在桌面应用中可用
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      <form
        className="flex h-11 shrink-0 items-center gap-1.5 border-b px-2"
        onSubmit={submitAddress}
      >
        <Button
          aria-label="后退"
          disabled={!active?.canGoBack || busy}
          onClick={() =>
            active && void bridge.goBack({ tabId: active.tabId })
          }
          size="icon-sm"
          title="后退"
          type="button"
          variant="ghost"
        >
          <ArrowLeftIcon />
        </Button>
        <Button
          aria-label="前进"
          disabled={!active?.canGoForward || busy}
          onClick={() =>
            active && void bridge.goForward({ tabId: active.tabId })
          }
          size="icon-sm"
          title="前进"
          type="button"
          variant="ghost"
        >
          <ArrowRightIcon />
        </Button>
        <Button
          aria-label="刷新"
          disabled={!active || busy}
          onClick={() =>
            active && void bridge.reload({ tabId: active.tabId })
          }
          size="icon-sm"
          title="刷新"
          type="button"
          variant="ghost"
        >
          <RefreshCwIcon className={active?.loading ? "animate-spin" : ""} />
        </Button>
        <Input
          aria-invalid={Boolean(fieldError)}
          aria-label="浏览器地址"
          className={cn(
            "h-8 min-w-0 flex-1 rounded-full bg-muted/60 px-3 text-xs",
            fieldError && "animate-[shake_.18s_ease-in-out_2] ring-1 ring-destructive"
          )}
          onChange={(event) => {
            setAddress(event.target.value);
            setAddressError("");
            clearError();
          }}
          placeholder="输入网址"
          title={fieldError || address}
          value={address}
        />
      </form>

      <div className="relative min-h-0 flex-1" ref={viewportRef}>
        {/* 网页 tab 已是顶部条的一等公民，此处不再有「没开过浏览器」的长期空态，
            只剩 main 首帧投影未到的那一瞬——除非新建当场就失败了，那就说出来，
            否则这句「正在打开」会一直转下去，把失败演成永远的等待。 */}
        {!active && (
          <div className="absolute inset-0 z-10 grid place-items-center bg-background px-6 text-center text-muted-foreground text-sm">
            {error || "正在打开网页…"}
          </div>
        )}
      </div>

      {active?.agentActive && (
        <div
          aria-live="polite"
          className="flex h-10 shrink-0 items-center gap-2 border-t bg-muted/40 px-3 text-xs"
          role="status"
        >
          <span className="size-2 animate-pulse rounded-full bg-blue-500" />
          <span className="font-medium">Agent 正在控制</span>
          {active.agentAction && (
            <span className="min-w-0 flex-1 truncate text-muted-foreground">
              {active.agentAction}
            </span>
          )}
          <Button
            aria-label="停止 Agent 浏览器动作"
            className="h-7 gap-1.5"
            onClick={() =>
              void bridge.stopAgentBatch({ tabId: active.tabId })
            }
            size="sm"
            type="button"
            variant="outline"
          >
            <SquareIcon className="size-3 fill-current" />
            停止
          </Button>
        </div>
      )}
    </div>
  );
}
