/**
 * [INPUT]: One existing Widget instance, actual Dock preview, localized lifecycle actions and shared focus-aware menus.
 * [OUTPUT]: WidgetInstanceCard with native preview, hover/keyboard controls and retained recovery/source operations.
 * [POS]: Catalog presentation leaf; callbacks retain their existing Main-owned mutation semantics.
 */
import { useRef, type ReactNode } from 'react';
import { Copy, History, MoreHorizontal, Pause, Play, SlidersHorizontal, SquarePen, Trash2, Download } from 'lucide-react';
import { Button } from '@ai-chat/ui/components/ui/button';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from '@ai-chat/ui/components/ui/dropdown-menu';
import { usePointerOpenedMenu } from '@ai-chat/ui/hooks/use-pointer-opened-menu';
import { useAppTranslation } from '@/components/providers/preferences/i18n-provider';
import type { WidgetManagementSnapshot } from '../../../../../../shared/system-dock/widgets/authoring';
type Instance = WidgetManagementSnapshot['instances'][number];
export function WidgetInstanceCard({ instance, definitionName, busy, preview, children, wide, bundled, onConfigure, onInstall, onEdit, onCopy, onVersions, onChange }: {
  instance: Instance; definitionName: string; busy: boolean; preview: ReactNode; children?: ReactNode; wide: boolean; bundled: boolean;
  onConfigure(button: HTMLButtonElement): void; onInstall(button: HTMLButtonElement): void;
  onEdit(): void; onCopy(): void; onVersions(): void; onChange(remove: boolean): void;
}) {
  const { t } = useAppTranslation(), menu = usePointerOpenedMenu(), configure = useRef<HTMLButtonElement>(null);
  const needsInstall = ['needs-install', 'install', 'update', 'preparing', 'repair'].includes(instance.installation ?? '');
  const needsSource = instance.installation === 'source-review';
  const canVersion = Boolean(instance.officialWidget && instance.installation!=='needs-install') || instance.customizable !== false && !instance.definitionId.startsWith('builtin.');
  const installLabel = instance.installation === 'needs-install' ? bundled ? 'systemDock.widgets.install.repair' : 'systemDock.widgets.directory.install'
    : instance.installation === 'repair' ? 'systemDock.widgets.install.repair'
    : instance.installation === 'preparing' ? 'common.retry'
    : instance.installation === 'update' ? 'systemDock.widgets.install.reviewUpdate' : 'systemDock.widgets.install.confirm';
  const canPause = !instance.pluginId && instance.mappingRevision !== undefined;
  const hasOtherActions = needsSource || needsInstall || canVersion || canPause;
  return <article data-widget-instance={instance.id} data-wide={wide || undefined} className="widget-catalog-card">
    {preview}
    <div className="widget-catalog-actions">
      <Button ref={configure} data-widget-configure="" className="widget-catalog-action" variant="secondary" size="icon" disabled={busy || needsInstall || needsSource || instance.installation==='disabled'} aria-label={`${t('systemDock.widgets.configure')}: ${instance.name}`} title={t('systemDock.widgets.configure')} onClick={event => onConfigure(event.currentTarget)}><SlidersHorizontal /></Button>
      <DropdownMenu><DropdownMenuTrigger asChild><Button {...menu.triggerProps} data-widget-more="" className="widget-catalog-action" variant="secondary" size="icon" aria-label={`${t('systemDock.widgets.catalog.more')}: ${instance.name}`} title={t('systemDock.widgets.catalog.more')}><MoreHorizontal /></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-max min-w-48" onCloseAutoFocus={menu.onCloseAutoFocus}>
          {needsSource && <DropdownMenuItem disabled={busy} onSelect={onEdit}><SquarePen />{t('systemDock.widgets.install.reviewSource')}</DropdownMenuItem>}
          {needsInstall && <DropdownMenuItem disabled={busy} onSelect={() => { if (configure.current) onInstall(configure.current); }}><Download />{t(installLabel)}</DropdownMenuItem>}
          {canVersion && <DropdownMenuItem disabled={busy} onSelect={onVersions}><History />{t('systemDock.widgets.versions')}</DropdownMenuItem>}
          {instance.customizable !== false && instance.pluginId && instance.contributionId && <DropdownMenuItem disabled={busy || !!instance.copyTarget} onSelect={onCopy}><Copy />{t('systemDock.widgets.copyCustomize')}</DropdownMenuItem>}
          {canPause && <DropdownMenuItem disabled={busy} onSelect={() => onChange(false)}>{instance.paused ? <Play /> : <Pause />}{t(instance.paused ? 'systemDock.widgets.resume' : 'systemDock.widgets.pause')}</DropdownMenuItem>}
          {hasOtherActions&&<DropdownMenuSeparator />}<DropdownMenuItem variant="destructive" disabled={busy} onSelect={() => onChange(true)}><Trash2 />{t('systemDock.widgets.remove')}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
    <div className="widget-catalog-caption"><h3 title={instance.name}>{instance.name}</h3><p>{definitionName}{instance.paused || instance.installation==='disabled' ? ` · ${t('systemDock.widgets.states.paused')}` : ''}</p></div>
    {(needsInstall || needsSource) && <Button data-widget-install="" variant="outline" size="sm" disabled={busy} className="mt-2" onClick={event => needsSource ? onEdit() : onInstall(event.currentTarget)}>{t(needsSource ? 'systemDock.widgets.install.reviewSource' : installLabel)}</Button>}
    {children}
  </article>;
}
