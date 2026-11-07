/**
 * [INPUT]: Canonical Chat Project ownership, the complete source summary index and exact volatile detail projection and native Settings navigation.
 * [OUTPUT]: PluginSourceStatus shows shared build/error state and exact cancellable source-writer queue feedback.
 * [POS]: Shared source-Project notice; no author Chat, manual Widget build/apply operation or eager source allocation remains.
 */
import { useChats } from '@/components/providers/chats-provider';
import { useAppTranslation } from '@/components/providers/preferences/i18n-provider';
import { Button } from '@ai-chat/ui/components/ui/button';
import {useUnifiedPluginIndex} from '@/lib/plugin-platform/projection/runtime';
import {usePluginDetail} from '@/lib/plugin-platform/projection/detail';
import { pluginPlatformCopy,pluginStatusLabel } from '@/lib/plugin-platform/copy';
import { requestSettingsSection } from '@/lib/settings/navigation/settings-navigation';
export function PluginSourceStatus({chatId}:{chatId:string}){
  const {chats}=useChats(),{items}=useUnifiedPluginIndex(),{i18n}=useAppTranslation(),copy=pluginPlatformCopy(i18n.language),projectId=chats.find(chat=>chat.id===chatId)?.projectId;
  const source=projectId?items.find(plugin=>plugin.sourceProject?.projectId===projectId):undefined;
  const detail=usePluginDetail(source?.manifest.id),plugin=detail.plugin??source,error=detail.error||plugin?.error;
  if(!plugin)return null;
  return <div data-plugin-source-status={plugin.manifest.id} className="flex shrink-0 items-start gap-3 border-b px-4 py-2 text-xs"><div className="min-w-0 flex-1"><p className="font-medium">{plugin.manifest.name}<span className="ml-2 font-normal text-muted-foreground">{pluginStatusLabel(error?'failed':plugin.status,i18n.language)}</span></p>{detail.plugin?.authoringWaiters?.includes(chatId)&&<p role="status" data-plugin-source-waiting="" className="mt-1 text-muted-foreground">{i18n.language.startsWith('zh')?'正在等待另一个 Chat 完成插件编辑。点击停止可取消等待。':'Waiting for another Chat to finish editing this plugin. Use Stop to cancel.'}</p>}{error&&<p role="alert" className="mt-1 line-clamp-3 break-words text-destructive">{error}</p>}</div><Button type="button" size="sm" variant="ghost" onClick={()=>requestSettingsSection({section:'plugins',plugin:plugin.manifest.id})}>{copy.details}</Button></div>;
}
