/**
 * [INPUT]: Depends on ReactNode, I18n, ui/button/sidebar, cn, lib/platform The platform is based on react-router Link
 * [OUTPUT]: Provides PageShell with uniform 32px back/column chrome, title/titleAdornment, an optional centre zone, an optional rail row under the header, plus panelChromeClassName and crossHeaderPanelStyle
 * [POS]: Page outline of the rounded workspace and the alignment benchmark for one-line headers; the header lays out as flex, or as an equal-gutter tri-zone grid once `center` is present; the divider is drawn once, at the bottom edge of the header block (the rail takes it over when present); the collapsed-sidebar left inset forks by platform (mac clears the traffic lights plus the floating trigger, Windows only the trigger)
 */

import { Link } from "react-router";
import { ArrowLeft } from "lucide-react";
import { Button } from "@ai-chat/ui/components/ui/button";
import { useSidebar } from "@ai-chat/ui/components/ui/sidebar";
import { cn } from "@ai-chat/ui/lib/utils";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { isApplePlatform } from "@/lib/platform";

/* ── 栏控按钮 ────────────────────────────────────────────────────────
 * 窗口顶部那条 40px 横带上，开合与新建整栏的按钮属于同一族：
 * 左上角 SidebarTrigger、页头右侧第三栏 toggle、第三栏自己的 +/×。
 * 它们同处一条基线，尺寸一旦各写各的，肉眼立刻看得出台阶。
 *
 * 几何交给 size="icon-lg"（32px 命中区 + 16px 图标），不写进常量——
 * 档位是 Button 的词汇表，常量只补词汇表说不出的两件事：
 * 更轻的描边，以及取消按压位移（这条横带是 app-region:drag，
 * 按下去位移会和窗口拖拽抢同一个手势的手感）。
 * ─────────────────────────────────────────────────────────────────── */
export const panelChromeClassName =
  "[&>svg]:[stroke-width:1.5] active:translate-y-0!";

// ─── 跨页头第三栏几何 ───────────────────────────────────────────────
// 第三栏是页面的平级邻居，不是内容区的房客：向上吃掉整条页头，
// 让自己的头部与页头共用同一条基线。少了这两行，右栏只能缩在页头
// 之下，于是「与主体并列」被读成「嵌在主体里」——层级的错觉全在这里。
// 代价是页头右端被盖住，故 actions 只放开合按钮（面板自带关闭接任它），
// 必须常驻的操作走 titleAdornment 留在左侧。
export const crossHeaderPanelStyle = {
  height: "calc(100% + var(--page-shell-header-height))",
  marginTop: "calc(0px - var(--page-shell-header-height))",
} satisfies React.CSSProperties;

/* 标题可缺席：空会话那种页面没有可写的名字，此时页头连同分隔线一起
   退成一条纯拖拽带——一条横线下面写着「新任务」，说的正是这一页已经
   说过的话。分隔线因此不是独立开关，它只是「有标题」的影子。

   rail 是页头块的第二层（页签条那种整幅横带）。它一来，分隔线就跟着
   走到块的最下沿——页头自己那条随即撤掉：两条平行线中间夹着 40px 空白，
   说的是同一件事「页头到此为止」，说两遍就成了噪声。
   规则因此只有一条：线永远画在页头块的最下沿，谁在最下沿谁画。
   这也是不给布尔开关的原因——开关能被单独拨错，插槽不能。 */
type PageShellProps = {
  title?: React.ReactNode;
  icon?: React.ReactNode; // 标题前的装饰图标
  titleAdornment?: React.ReactNode; // 标题后的操作或状态；跨页头第三栏盖不到，常驻操作放这里
  backHref?: string; // 有值则在标题前渲染返回按钮
  center?: React.ReactNode; // 页头正中那一格（视图切换那类）；给了它，页头即改用三分栏
  rail?: React.ReactNode; // 页头下方那条整幅横带（页签条）；有它则分界线归它
  actions?: React.ReactNode; // 页头右侧操作区；开着跨页头第三栏时会被盖住
  children: React.ReactNode;
};

export function PageShell({
  title,
  icon,
  titleAdornment,
  backHref,
  center,
  rail,
  actions,
  children,
}: PageShellProps) {
  const { t } = useAppTranslation();
  const { state } = useSidebar();

  return (
    <div className="flex h-full flex-col [--page-shell-header-height:2.5rem]">
      <header
        className={cn(
          "relative h-[var(--page-shell-header-height)] shrink-0 items-center gap-2 px-4 [-webkit-app-region:drag]",
          /* ── 居中不是「摆在中间」，是「两侧等宽」 ──────────────────────
             ml-auto 推出来的中间会随标题长短漂移；absolute 定住的中间不漂，
             但长标题会从它底下穿过去——两种都不是居中。只有 1fr auto 1fr
             同时给出真正的居中与左栏的截断边界。
             没有 center 的页面继续走 flex：三分栏会把截断点提前到半幅，而
             那些页面的标题本可以一直长到 actions 跟前。分岔只有一处，且它
             就是 center 这个词的定义，不是补丁。 */
          center ? "grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]" : "flex",
          title && !rail && "border-b",
          /* 折叠后浮动折叠钮落在内容区左上角：mac 要同时让开红绿灯故 8.5rem，
             Windows 无红绿灯只需让开钮本身（left-3 + 32px），pl-12 足矣。 */
          state === "collapsed" &&
            (isApplePlatform() ? "pl-[8.5rem]" : "pl-12")
        )}
      >
        {state === "collapsed" && (
          <>
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 left-0 w-28 [-webkit-app-region:no-drag]"
            />
            <span
              aria-hidden="true"
              className="absolute top-1/2 left-[7.5rem] h-5 w-px -translate-y-1/2 bg-border"
            />
          </>
        )}
        {/* 返回与标题合成一格：三分栏下它们必须同属左栏，否则各占一列，
            中栏就被挤到第三格去了。flex 下这层嵌套与原先的并列等价。 */}
        <div className="flex min-w-0 items-center gap-2">
          {backHref && (
            <Button
              size="icon-lg"
              variant="ghost"
              aria-label={t("common.back")}
              className={cn("[-webkit-app-region:no-drag]", panelChromeClassName)}
              asChild
            >
              <Link to={backHref}>
                <ArrowLeft />
              </Link>
            </Button>
          )}
          {title && (
            <div className="flex min-w-0 items-center gap-2">
              {icon && (
                <span
                  aria-hidden="true"
                  className="flex shrink-0 items-center justify-center [&>svg]:size-4"
                >
                  {icon}
                </span>
              )}
              <h1 className="truncate font-medium text-sm">{title}</h1>
              {titleAdornment && (
                <span className="flex shrink-0 items-center [-webkit-app-region:no-drag]">
                  {titleAdornment}
                </span>
              )}
            </div>
          )}
        </div>
        {center && (
          <div className="flex shrink-0 items-center gap-1 [-webkit-app-region:no-drag]">
            {center}
          </div>
        )}
        <div className="ml-auto flex items-center justify-end gap-2 [-webkit-app-region:no-drag]">
          {actions}
        </div>
      </header>
      {rail && <div className="shrink-0 border-b">{rail}</div>}
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}
