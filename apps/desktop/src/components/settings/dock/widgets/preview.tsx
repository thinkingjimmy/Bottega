/**
 * [INPUT]: Depends on the shared Dock summary palette/interpreter, marked sample readings, fixed geometry, current size preferences and resolved appearance.
 * [OUTPUT]: Provides an exact-size three-edge sample preview with independent light/dark inspection for authoring and historical version review.
 * [POS]: Read-only host preview; it never runs author code or creates a data consumer.
 */
import {useEffect,useState,useSyncExternalStore} from 'react';
import {summaryDimensions,type DockSummarySize} from '@bottega/contracts/plugins/dock/geometry';
import type {DockContribution} from '@bottega/contracts/plugins/dock/manifest';
import {DockSummary} from '@/system-dock/common/widgets/summary';
import {sampleReadings} from '../../../../../shared/system-dock/widgets/preview/sample';
import {dockSettingsStore} from '@/lib/platform/system-dock-settings-client';
import {useAppTranslation} from '@/components/providers/preferences/i18n-provider';
import {effectiveLocale} from '@/lib/appearance/i18n-locale';
import {resolvedThemeStore,type ResolvedTheme} from '@/lib/appearance/theme';
import type {DockReading} from '@bottega/contracts/plugins/dock/data';
export function WidgetSummaryPreview({dock,edge,size,onEdge,onSize,readings,example=true,theme:controlledTheme,onTheme}:{dock:DockContribution;edge:'bottom'|'left'|'right';size:DockSummarySize;onEdge(value:'bottom'|'left'|'right'):void;onSize(value:DockSummarySize):void;readings?:Readonly<Record<string,DockReading>>;example?:boolean;theme?:ResolvedTheme;onTheme?(value:ResolvedTheme):void}){
 const {t}=useAppTranslation(),state=useSyncExternalStore(dockSettingsStore.subscribe,dockSettingsStore.getSnapshot),scale=state.snapshot?.state.scale??1;
 const [localTheme,setTheme]=useState<ResolvedTheme>(()=>resolvedThemeStore.getSnapshot()),theme=controlledTheme??localTheme;
 useEffect(()=>dockSettingsStore.load(),[]);
 const node=dock.summaries[size]?.[edge];if(!node)return null;const dimensions=summaryDimensions(size,edge);
 return <div className="mt-3 flex flex-wrap items-center gap-4">
  <div data-widget-preview="" data-widget-preview-theme={theme} aria-hidden="true" style={{width:dimensions.width*scale,height:dimensions.height*scale,flex:'none',overflow:'hidden',colorScheme:theme}}>
   <div style={{...dimensions,display:'flex',alignItems:'center',justifyContent:'center',padding:4,boxSizing:'border-box',overflow:'hidden',borderRadius:12,background:'light-dark(#f3f3f5, #26262a)',border:'1px solid light-dark(rgb(0 0 0 / 0.1), rgb(255 255 255 / 0.12))',transform:`scale(${scale})`,transformOrigin:'top left'}}><DockSummary node={node} readings={readings??sampleReadings(dock)} locale={effectiveLocale()} /></div>
  </div><div className="space-y-2"><p role="status" className="text-xs text-muted-foreground">{t(example?'systemDock.widgets.example':'systemDock.widgets.previewReal')}</p>
   <div role="group" aria-label={t('systemDock.placement.edge')} className="flex flex-wrap gap-1">{(['bottom','left','right']as const).map(value=><button type="button" key={value} aria-pressed={edge===value} onClick={()=>onEdge(value)} className="min-h-8 rounded border px-2 text-xs">{t(`systemDock.placement.${value}`)}</button>)}</div>
   <div role="group" aria-label={t('systemDock.widgets.previewTheme')} className="flex flex-wrap gap-1">{(['light','dark']as const).map(value=><button type="button" key={value} aria-pressed={theme===value} onClick={()=>onTheme?onTheme(value):setTheme(value)} className="min-h-8 rounded border px-2 text-xs">{t(value==='light'?'systemDock.widgets.previewLight':'systemDock.widgets.previewDark')}</button>)}</div>
   {dock.sizes.length>1&&<select aria-label={t('systemDock.settings.size')} value={size} onChange={event=>onSize(event.target.value as DockSummarySize)}>{dock.sizes.map(value=><option key={value} value={value}>{t(value==='small'?'systemDock.widgets.sizeSmall':value==='medium'?'systemDock.widgets.sizeMedium':'systemDock.widgets.sizeLarge')}</option>)}</select>}
  </div>
 </div>;
}
