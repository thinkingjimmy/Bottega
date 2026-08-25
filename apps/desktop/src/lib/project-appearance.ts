/**
 * [INPUT]: Depends on 30 characters in lucide-react and ProjectAppearance in LucideIcon type, shared/projects-ipc
 * [OUTPUT]: Provides PROJECT_COLORS/PROJECT_ICONS Two directory tables ((includes only id and class name, and can be read as names for i18n projects.appearance.color|The following is a list of the most commonly used names for the name of the project:
 * [POS]: The only true source of Project looks in lib is rendered by the project-appearance-picker, and the project-item and Activity subtitle check tables are taken from the fontThe main process only keeps strings, the meaning is here
 */

import {
  Asterisk,
  Book,
  BookOpen,
  Braces,
  Brain,
  Briefcase,
  ChartColumn,
  CircleDollarSign,
  Dumbbell,
  Earth,
  FlaskConical,
  Flower,
  Folder,
  FolderOpen,
  Gem,
  Globe,
  GraduationCap,
  Heart,
  Music,
  NotebookText,
  Palette,
  PawPrint,
  Pencil,
  PencilRuler,
  PenTool,
  Plane,
  Popcorn,
  Scale,
  Sprout,
  SquareTerminal,
  Stethoscope,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import type { ProjectAppearance } from "../../shared/projects-ipc";

/* ── 为何是两张字面量表 ─────────────────────────────────────────
 * Tailwind v4 只认字面量类名：`text-${id}-600` 编译期不存在，运行期只是个
 * 没有规则的类名。所以色串必须硬写，不能拼。
 *
 * 字形取 -600 而非 -500：--sidebar 是 oklch(0.985)，amber/yellow 在 -500、
 * 16px、stroke-1.5 的条件下压不出对比。
 *
 * 色点却统一取 -500：真机上 orange-600 与 amber-600 两颗实心圆几乎分不开，
 * 而色点的职责是「让人一眼选中想要的那一档」，不是复刻字形的像素值。
 * 两处各自服务各自的判读任务，规则一致（点 -500 / 字 -600），不是逐档例外。
 *
 * dark: 半边当下未生效（应用未挂 .dark），但渲染端已有先例，
 * 写上零成本，主题一开就正确。
 * ────────────────────────────────────────────────────────── */

export type ProjectColorEntry = {
  id: string;
  /** 染 glyph 用 */
  text: string;
  /** 选择器里那颗圆点用 */
  swatch: string;
};

/** 默认档跟随 sidebar 前景色：浅色主题黑、深色主题白，与截图第一枚一致。 */
const DEFAULT_COLOR: ProjectColorEntry = {
  id: "default",
  text: "text-sidebar-foreground",
  swatch: "bg-sidebar-foreground/85",
};

export const PROJECT_COLORS: readonly ProjectColorEntry[] = [
  DEFAULT_COLOR,
  {
    id: "red",
    text: "text-red-600 dark:text-red-400",
    swatch: "bg-red-500 dark:bg-red-400",
  },
  {
    id: "orange",
    text: "text-orange-600 dark:text-orange-400",
    swatch: "bg-orange-500 dark:bg-orange-400",
  },
  {
    id: "amber",
    text: "text-amber-600 dark:text-amber-400",
    swatch: "bg-amber-500 dark:bg-amber-400",
  },
  {
    id: "green",
    text: "text-green-600 dark:text-green-400",
    swatch: "bg-green-500 dark:bg-green-400",
  },
  {
    id: "blue",
    text: "text-blue-600 dark:text-blue-400",
    swatch: "bg-blue-500 dark:bg-blue-400",
  },
  {
    id: "violet",
    text: "text-violet-600 dark:text-violet-400",
    swatch: "bg-violet-500 dark:bg-violet-400",
  },
  {
    id: "pink",
    text: "text-pink-600 dark:text-pink-400",
    swatch: "bg-pink-500 dark:bg-pink-400",
  },
];

export type ProjectIconEntry = {
  id: string;
  Icon: LucideIcon;
  /**
   * 开合态是目录项的一栏，不是 Folder 的 if 分支——没有这一栏的图标
   * 天然不随展开/折叠变化，「自定义图标要不要跟着开合」这个特殊情况就此消失。
   */
  OpenIcon?: LucideIcon;
};

const DEFAULT_ICON: ProjectIconEntry = {
  id: "folder",
  Icon: Folder,
  OpenIcon: FolderOpen,
};

/* 30 枚 = 选择器里的 6×5 网格；顺序即渲染顺序，不在组件里再排一次。 */
export const PROJECT_ICONS: readonly ProjectIconEntry[] = [
  DEFAULT_ICON,
  { id: "money", Icon: CircleDollarSign },
  { id: "book", Icon: Book, OpenIcon: BookOpen },
  { id: "study", Icon: GraduationCap },
  { id: "pencil", Icon: Pencil },
  { id: "pen", Icon: PenTool },
  { id: "code", Icon: Braces },
  { id: "terminal", Icon: SquareTerminal },
  { id: "music", Icon: Music },
  { id: "movie", Icon: Popcorn },
  { id: "craft", Icon: PencilRuler },
  { id: "art", Icon: Palette },
  { id: "health", Icon: Stethoscope },
  { id: "spark", Icon: Asterisk },
  { id: "flower", Icon: Flower },
  { id: "work", Icon: Briefcase },
  { id: "chart", Icon: ChartColumn },
  { id: "gem", Icon: Gem },
  { id: "fitness", Icon: Dumbbell },
  { id: "notes", Icon: NotebookText },
  { id: "legal", Icon: Scale },
  { id: "globe", Icon: Globe },
  { id: "travel", Icon: Plane },
  { id: "world", Icon: Earth },
  { id: "tools", Icon: Wrench },
  { id: "pet", Icon: PawPrint },
  { id: "science", Icon: FlaskConical },
  { id: "brain", Icon: Brain },
  { id: "heart", Icon: Heart },
  { id: "plant", Icon: Sprout },
];

export const DEFAULT_PROJECT_APPEARANCE: ProjectAppearance = {
  color: DEFAULT_COLOR.id,
  icon: DEFAULT_ICON.id,
};

/* ── 宽松解析 ──────────────────────────────────────────────────
 * 账本存的是任意字符串（见 shared/projects-ipc 的说明）。认不出就回落默认，
 * 于是「这个 id 还在不在表里」永远不是调用方要操心的事——没有 undefined 分支。
 * ────────────────────────────────────────────────────────── */

export const resolveProjectColor = (id: string | undefined) =>
  PROJECT_COLORS.find((entry) => entry.id === id) ?? DEFAULT_COLOR;

export const resolveProjectIcon = (id: string | undefined) =>
  PROJECT_ICONS.find((entry) => entry.id === id) ?? DEFAULT_ICON;

/**
 * 展开态只在目录项声明了 OpenIcon 时换字形，其余一律静态。
 *
 * 返回 `{ Icon }` 而非裸组件：调用方必须以成员表达式 `<glyph.Icon />` 渲染。
 * 大写局部变量会被 react-hooks/static-components 判为「渲染中新建组件」——
 * 它看不出这只是查表，而成员表达式恰好在它的认知之内。
 */
export const resolveProjectGlyph = (
  id: string | undefined,
  expanded: boolean
): { Icon: LucideIcon } => {
  const entry = resolveProjectIcon(id);
  return { Icon: (expanded ? entry.OpenIcon : undefined) ?? entry.Icon };
};

/** 把任意（含 undefined）外观折进目录表的 canonical id，供选择器当草稿初值。 */
export const normalizeProjectAppearance = (
  appearance: ProjectAppearance | undefined
): ProjectAppearance => ({
  color: resolveProjectColor(appearance?.color).id,
  icon: resolveProjectIcon(appearance?.icon).id,
});
