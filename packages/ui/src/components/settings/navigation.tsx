/**
 * [INPUT]: Localized groups, selected destination and host-owned navigation callbacks.
 * [OUTPUT]: SettingsNavigation, the shared settings sidebar and return action.
 * [POS]: Settings presentation; each host supplies its available destinations.
 */
import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import {
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "../ui/sidebar";

export type SettingsNavigationGroup = {
  label: string;
  items: readonly {
    id: string;
    label: string;
    icon: ReactNode;
    badge?: ReactNode;
    onSelect(): void;
  }[];
};

export function SettingsNavigation({
  backLabel,
  onBack,
  active,
  groups,
}: {
  backLabel: string;
  onBack(): void;
  active: string;
  groups: readonly SettingsNavigationGroup[];
}) {
  return (
    <>
      <SidebarHeader className="p-0.5 max-md:pt-[max(0.125rem,env(safe-area-inset-top))]">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              autoFocus
              className="cursor-pointer"
              onClick={onBack}
            >
              <ArrowLeft aria-hidden />
              <span>{backLabel}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent className="gap-4 max-md:pb-[max(0.125rem,env(safe-area-inset-bottom))]">
        {groups
          .filter((group) => group.items.length > 0)
          .map((group) => (
            <SidebarGroup key={group.label} className="px-0.5 py-0.25">
              <SidebarGroupLabel className="font-normal">
                {group.label}
              </SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {group.items.map((item) => (
                    <SidebarMenuItem key={item.id}>
                      <SidebarMenuButton
                        className="cursor-pointer"
                        isActive={active === item.id}
                        aria-current={active === item.id ? "page" : undefined}
                        onClick={item.onSelect}
                      >
                        {item.icon}
                        <span>{item.label}</span>
                        {item.badge}
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          ))}
      </SidebarContent>
    </>
  );
}
