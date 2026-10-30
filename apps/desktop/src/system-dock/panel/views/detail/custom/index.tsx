/**
 * [INPUT]: Depends on the privacy-safe host detail snapshot, panel intents, bounded reading tables and shared presentation policy.
 * [OUTPUT]: Provides standard custom Widget details with operation titles, localized fields, groups/history, explicit states, zones, refresh and current-instance configuration.
 * [POS]: Lazy host detail renderer; custom author scripts and data-owner capabilities never enter this view.
 */
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
 if(detail.surface&&!mask)return <><NativeWidgetSlot itemId={itemId} surface={detail.surface}/><footer className="panel-footer"><button type="button" className="text-button" onClick={()=>send({kind:'widget-entry',entry:{kind:'configure',itemId}})}><SlidersHorizontal aria-hidden="true"/>{t('systemDock.widgets.configure')}</button></footer></>;
 return <><div className="scroll" data-custom-widget-detail="">
  {mask?<p className="empty-state" role="status">{t('systemDock.item.masked')}</p>:<>
   {detail.face.updateAvailable&&<p role="status" className="note">{t('systemDock.widgets.install.oldKept')}</p>}
   {detail.face.state!=='ready'&&<p role="status" className="note">{t(readingStateKey(detail.face.state))}</p>}
   <WidgetDataCards data={detail.data} locale={snapshot.locale} t={t}/>
  </>}
  {detail.updatedAt!==null&&<p className="row-meta">{t('systemDock.panel.updated',{time:mask?MASK:relativeTime(detail.updatedAt,now)})}</p>}
 </div><footer className="panel-footer">
  <WidgetDetailActions key={itemId} itemId={itemId} actions={detail.actions}/>
  <button type="button" className="text-button" onClick={()=>send({kind:'widget-entry',entry:{kind:'configure',itemId}})}><SlidersHorizontal aria-hidden="true" />{t('systemDock.widgets.configure')}</button>
 </footer></>;
}
