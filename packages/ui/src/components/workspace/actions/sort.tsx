/**
 * [INPUT]: Project identities/order/activity and host-owned sort preference.
 * [OUTPUT]: ProjectsSortMode, sortWorkspaceProjects and ProjectSortMenu.
 * [POS]: Native/Web Project ordering and menu presentation, without persistence or transport.
 */
import { Check, MoreHorizontal } from "lucide-react";
import { SidebarGroupAction } from "../../ui/sidebar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../../ui/dropdown-menu";
import { usePointerOpenedMenu } from "../../../hooks/use-pointer-opened-menu";

export type ProjectsSortMode = "last-updated" | "manual";
export function sortWorkspaceProjects<T extends { id: string; sortIndex: number; updatedAt: number }>(
  projects: readonly T[], latest: ReadonlyMap<string, number>, mode: ProjectsSortMode, unavailable: (project: T) => boolean = () => false,
) {
  return [...projects].sort((left, right) => {
    if (unavailable(left) !== unavailable(right)) return unavailable(left) ? 1 : -1;
    if (mode === "manual") {
      if (left.sortIndex === Number.MAX_SAFE_INTEGER && right.sortIndex === Number.MAX_SAFE_INTEGER)
        return right.updatedAt - left.updatedAt || left.id.localeCompare(right.id);
      return left.sortIndex - right.sortIndex || left.id.localeCompare(right.id);
    }
    return (latest.get(right.id) ?? right.updatedAt) - (latest.get(left.id) ?? left.updatedAt) || left.id.localeCompare(right.id);
  });
}
export function ProjectSortMenu({ value, onValueChange, copy, className }: {
  value: ProjectsSortMode; onValueChange(mode: ProjectsSortMode): void;
  copy: { label: string; recent: string; manual: string }; className?: string;
}) {
  const menu = usePointerOpenedMenu();
  return <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <SidebarGroupAction {...menu.triggerProps} data-project-sort="" className={className} aria-label={copy.label}>
        <MoreHorizontal />
      </SidebarGroupAction>
    </DropdownMenuTrigger>
    <DropdownMenuContent side="right" align="start" className="w-40" onCloseAutoFocus={menu.onCloseAutoFocus}>
      {(["last-updated", "manual"] as const).map(mode => <DropdownMenuItem key={mode} onSelect={() => onValueChange(mode)}>
        <Check className={value === mode ? "opacity-100" : "opacity-0"} />{mode === "manual" ? copy.manual : copy.recent}
      </DropdownMenuItem>)}
    </DropdownMenuContent>
  </DropdownMenu>;
}
