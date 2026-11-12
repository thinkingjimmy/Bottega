/**
 * [INPUT]: The current Dock panel projection, permitted card slots, privacy state and host action intents.
 * [OUTPUT]: Isolated detail with host-summary fallback, configuration, package recovery and Usage controls.
 * [POS]: The detail frame receives the same official entry as the Dock card with the detail view context.
 */
import { weatherFailureKey } from '../../../../../../shared/system-dock/widgets/weather/errors';
import type { UsageQueryTarget } from '../../../../../../shared/ipc/settings/usage-ipc';
import { PluginDockCard } from '../../../../common/widgets/plugin-card';
import { ActivityFace } from '../../../../common/faces';
import { ArrowUpRight, SlidersHorizontal } from 'lucide-react';
import { usePanel } from '../../../context';
import { relativeTime } from '../../../../common/format';
import { readingStateKey } from '../../../../common/widgets/readings';
import { NativeWidgetSlot } from './native';
import { WidgetDetailActions } from './actions';
import { WidgetDataCards } from '../../../../common/widgets/data';

export function CustomDetail({ itemId }: { itemId: string }) {
  const { snapshot, t, mask, now, send } = usePanel();
  const detail = snapshot.customWidget?.itemId === itemId ? snapshot.customWidget : null;
  if (!detail) return <p className="empty-state" role="status">{t('systemDock.widgets.states.loading')}</p>;
  const { face } = detail;
  const missing = face.officialWidget && face.state === 'needs-install';
  const usage = face.officialWidget === 'bottega-ai-usage';
  const source = face.plugin?.configuration.source as UsageQueryTarget | undefined;
  const fallback = <div className="scroll" data-custom-widget-detail="">
    {mask ? <p className="empty-state" role="status">{t('systemDock.item.masked')}</p> : <>
      {face.updateAvailable && <p role="status" className="note">{t('systemDock.widgets.install.oldKept')}</p>}
      {face.summaryErrorCode && <p role="status" className="note">{t(`systemDock.weather.${weatherFailureKey(face.summaryErrorCode)}`)}</p>}
      {face.state !== 'ready' && <p role="status" className="note">{t(readingStateKey(face.state))}</p>}
      {face.activity && <ActivityFace face={face.activity} t={t} mask={false} />}
      <WidgetDataCards data={detail.data} locale={snapshot.locale} t={t} />
    </>}
    {detail.updatedAt !== null && !mask && <p className="row-meta">{t('systemDock.panel.updated', { time: relativeTime(detail.updatedAt, now) })}</p>}
  </div>;
  const edge = snapshot.edge ?? 'bottom';
  return <>
    {face.summaryError && !mask && <p className="note" role="status" data-plugin-summary-error="">{t('systemDock.widgets.summaryRefreshFailed')}</p>}
    {face.plugin?.customCard && !mask && snapshot.liveCards?.includes(itemId) ?
      <div style={{ flex: 1, minHeight: 0, margin: 8, overflow: 'hidden' }}>
        <PluginDockCard itemId={itemId} plugin={face.plugin} title={detail.name} unavailable={t('systemDock.item.unavailable')} fallback={face.officialWidget ? fallback : undefined}
          presentation={face.officialWidget ? { view: 'detail', size: face.size, edge, locale: snapshot.locale } : undefined} />
      </div>
      : detail.surface && !mask ? <NativeWidgetSlot itemId={itemId} surface={detail.surface} /> : fallback}
    <footer className="panel-footer">
      {missing ? <button type="button" className="text-button" onClick={() => send({ kind: 'widget-entry', entry: { kind: 'install', itemId } })}>{t('systemDock.widgets.directory.install')}</button> : <>
        {face.plugin && !mask && <button type="button" className="text-button" disabled={face.refreshing}
          onClick={() => send({ kind: 'refresh-usage', itemId })}>{t(usage ? 'systemDock.panel.refresh' : 'systemDock.weather.refresh')}</button>}
        {usage && face.plugin && !mask && <button type="button" className="text-button"
          onClick={() => send({ kind: 'open-full-usage', backend: !source || source === 'all' ? null : source })}>
          <ArrowUpRight aria-hidden="true" />{t('systemDock.panel.openUsage')}
        </button>}
        <WidgetDetailActions key={itemId} itemId={itemId} actions={detail.actions} />
        {face.state !== 'paused' && <button type="button" className="text-button" onClick={() => send({ kind: 'widget-entry', entry: { kind: 'configure', itemId } })}>
          <SlidersHorizontal aria-hidden="true" />{t('systemDock.widgets.configure')}
        </button>}
      </>}
    </footer>
  </>;
}
