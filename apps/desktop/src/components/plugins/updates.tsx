/**
 * [INPUT]: Complete bounded summary status/revision changes and shared toast navigation.
 * [OUTPUT]: Lightweight confirmed update notices with affected instance counts and failure repair actions.
 * [POS]: Persistent main-window feedback; initial catalog loading never announces an update.
 */
import { useEffect,useRef } from 'react';
import { toast } from '@ai-chat/ui/components/ui/sonner';
import { useAppTranslation } from '@/components/providers/preferences/i18n-provider';
import { useUnifiedPluginIndex } from '@/lib/plugin-platform/projection/runtime';
import { pluginPlatformCopy } from '@/lib/plugin-platform/copy';
import { requestSettingsSection } from '@/lib/settings/navigation/settings-navigation';
export function PluginUpdateNotices(){
  const {items,page}=useUnifiedPluginIndex(),{i18n}=useAppTranslation(),previous=useRef(new Map<string,{revision?:string;status:string;error?:string}>()),loaded=useRef(false);
  useEffect(()=>{if(!page)return;const copy=pluginPlatformCopy(i18n.language);
    for(const item of items){const prior=previous.current.get(item.manifest.id),action={label:copy.details,onClick:()=>requestSettingsSection({section:'plugins',plugin:item.manifest.id})};
      if(loaded.current&&prior&&item.runtimeReady&&item.activeRevision&&prior.revision!==item.activeRevision)toast.success(`${item.manifest.name} · ${copy.updated}`,{description:`${item.instanceCount} ${copy.instances}`,action});
      if(loaded.current&&prior&&((item.error&&prior.error!==item.error)||prior.status!==item.status&&['failed','cleanup-failed'].includes(item.status)))toast.error(item.manifest.name,{description:item.error??copy.pageUnavailable,action});
      previous.current.set(item.manifest.id,{revision:item.activeRevision,status:item.status,error:item.error});
    }loaded.current=true;
  },[items,page,i18n.language]);
  return null;
}
