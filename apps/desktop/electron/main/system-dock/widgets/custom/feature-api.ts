/**
 * [INPUT]: Depends only on Main composition/data/store types and fixed Widget command names.
 * [OUTPUT]: Provides the deferred Widget feature API and its trusted composition ports without importing implementation schemas.
 * [POS]: Light Main feature seam; ordinary Dock startup loads no authoring/application/data owner through this file.
 */
import type { SystemDockRuntimePorts } from '../../composition';
import type { DockService } from '../../service';
import type { DockConfigStore } from '../../store/config-store';
import type { DockLocalStore } from '../../store/local-store';
import type { PluginSurfaceIntegration } from '../../../plugins/surface-integration/service';
import type { DockTasksPort } from '../tasks';
import type { DockCustomWidgetsPort } from './ports';
import type { DockWidgetDetailPort } from '../detail/ports';
import type { WidgetRuntimeHealth } from '../../../../../shared/system-dock/widgets/native';
export const WIDGET_COMMANDS = ['widgetApiControl','widgetInstallReview','confirmWidgetInstall','widgetInstallOperation','retryWidgetInstall','cancelWidgetInstall','widgetLifecycleControl','widgetDeliveryControl','widgetPreviewControl', 'widgetBaseDirectory', 'revokeWidgetBaseAccess', 'widgetUpdateReview', 'widgetUpdateForm', 'stageWidgetUpdate', 'widgetSnapshot', 'newWidget', 'editWidget', 'forkWidget', 'buildWidget', 'widgetPreview', 'widgetVersions', 'previewWidgetVersion', 'applyWidget', 'widgetOperation', 'instancePreview', 'savedWidgetPreview', 'submitWidgetInstance', 'officialWidgetPreview', 'submitOfficialWidget', 'setWidgetPaused', 'removeWidgetInstance'] as const;
export type WidgetCommand = (typeof WIDGET_COMMANDS)[number];
export type DockWidgetFeaturePorts = {
  runtime: SystemDockRuntimePorts;
  service: DockService;
  config: DockConfigStore;
  local: DockLocalStore;
  integration: PluginSurfaceIntegration;
  tasks?: DockTasksPort;
  changed(): void;
};
export type DockWidgetFeature = {
  data: DockCustomWidgetsPort;
  detail: DockWidgetDetailPort;
  invoke(command: WidgetCommand, input: unknown, webContentsId?:number): unknown;
  health(): WidgetRuntimeHealth;
  reconcile(): void;
  close(): Promise<void>;
};
