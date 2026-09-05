/**
 * [INPUT]: Depends on React external-store hooks, i18n, lib/sidebar-update-view verdicts, update-client store/RELEASE_URL, app external-link IPC, and lucide glyphs
 * [OUTPUT]: Provides SidebarUpdateButton — the footer update affordance across every update phase
 * [POS]: components/sidebar 的底部状态知会：常态是无底色的 24×32 幽灵药丸（hover 才浮出底色），下载中改用一条又宽又矮的进度轨；结论住在 lib/sidebar-update-view，这里只负责把结论穿上衣服
 */

import { useEffect, useSyncExternalStore } from "react";
import { CircleAlert, Download, ExternalLink, Loader2 } from "lucide-react";
import { cn } from "@ai-chat/ui/lib/utils";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { openExternal } from "@/lib/agent-client";
import { RELEASE_URL, updateStore } from "@/lib/update-client";
import {
  describeSidebarUpdate,
  type SidebarUpdateGlyph,
  type SidebarUpdateTone,
} from "@/lib/sidebar-update-view";

const GLYPHS: Record<SidebarUpdateGlyph, typeof CircleAlert> = {
  download: Download,
  external: ExternalLink,
  spinner: Loader2,
  /* 与 Settings › About 的更新失败同字形。旁边 Memory 那颗告警是
     TriangleAlert：同一行里两个圆角三角会让两件无关的事互相冒充。 */
  alert: CircleAlert,
};

/* ============================================================
 * 底色不常驻，hover 才浮出一颗药丸。
 *
 * 同一行左边的 Memory 告警本来就是这个做派（无底色 + hover:bg-sidebar-accent）。
 * 更新按钮先前顶着一块 --primary 实心色，等于在这条已经站着一行导航的
 * 页脚里再立一块常驻实体——而它既不常驻也不可导航。
 *
 * 「有新版本」这件事不靠底色喊：静息三相里这颗按钮根本不存在，
 * **一枚下载箭头出现在页脚，本身就是全部的消息**。语气只需决定它多重。
 * ============================================================ */
const TONES: Record<SidebarUpdateTone, string> = {
  loud: "text-sidebar-foreground",
  quiet: "text-muted-foreground",
  danger: "text-destructive",
};

/* 24×32 药丸：比同行的 Settings（h-8）矮 8px，落在它的光学高度之内而不
   占满；全圆角把它与侧栏清一色 8px 圆角的矩形行区分开——形状自己说
   「我是临时的」。曾经这里是 44px 方块，把整条 footer 撑到了 48px。

   ml-auto 把它顶到行尾。不额外补右边距：footer 只有 p-0.5，药丸右缘因此
   距侧栏边缘 2px，与 Settings 那颗按钮的左缘等距——**对齐的是两块可交互
   表面，不是两个字形**。而字形也恰好跟着对上：齿轮距左边缘 2+8=10px，
   图标在 32px 药丸里居中，距右边缘同样 10px。 */
const SHELL =
  "relative ml-auto flex h-6 w-8 shrink-0 items-center justify-center rounded-full outline-none transition-colors motion-reduce:transition-none";

const FOCUS =
  "touch-manipulation cursor-pointer hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar";

export function SidebarUpdateButton({
  onOpenAbout,
}: {
  onOpenAbout: () => void;
}) {
  const { t } = useAppTranslation();
  const update = useSyncExternalStore(
    updateStore.subscribe,
    updateStore.getSnapshot
  );
  useEffect(() => {
    updateStore.ensureLoaded();
  }, []);

  const view = describeSidebarUpdate(update);
  if (!view) return null;

  const label = t(view.labelKey, view.labelVars);

  /* ============================================================
   * 下载中不是按钮，于是也不摆按钮的身材：一条又宽又矮的进度轨，
   * 用的是 Settings › About 那条进度条的同一套词汇（foreground/10 轨 +
   * foreground 填充）。图标在这里没有信息量——形状已经说清了在下载什么
   * 阶段，而一枚挤在 6px 里的箭头只会两头都不像。
   * ============================================================ */
  if (view.percent !== null) {
    return (
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={view.percent}
        aria-label={label}
        title={label}
        className="ml-auto h-1.5 w-10 shrink-0 overflow-hidden rounded-full bg-foreground/10"
      >
        <span
          className="block h-full rounded-full bg-foreground transition-[width] motion-reduce:transition-none"
          style={{ width: `${view.percent}%` }}
        />
      </div>
    );
  }

  const Glyph = GLYPHS[view.glyph];
  const body = (
    <Glyph
      aria-hidden
      className={cn(
        "size-4",
        view.glyph === "spinner" && "motion-safe:animate-spin"
      )}
    />
  );

  /* 安装中同样不是按钮。role="img" 而非 status：live region 播报的是内容
     变化，而这里只有一个 aria-hidden 图标，挂上去是许一个不会兑现的诺言。
     真正的实时播报住在 Settings › About 那条 aria-live 文本里。 */
  if (!view.intent) {
    return (
      <div
        role="img"
        aria-label={label}
        title={label}
        className={cn(SHELL, TONES[view.tone])}
      >
        {body}
      </div>
    );
  }

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn(SHELL, FOCUS, TONES[view.tone])}
      onClick={() => {
        if (view.intent === "install") return void updateStore.downloadAndInstall();
        if (view.intent === "releases") return void openExternal(RELEASE_URL);
        onOpenAbout();
      }}
    >
      {body}
    </button>
  );
}
