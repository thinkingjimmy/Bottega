/**
 * [INPUT]: Depends on the exact unified plugin detail and index projections, workbench copy, Settings navigation requests, the shared AppDialog shell, the canonical UnifiedPluginDetail, shared Dock metrics and the actual DockWidgetFace.
 * [OUTPUT]: Provides WidgetPluginDetailsDialog, the Widget package's detail in place over the catalog, led by an actual-face preview of every size the Widget can take.
 * [POS]: Catalog leaf opened from a Widget card's More menu; it keeps the user on the Widgets page instead of navigating into Settings.
 */
import type { CSSProperties } from 'react';
import { DOCK_SUMMARY_SIZES } from '@bottega/contracts/plugins/dock/geometry';
import { Dialog, DialogDescription, DialogTitle } from '@ai-chat/ui/components/ui/dialog';
import { AppDialogBody, AppDialogContent } from '@ai-chat/ui/components/ui/app-dialog';
import { useWorkbenchCopy } from '@ai-chat/ui/lib/workbench-copy';
import { useAppTranslation } from '@/components/providers/preferences/i18n-provider';
import { SettingsSection } from '@/components/settings/settings-layout';
import { UnifiedPluginDetail } from '@/components/settings/plugins/platform/catalog';
import { usePluginDetail } from '@/lib/plugin-platform/projection/detail';
import { useUnifiedPluginIndex } from '@/lib/plugin-platform/projection/runtime';
import { pluginPlatformCopy } from '@/lib/plugin-platform/copy';
import { requestSettingsSection } from '@/lib/settings/navigation/settings-navigation';
import { DockWidgetFace } from '@/system-dock/common/faces';
import type { DockT } from '@/system-dock/common/format';
import type { DockBarItem } from '../../../../../../shared/system-dock/ipc';
import { DOCK_METRICS, itemExtent, metricItem } from '../../../../../../shared/system-dock/metrics';
import './styles.css';

const SIZE_LABELS = { small: 'systemDock.widgets.sizeSmall', medium: 'systemDock.widgets.sizeMedium', large: 'systemDock.widgets.sizeLarge' } as const;

/** Every form the Widget can take, drawn by the real Dock renderer at 1.25× on a strip slice. Custom cards stay on their summary so previews never open extra leases. */
function WidgetForms({ item, mask, now, t }: { item: DockBarItem; mask: boolean; now: number; t: DockT }) {
  const face = item.widget;
  if (!face) return null;
  const forms = face.type === 'custom'
    ? DOCK_SUMMARY_SIZES.map(size => ({ key: size, label: t(SIZE_LABELS[size]), face: { ...face, size } }))
    : [{ key: 'only', label: null, face }];
  return <SettingsSection title={t('systemDock.widgets.previewVersion')}>
    <div data-widget-forms="" className="widget-forms flex flex-wrap items-end gap-4">
      {forms.map(form => {
        const width = itemExtent(metricItem({ ...item, widget: form.face }), 'bottom');
        return <figure key={form.key} data-widget-form={form.key} className="m-0 flex flex-col items-center gap-2">
          <div aria-hidden="true" className="rounded-[18px] bg-muted/70" style={{ zoom: 1.25 } as CSSProperties}>
            <div inert style={{ width, height: DOCK_METRICS.barHeight }}>
              <DockWidgetFace itemId={`${item.id}:${form.key}`} face={form.face} edge="bottom" mask={mask} now={now} t={t} title={item.label} liveCard={false} />
            </div>
          </div>
          {form.label && <figcaption className="text-xs text-muted-foreground">{form.label}</figcaption>}
        </figure>;
      })}
    </div>
  </SettingsSection>;
}

export function WidgetPluginDetailsDialog({ pluginId, item, mask, now, onClose }: {
  pluginId: string; item?: DockBarItem; mask: boolean; now: number; onClose(): void;
}) {
  const { t, i18n } = useAppTranslation(), locale = i18n.language, workbench = useWorkbenchCopy(locale), copy = pluginPlatformCopy(locale);
  const detail = usePluginDetail(pluginId), index = useUnifiedPluginIndex(), plugin = detail.plugin;
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
    <AppDialogContent data-widget-plugin-details={pluginId} size="xl" showCloseButton>
      {/* The detail renders its own visible H1; the dialog name mirrors it for assistive technology. */}
      <DialogTitle className="sr-only">{plugin?.manifest.name ?? copy.details}</DialogTitle>
      <DialogDescription className="sr-only">{copy.details}</DialogDescription>
      {/* Vertical scrolling only: long hashes and paths wrap inside the dialog instead of widening it. */}
      <AppDialogBody data-widget-details-body="" className="@container overflow-x-hidden pt-6">
        {plugin
          ? <UnifiedPluginDetail mode="dialog" plugin={plugin} items={index.items} locale={locale} workbench={workbench} onRemoved={onClose}
              preview={item && <WidgetForms item={item} mask={mask} now={now} t={t as DockT} />}
              onOpen={id => { onClose(); requestSettingsSection({ section: 'plugins', plugin: id }); }} />
          : <p role="status" className="p-2 text-sm text-muted-foreground">{detail.error || copy.loading}</p>}
      </AppDialogBody>
    </AppDialogContent>
  </Dialog>;
}
