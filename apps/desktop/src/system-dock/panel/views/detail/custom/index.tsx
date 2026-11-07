/**
 * [INPUT]: Depends on the loaded Dock catalog, pure Weather error keys, privacy-safe host detail snapshot, panel intents, bounded reading tables and shared presentation policy.
 * [OUTPUT]: Provides standard custom Widget details with operation titles, localized fields, groups/history, explicit states, zones, refresh current-instance configuration and retained-summary refresh failures; plugin-card fallback reuses the canonical Dock item unavailable label.
 * [POS]: Lazy host detail renderer; custom author scripts and data-owner capabilities never enter this view.
 */
import {weatherFailureKey} from '../../../../../../shared/system-dock/widgets/weather/errors';
import {PluginDockCard} from '../../../../common/widgets/plugin-card';
import {SlidersHorizontal} from 'lucide-react';
import {usePanel} from '../../../context';
import {relativeTime,MASK} from '../../../../common/format';
import {readingStateKey} from '../../../../common/widgets/readings';
import {NativeWidgetSlot} from './native';
import {WidgetDetailActions} from './actions';
import {WidgetDataCards} from '../../../../common/widgets/data';
export function CustomDetail({itemId}:{itemId:string}){
 const {snapshot,t,mask,now,send}=usePanel(),detail=snapshot.customWidget?.itemId===itemId?snapshot.customWidget:null;
 if(!detail)return <p className="empty-state" role="status">{t('systemDock.widgets.states.loading')}</p>;
 if(detail.face.plugin?.customCard&&!mask)return <>{detail.face.summaryError&&<p className="note" role="status" data-plugin-summary-error="">{t('systemDock.widgets.summaryRefreshFailed')}</p>}<div style={{flex:1,minHeight:0,margin:8,overflow:'hidden'}}><PluginDockCard key={`${itemId}/${detail.face.plugin.revision}`} itemId={itemId} plugin={detail.face.plugin} title={detail.name} unavailable={t("systemDock.item.unavailable")}/></div><footer className="panel-footer"><button type="button" className="text-button" onClick={()=>send({kind:'widget-entry',entry:{kind:'configure',itemId}})}><SlidersHorizontal aria-hidden="true"/>{t('systemDock.widgets.configure')}</button></footer></>;
 if(detail.surface&&!mask)return <><NativeWidgetSlot itemId={itemId} surface={detail.surface}/><footer className="panel-footer"><button type="button" className="text-button" onClick={()=>send({kind:'widget-entry',entry:{kind:'configure',itemId}})}><SlidersHorizontal aria-hidden="true"/>{t('systemDock.widgets.configure')}</button></footer></>;
 return <><div className="scroll" data-custom-widget-detail="">
  {mask?<p className="empty-state" role="status">{t('systemDock.item.masked')}</p>:<>
   {detail.face.updateAvailable&&<p role="status" className="note">{t('systemDock.widgets.install.oldKept')}</p>}
   {detail.face.summaryError&&<p role="status" className="note" data-plugin-summary-error="">{t('systemDock.widgets.summaryRefreshFailed')}</p>}
   {detail.face.summaryErrorCode&&<p role="status" className="note">{t(`systemDock.weather.${weatherFailureKey(detail.face.summaryErrorCode)}`)}</p>}
   {detail.face.state!=='ready'&&<p role="status" className="note">{t(readingStateKey(detail.face.state))}</p>}
   <WidgetDataCards data={detail.data} locale={snapshot.locale} t={t}/>
  </>}
  {detail.updatedAt!==null&&<p className="row-meta">{t('systemDock.panel.updated',{time:mask?MASK:relativeTime(detail.updatedAt,now)})}</p>}
 </div><footer className="panel-footer">
  {detail.face.plugin&&!mask&&<button type="button" className="text-button" disabled={detail.face.refreshing} onClick={()=>send({kind:'refresh-usage',itemId})}>{t('systemDock.weather.refresh')}</button>}
  <WidgetDetailActions key={itemId} itemId={itemId} actions={detail.actions}/>
  <button type="button" className="text-button" onClick={()=>send({kind:'widget-entry',entry:{kind:'configure',itemId}})}><SlidersHorizontal aria-hidden="true" />{t('systemDock.widgets.configure')}</button>
 </footer></>;
}
