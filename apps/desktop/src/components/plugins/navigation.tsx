/**
 * [INPUT]: Complete all-pages ready page contributions and shared Sidebar primitives.
 * [OUTPUT]: PluginNavigationRows for declared page navigation, separate from source Projects.
 * [POS]: Main Sidebar page Slot; disable/update facts immediately remove stale entries.
 */
import { Link,useLocation } from 'react-router';
import { PanelsTopLeft } from 'lucide-react';
import { SidebarMenuButton,SidebarMenuItem } from '@ai-chat/ui/components/ui/sidebar';
import { useRuntimePlugins } from '@/lib/plugin-platform/projection/runtime';
export function PluginNavigationRows(){
  const {items}=useRuntimePlugins(),location=useLocation();
  return <>{items.filter(plugin=>plugin.runtimeReady&&plugin.installation.enabled).flatMap(plugin=>plugin.manifest.contributions.filter(item=>item.kind==='page'&&item.navigation).sort((a,b)=>a.kind==='page'&&b.kind==='page'?(a.navigation?.order??0)-(b.navigation?.order??0):0).map(item=>{
    if(item.kind!=='page')return null;const route=`/plugins/${encodeURIComponent(plugin.manifest.id)}/${encodeURIComponent(item.id)}`;
    return <SidebarMenuItem key={`${plugin.manifest.id}/${item.id}`} data-plugin-navigation={plugin.manifest.id}><SidebarMenuButton asChild isActive={location.pathname===route}><Link to={route}><PanelsTopLeft className="size-4"/><span className="truncate">{item.navigation!.label}</span></Link></SidebarMenuButton></SidebarMenuItem>;
  }))}</>;
}
