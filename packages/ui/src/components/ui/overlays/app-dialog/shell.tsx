"use client";

/**
 * [INPUT]: Depends on shared Dialog/SlimScroller primitives, React context, and class merging
 * [OUTPUT]: Provides AppDialogContent (the one product dialog shell: 15% no-blur overlay, 1.35rem radius, 20px padding, size tiers md 520 / lg 680 / xl 960, sheetOnNarrow default on, close button default off, size published through AppDialogSizeContext) and AppDialogBody (the sole scroller and clipping box)
 * [POS]: packages/ui/src/components/ui/overlays/app-dialog; The shell layer of the product dialog spec (D1–D3, D6, D10–D11)
 */

import {
  createContext,
  useContext,
  type ComponentProps,
  type ReactNode,
} from "react";
import { DialogContent } from "@ai-chat/ui/components/ui/dialog";
import { SlimScroller } from "@ai-chat/ui/components/ui/slim-scroller";
import { cn } from "@ai-chat/ui/lib/utils";

export type AppDialogSize = "md" | "lg" | "xl";

const SIZE_CLASS: Record<AppDialogSize, string> = {
  md: "sm:max-w-[32.5rem]",
  lg: "sm:max-w-[42.5rem]",
  xl: "sm:max-w-[60rem]",
};

const AppDialogSizeContext = createContext<AppDialogSize>("md");

/** Size tier of the dialog this component renders inside; the footer reads it to default its band. */
export function useAppDialogSize(): AppDialogSize {
  return useContext(AppDialogSizeContext);
}

type AppDialogContentProps = ComponentProps<typeof DialogContent> & {
  /**
   * Width tier: md 520 (confirm, form, step, choice), lg 680 (lists, pickers,
   * catalogs, readme), xl 960 (preview, detail).
   */
  size?: AppDialogSize;
  /**
   * D6: exactly one visible exit. Defaults to false — a footer Cancel/Close is
   * the exit. Pass true only when the dialog has no footer exit (pickers that
   * commit on click, read-only previews, readme).
   */
  showCloseButton?: boolean;
  /**
   * D11: below sm the dialog docks to the bottom edge as a sheet. Defaults to
   * true; md confirmations pass false to stay centred.
   */
  sheetOnNarrow?: boolean;
};

/* ── 表面：只管形状，不管滚动 ──────────────────────────────────────
 * 一个盒子不能同时是「有形状的边界」和「能滚的窗口」：边界要求内容被
 * 圆角裁掉，窗口要求内容能溢出。让这个 1.35rem 圆角盒子自己滚，系统
 * 滚动条不吃 border-radius 裁剪，就会骑在弧线上，看着像挂在弹窗外面。
 * 故此处 overflow-hidden 焊死，滚动权交给 AppDialogBody。
 *
 * showCloseButton 默认 false（D6：恰好一个可见出口）。带页脚 Cancel/Close
 * 的弹窗不再重复挂 ×；只有无页脚出口的弹窗（点选即提交的 picker、预览、
 * readme）才声明打开它。
 * ───────────────────────────────────────────────────────────────── */
export function AppDialogContent({
  size = "md",
  showCloseButton = false,
  sheetOnNarrow = true,
  className,
  overlayClassName,
  children,
  ...props
}: AppDialogContentProps) {
  return (
    <DialogContent
      showCloseButton={showCloseButton}
      sheetOnNarrow={sheetOnNarrow}
      overlayClassName={cn(
        "!bg-black/15 !backdrop-blur-none",
        overlayClassName
      )}
      className={cn(
        // 上限留 5rem 而非 1rem：弹窗居中，等于上下各让开 40px——正好是顶部
        // 那条拖拽带兼红绿灯所在的高度。no-drag 已保证点得动，这一条管的是
        // 「别去盖窗口的标题栏」，两件事分别归位，不要用其中一个顶替另一个。
        // scrollbar-slim 挂在表面而非正文层：弹窗里常有嵌套滚动区，
        // 只管住 AppDialogBody 会在同一个弹窗里出现两种滚动条。
        "scrollbar-slim flex max-h-[calc(100vh-5rem)] w-[calc(100%-1rem)] flex-col gap-0 overflow-x-hidden overflow-y-hidden rounded-[1.35rem] border border-foreground/10 bg-popover p-5 text-popover-foreground shadow-2xl ring-0",
        SIZE_CLASS[size],
        className
      )}
      {...props}
    >
      <AppDialogSizeContext.Provider value={size}>
        {children as ReactNode}
      </AppDialogSizeContext.Provider>
    </DialogContent>
  );
}

/**
 * 弹窗正文：唯一的滚动主人。
 * flex-1 给它剩余高度，min-h-0 才让它真的可收缩——单写 min-h-0 只是「允许
 * 收缩」的许可，没有任何东西要求它收缩，内容一长照样把容器撑破。
 *
 * 它就是一个 SlimScroller，只是把弹窗里那份布局约定（吃满剩余高度）一并
 * 固化。滚动条的样式与显隐随之落在这一层而非表面：ref 若经 DialogContent
 * 转发进 Radix Content 就到不了 DOM（实测属性从未落上），而本层是自持的
 * div，ref 直达。位置上也不亏——正文层几乎撑满整个弹窗，「指针在弹窗里」
 * 与「指针在正文上」实际同义，嵌套滚动区本就住在它里面，capture 一并收得到。
 */
export function AppDialogBody({
  className,
  ...props
}: ComponentProps<"div">) {
  return (
    <SlimScroller
      data-slot="app-dialog-body"
      /* 这四个边距不是留白，是给子元素的描边留活路。
         ring/shadow 画在 border box 之外，而 overflow-y-auto 会连带把
         overflow-x 也变成 auto——这一层于是成了裁剪盒。正文子元素天然与它
         左右齐平（本层无横向内边距），那几列像素正好落在裁剪边界外面被吃掉：
         卡片只剩上下两条横线，输入框的焦点环缺左右两段。
         负外边距把自己向外撑开，内边距再把内容推回原位——子元素一像素没动，
         而裁剪盒多出了一圈刚好够描边站的地方。

         两个轴的余量不同，因为代价不同：
         横向 4px = 这套设计里画得最远的焦点指示器（ring-2 + ring-offset-2，
         SettingsSwitch 就是），而横向不滚动，这圈余量不产生任何副作用；
         纵向只给 1px = 够细线活命即可。纵向是滚动轴，余量给多了，滚动的
         内容会越过裁剪线渗进标题与页脚的缝里——那比一条被裁的阴影更难看。

         修在裁剪盒这一层，而不是逐个给子元素补 ring-inset：后者要求每个
         调用方都记得，而漏掉的地方永远比记得的地方多。 */
      className={cn("-mx-1 -my-px min-h-0 flex-1 overflow-y-auto px-1 py-px", className)}
      {...props}
    />
  );
}
