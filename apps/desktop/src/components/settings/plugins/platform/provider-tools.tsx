/**
 * [INPUT]: Main Provider catalog declarations and localized plugin capability copy.
 * [OUTPUT]: ProviderNativeTools distinguishes CLI-owned tools from Bottega plugin tools and unverified mode restrictions.
 * [POS]: Provider plugin detail; does not invent an enumerable native tool list or enforcement evidence.
 */
import { useProviderCatalog } from '@/lib/provider-catalog/hooks';
import { pluginPlatformCopy } from '@/lib/plugin-platform/copy';
import { SettingsBadge,SettingsList,SettingsRow,SettingsSection } from '@/components/settings/settings-layout';
export function ProviderNativeTools({providerId,locale}:{providerId:string;locale:string}){
  const catalog=useProviderCatalog(),provider=catalog.entries.find(item=>item.id===providerId),copy=pluginPlatformCopy(locale);
  if(!provider)return null;
  const rows=[['read-only',copy.readOnlyAccess],['tool-filter',copy.nativeToolFiltering],['resume',copy.sessionContinuation],['steer',copy.insertDuringTurn]] as const;
  return <SettingsSection title={copy.native} description={copy.nativeNote}><SettingsList>{rows.map(([capability,label])=><SettingsRow control={null} key={capability} label={label} description={capability==='read-only'||capability==='tool-filter'?copy.restrictionUnverified:undefined} badge={<SettingsBadge tone={provider.capabilities[capability]==='declared'?'neutral':'muted'}>{provider.capabilities[capability]==='declared'?copy.declaredByProvider:copy.unsupported}</SettingsBadge>}/>)}</SettingsList></SettingsSection>;
}
