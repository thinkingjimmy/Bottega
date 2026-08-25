/**
 * [INPUT]: Depends on React type and marquee style of the same name.css ((css introduced by main.tsx)
 * [OUTPUT]: Provides sidebar SubRowClass ((Project Folding Zone Geometry) ✓ SidebarRowMark ✓ First row width, and size sole arbiter ✓ SidebarRowTitle ✓ Sliding title ✓ SidebarRowTag ✓ End-to-end word tag ✓
 * [POS]: The components/sidebar side-bar shared vocabulary is consumed by chat/chat-thread-item, history/history-thread-item and project/project-item; The name of the game is "Cross", "Cross", "Cross", "Cross", "Cross", "Cross", "Cross", "Cross", "Cross", "Cross", "Cross", "Cross", "Cross", "Cross", "Cross", "Cross", "Cross", "Cross", "Cross", "Cross", "Cross", "Cross", "Cross", "Cross", "Cross", "Cross", "Cross", "Cross", "Cross", "Cross", "Cross", "Cross", "Cross", "Cross", "Cross", "Cross", "Cross", "Cross", "Cross", "Cross", "Cross", "Cross", "Cross", "Cross", "Cross", "Cross", "Cross", "Cross", "Cross", "Cross", "Cross", "Cross", "Cross", "Cross", "Cross", "Cross", " and "Cross" are all defined as "these" and "Cross" and "Cross" are defined by the following the following the following:
 */

/* ── 子行几何的单一真相源 ────────────────────────────────────────
 * Project 折叠区里的每一行——Base 首行与其下所有 chat——共用这一串：
 * `SIDEBAR_SUB_ROW_INDENT` 是它们同属一个父级的唯一视觉证词，任何一行私自
 * 缩进都会把层级说成两级。容器 `SidebarMenuSub` 已被 project-item 抹平
 * （mx-0/px-0/border-l-0/translate-x-0），故这一个数就是缩进的全部。
 * action 浮层不占横向空间：把基类为单按钮预留的 pr-8 收回到 pr-2，标题区铺满整行。
 *
 * h-8 是把 `SidebarMenuSubButton` 的 28px 抬回根级行的 32px。缩进已经把「我是
 * 子行」说完了，行高再说一遍就成了第二种说法——而两种说法必然有一种是多余的：
 * 同一个 ChatThreadItem 在 Chats 下与在 Project 下本该是同一件东西，不该因为
 * 宿主原语的默认值不同而长出两种密度。
 * ────────────────────────────────────────────────────────── */
/* 缩进的唯一旋钮。写成具名常量有两个用处：调它的人一眼找得到入口；回归
   断言钉的是「子行用的是共享缩进」而不是某个具体值——改数不该让测试变红。
   必须是 Tailwind 认得的字面量，拼接出来的类名编译期不存在、运行期静默失效。 */
export const SIDEBAR_SUB_ROW_INDENT = "pl-6";

export const sidebarSubRowClass =
  `h-8 w-full translate-x-0 pr-2 ${SIDEBAR_SUB_ROW_INDENT} font-normal! group-hover/menu-sub-item:bg-sidebar-accent group-hover/menu-sub-item:text-sidebar-accent-foreground group-has-[:focus-visible]/menu-sub-item:bg-sidebar-accent group-has-[:focus-visible]/menu-sub-item:text-sidebar-accent-foreground`;

/* ── 行首等宽槽：三种宿主，共用这一个 16px 方槽 ──────────────────
 * 槽不只是为了居中，更是为了把图标从宿主手里救回来：两个宿主原语各自替直系
 * svg 定过规矩，且形状不同——根级 `SidebarMenuButton` 写 `[&_svg]`（后代，只管
 * 尺寸），Project 子行 `SidebarMenuSubButton` 写 `[&>svg]`（直系，尺寸之外还
 * 强行改色）。同一枚转圈于是在 Chats 下是弱对比灰、在 Project 下被涂成 accent
 * 深色，问号与警告标更是连紫色琥珀色一起丢掉。隔这一层，`[&>svg]` 就够不着了。
 *
 * 尺寸则由槽自己裁决：`*:size-3.5!` 一条规则管住所有痕迹。它曾是每枚痕迹各带
 * 一份的 `size-3.5!`——六份写法维持出来的「等宽」只是巧合，改一处忘五处是迟早
 * 的事。挪到槽上之后，等宽不再是各家自觉遵守的约定，而是这一格的物理法则：
 * 住进来就是 14px，痕迹连拒绝的余地都没有，于是「忘了写」这种可能性本身消失了。
 * `!` 一次压过两样东西——宿主那条 `[&_svg]:size-4` 后代选择器，以及痕迹自带的
 * 默认尺寸（`Spinner` 内建 `size-4`），两条路一起堵上。
 * ────────────────────────────────────────────────────────── */
export function SidebarRowMark({ children }: { children: React.ReactNode }) {
  return (
    <span className="flex size-4 shrink-0 items-center justify-center *:size-3.5!">
      {children}
    </span>
  );
}

/* ── 行标题：截断从不发生，长标题在行活跃时自己滑过去 ──────────────
 * 几何与动效全在同名 .css，此处只保证 DOM 形状唯一——viewport 套 marquee，
 * 两层缺一则那边整条规则静默落空。
 * `actionStrip` 是这一行尾部浮层动作占掉的宽度：给了就覆盖 CSS 默认的 3rem，
 * 没有任何动作的行（外源历史）传 0rem，遮罩与位移随之退回「没有按钮」的样子。
 * ────────────────────────────────────────────────────────── */
export function SidebarRowTitle({
  actionStrip,
  children,
}: {
  actionStrip?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className="sidebar-row-title min-w-0 flex-1"
      /* 未给即 undefined，React 不落属性，默认值仍只有 CSS 里那一处 */
      style={{ "--sidebar-row-action-strip": actionStrip } as React.CSSProperties}
    >
      <span className="sidebar-row-title-marquee">{children}</span>
    </span>
  );
}

/* ── 行尾限定词：只回答「这一行是什么」，从不喊「你该做什么」 ──────
 * 因此用 sidebar token 的弱对比而非彩色——彩色是号召行动的语气，
 * 而「Base」与「编辑」都只是身份说明，抢注意力即是撒谎。
 * 底色走 foreground 的低透明叠加而非 sidebar-accent：后者正是行 hover 的底色，
 * 一 hover 标签就融进行里消失，那叫「只在你不看它时才存在」。
 * 弱对比顺带让深浅两套主题都成立——彩色字面值在暗色下必失明。
 * 门槛：图标已经说过的话，标签不必再说一遍（外源历史的来源由行首 logo 承担）。
 * ────────────────────────────────────────────────────────── */
export function SidebarRowTag({ children }: { children: React.ReactNode }) {
  return (
    <span className="shrink-0 rounded border border-sidebar-border bg-sidebar-foreground/6 px-1 py-0.5 text-[10px] text-sidebar-foreground/55 leading-none">
      {children}
    </span>
  );
}
