/**
 * [INPUT]: Complete ready page contributions, canonical App and Dock classification, and shared Sidebar primitives.
 * [OUTPUT]: PluginNavigationRows for declared Sidebar destinations of ordinary plugins.
 * [POS]: Main Sidebar page Slot. PinnedApps owns App rows, and the Widget catalog and Settings own Dock management.
 */
import { Link, useLocation } from 'react-router';
import { PanelsTopLeft } from 'lucide-react';
import { SidebarMenuButton, SidebarMenuItem } from '@ai-chat/ui/components/ui/sidebar';
import { useRuntimePlugins } from '@/lib/plugin-platform/projection/runtime';
import { isHostedAppPlugin, isNativeDockPlugin } from '@/lib/plugin-platform/client';

export function PluginNavigationRows() {
  const { items } = useRuntimePlugins();
  const location = useLocation();
  const rows = items
    .filter(plugin =>
      plugin.runtimeReady &&
      plugin.installation.enabled &&
      !isHostedAppPlugin(plugin) &&
      !isNativeDockPlugin(plugin)
    )
    .flatMap(({ manifest }) => {
      const pages = manifest.contributions
        .flatMap(item => item.kind === 'page' && item.navigation
          ? [{ id: item.id, navigation: item.navigation }]
          : [])
        .sort((a, b) => (a.navigation.order ?? 0) - (b.navigation.order ?? 0));

      return pages.map(({ id, navigation }) => {
        const route = `/plugins/${encodeURIComponent(manifest.id)}/${encodeURIComponent(id)}`;
        return (
          <SidebarMenuItem key={`${manifest.id}/${id}`} data-plugin-navigation={manifest.id}>
            <SidebarMenuButton asChild isActive={location.pathname === route}>
              <Link to={route}>
                <PanelsTopLeft className="size-4" />
                <span className="truncate">{navigation.label}</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        );
      });
    });
  return <>{rows}</>;
}
