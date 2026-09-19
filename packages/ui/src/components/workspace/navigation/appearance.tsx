/**
 * [INPUT]: Portable Project appearance IDs and Lucide glyphs.
 * [OUTPUT]: Canonical Project colors, icons and expanded/collapsed appearance resolvers.
 * [POS]: Presentation identity shared by desktop settings and both workspace sidebars.
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
export type ProjectAppearance = { color: string; icon: string };

type ProjectColorEntry = {
  id: string;

  text: string;

  swatch: string;
};

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

type ProjectIconEntry = {
  id: string;
  Icon: LucideIcon;

  OpenIcon?: LucideIcon;
};

const DEFAULT_ICON: ProjectIconEntry = {
  id: "folder",
  Icon: Folder,
  OpenIcon: FolderOpen,
};

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

export const resolveProjectColor = (id: string | undefined) =>
  PROJECT_COLORS.find((entry) => entry.id === id) ?? DEFAULT_COLOR;

export const resolveProjectIcon = (id: string | undefined) =>
  PROJECT_ICONS.find((entry) => entry.id === id) ?? DEFAULT_ICON;

export const resolveProjectGlyph = (
  id: string | undefined,
  expanded: boolean,
): { Icon: LucideIcon } => {
  const entry = resolveProjectIcon(id);
  return { Icon: (expanded ? entry.OpenIcon : undefined) ?? entry.Icon };
};

export const normalizeProjectAppearance = (
  appearance: ProjectAppearance | undefined,
): ProjectAppearance => ({
  color: resolveProjectColor(appearance?.color).id,
  icon: resolveProjectIcon(appearance?.icon).id,
});
