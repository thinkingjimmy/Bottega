/**
 * [INPUT]: Depends on initialized Dock stores, lock/privacy state, deferred source/package custody, exact data owners and trusted Main-only Widget commands.
 * [OUTPUT]: Provides recovered journals, account directory/terminal deletion, local uninstall/repair, custom readings, temporary previews, isolated details and bounded host management with the same configuration admission used by instance forms and original-package reuse for saved additions.
 * [POS]: On-demand Widget composition; the ordinary Dock loads only feature-api types and a deferred lifetime.
 */
import {WidgetAccountDirectory} from '../lifecycle/directory';
import {WidgetDefinitionLifecycle} from '../lifecycle/owner';
import {DockWidgetRetention} from './retention';
import {WidgetInstallations} from '../install/owner';
import type {CustomDockWidget} from '../../../../../shared/system-dock/widgets/instance';
import {widgetLifecycleControlSchema} from '../../../../../shared/system-dock/widgets/install/lifecycle';
import {widgetInstallReviewQuerySchema,widgetInstallConfirmSchema,widgetInstallOperationSchema,widgetDeliveryControlSchema} from '../../../../../shared/system-dock/widgets/install/commands';
import type {WidgetDeliveryView} from '../../../../../shared/system-dock/widgets/install/types';
import {WidgetDeliveryQueue} from '../../../cloud/widgets/queue';
import { powerMonitor,nativeTheme } from 'electron';
import { backendRuntimeRegistry } from '../../../backends';
import { builtinProviderCatalog, knownBackend } from '../../../../../shared/providers/catalog';
import { newDockWidgetSchema, editDockWidgetSchema, applyDockWidgetSchema, widgetOperationQuerySchema, forkDockWidgetSchema, previewWidgetVersionSchema } from '../../../../../shared/system-dock/widgets/authoring';
import { savedWidgetQuerySchema,widgetInstanceQuerySchema, widgetInstancePauseSchema, widgetInstanceRemoveSchema, widgetBaseRevokeSchema } from '../../../../../shared/system-dock/widgets/management';
import { officialWidgetQuerySchema, submitOfficialWidgetSchema } from '../../../../../shared/system-dock/widgets/official';
import { widgetUpdateReviewQuerySchema, widgetUpdateFormQuerySchema, stageWidgetUpdateSchema } from '../../../../../shared/system-dock/widgets/review';
import { widgetBaseDirectoryRequestSchema } from '../../../../../shared/system-dock/widgets/base/access';
import { defaultDockSettings } from '@bottega/contracts/plugins/dock/settings';
import { canonicalJson } from '@bottega/contracts/core/canonical-json';
import { translate } from '../../../../../shared/i18n/runtime';
import { DockWidgetApplications } from '../../store/custom/applications';
import { DockWidgetInstances } from '../../store/custom/instances';
import { entryLabel } from '../../projection';
import { officialDockContribution } from '../../../plugins/authoring/dock/templates';
import { createDockWidgetDetail } from '../detail/lazy';
import type { DockWidgetDetailPort } from '../detail/ports';
import { createDockBaseData } from '../base/lazy';
import { DockWidgetActions } from '../actions/owner';
import { createWidgetActionTargets } from '../actions/targets';
import { widgetDetailKey } from '../detail/scope';
import {createDockWidgetPreviews} from '../preview/create';
import {DockApiData} from '../api/owner';
import {WidgetApiConnections} from './api';
import type {WidgetApiHooks} from '../../store/custom/model';
import { DockCustomWidgets } from './runtime';
import type { DockWidgetFeature, DockWidgetFeaturePorts, WidgetCommand } from './feature-api';
export async function createDockWidgetFeature(input: DockWidgetFeaturePorts, current: () => boolean): Promise<DockWidgetFeature> {
  const { runtime: ports, service, config, local, integration, tasks } = input, check = () => { if (!current())
    throw new Error('DOCK_WIDGET_FEATURE_CLOSED'); };
  check();
  const { authoring, packages } = await integration.loadDock();
  check();
  const disposers = new Map<string, () => void | Promise<void>>(), native: {
    owner?: DockWidgetDetailPort;
  } = {}, actions: {
    owner?: DockWidgetActions;
  } = {};
  const close = async () => { actions.owner?.close(); const errors: unknown[] = []; for (const name of ['cleanup-registration','directory','definitions','retention','installation','delivery', 'preview', 'detail', 'base', 'data', 'api', 'api-lock', 'instances', 'applications'])
    try {
      await disposers.get(name)?.();
    }
    catch (error) {
      errors.push(error);
    } if (errors.length)
    throw new AggregateError(errors, 'DOCK_WIDGET_CLEANUP_FAILED'); };
  try {
    let apiLocked=powerMonitor.getSystemIdleState(1)==='locked';
    const api=new DockApiData({userData:ports.userData,active:()=>!apiLocked&&!local.get().privacyMask,scope:()=>integration.dockScope(),source:id=>data.source(id),changed:()=>{service.schedule();native.owner?.reconcile();}});
    disposers.set('api',()=>api.close());
    const apiHooks:WidgetApiHooks={draftOwnerId:(preview,targetId)=>connections.draftOwnerId(preview,targetId),prepare:plan=>connections.prepare(plan),commit:plan=>connections.commit(plan),retire:(mapping,keep)=>connections.retire(mapping,keep),ack:(scope,id,items)=>connections.ack(scope,id,items),authorized:(scope,dock,target)=>connections.authorized(scope,dock,target)};
    const base = ports.bases ? createDockBaseData({ bases: ports.bases, source: id => data.source(id), changed: () => { service.schedule(); native.owner?.reconcile(); } }) : undefined;
    if (base)
      disposers.set('base', () => base.close());
    const applications:DockWidgetApplications = new DockWidgetApplications({ userData: ports.userData, config, runtime: integration.runtime, authoring, packages, scope: () => integration.dockScope(), locale: ports.locale, changed: input.changed,canApply:(id):boolean=>!installations.blocked({definitionId:id,sourceInstallationId:integration.dockScope().installationId}), api:apiHooks,validateData: (dock, widget) => data.validate(dock, widget) });
    disposers.set('applications', () => applications.close());
    const data: DockCustomWidgets = new DockCustomWidgets({ scope: () => integration.dockScope(), locale: ports.locale, masked: () => local.get().privacyMask||apiLocked,
      item: id => { const item = config.layout().items.find(item => item.id === id); return item?.kind === 'widget' ? item : null; }, availability:item=>{if(item.widget.type!=='custom')return'definition-missing';const widget=item.widget;if(directory.preparing(widget.definition,widget.definition.packageRef))return'package-preparing';if(installations.progress()?.reference===widget.definition.packageRef)return'installing';return installations.confirmed(widget)||widget.definition.sourceInstallationId===integration.dockScope().installationId?'needs-setup':'needs-installation';},accepted: item => item.widget.type==='custom'&&installations.blocked(item.widget)?null:applications.accepted(item), packages, limits: ports.limits, history: ports.history, tasks, base,api,
      account: id => { const backend = knownBackend(builtinProviderCatalog, id); return backend ? backendRuntimeRegistry.accountFingerprint(backend) : null; }, onAccounts: listener => backendRuntimeRegistry.subscribe(() => listener()),
      presentation: source => native.owner!.presentation(source), actions: id => actions.owner?.list('host', id) ?? [], invokeAction: (id, ref) => actions.owner!.invoke('host', id, ref), pruneActions: () => actions.owner?.prune(), changed: () => { service.schedule(); native.owner?.reconcile(); } });
    disposers.set('data', () => data.close());
    const configurable=(widget:CustomDockWidget)=>!installations.blocked(widget)&&(installations.confirmed(widget)||widget.definition.sourceInstallationId===integration.dockScope().installationId&&Boolean(packages.descriptor(widget.definition.packageRef))&&(!installations.wasUninstalled(widget)||applications.hasAcceptedPackage(widget.definition.packageRef))&&integration.runtime.descriptor(widget.definition.definitionId)?.activeGenerationId===widget.definition.generationId);
    const instances = new DockWidgetInstances({ userData: ports.userData, config, applications, packages, scope: () => integration.dockScope(), locale: ports.locale, changed: input.changed, validate: (dock, widget) => data.validate(dock, widget),
      officialDirectory: () => ({ agents: ports.limits?.snapshot().agents ?? [], configurable: service.usage.configurable(), sources: ports.history?.sources() ?? [] }), officialName: type => entryLabel(ports.locale(), type === 'builtin.tasks' ? 'tasks' : type === 'builtin.ai-limits' ? 'limits' : 'activity'),
      configurable,api:apiHooks,
      stillSaved: widget => installations.confirmed(widget)||widget.definition.sourceInstallationId === integration.dockScope().installationId && integration.runtime.descriptor(widget.definition.definitionId)?.activeGenerationId === widget.definition.generationId && !applications.pendingDefinition(widget.definition.definitionId),
      saved: async (id,sourceInstallationId) => {
        if(sourceInstallationId&&sourceInstallationId!==integration.dockScope().installationId)return installations.savedDefinition({definitionId:id,sourceInstallationId});
        if (!authoring.definitions().some(value => value.id === id) || applications.pendingDefinition(id))
          throw new Error('DOCK_WIDGET_NOT_AVAILABLE');
        const record = integration.runtime.descriptor(id), generation = record?.generations.find(value => value.generationId === record.activeGenerationId && value.available);
        if (!generation || !('dock' in generation.manifest))
          throw new Error('DOCK_WIDGET_NOT_AVAILABLE');
        const frozen = packages.retainedGeneration(id, generation.generationId);
        await packages.read(frozen.reference);
        return { name: generation.manifest.name, dock: generation.manifest.dock, widget: { type: 'custom', configVersion: 1, definition: { sourceInstallationId: integration.dockScope().installationId, definitionId: id, generationId: generation.generationId, packageRef: frozen.reference, contractDigest: frozen.descriptor.contractDigest }, size: generation.manifest.dock.sizes[0]!, settings: defaultDockSettings(generation.manifest.dock.settings), bindings: [] } };
      } });
    disposers.set('instances', () => instances.close());
    const connections=new WidgetApiConnections({broker:api,packages,applications,instances,scope:()=>integration.dockScope(),source:id=>data.source(id),changed:()=>{data.reconcile();service.schedule();native.owner?.reconcile();}});
    const lockApi=()=>{apiLocked=true;data.reconcile();native.owner?.reconcile();service.schedule();},unlockApi=()=>{apiLocked=false;data.reconcile();service.schedule();};
    powerMonitor.on('lock-screen',lockApi);powerMonitor.on('suspend',lockApi);powerMonitor.on('unlock-screen',unlockApi);powerMonitor.on('resume',unlockApi);
    disposers.set('api-lock',()=>{powerMonitor.removeListener('lock-screen',lockApi);powerMonitor.removeListener('suspend',lockApi);powerMonitor.removeListener('unlock-screen',unlockApi);powerMonitor.removeListener('resume',unlockApi);});
    actions.owner = new DockWidgetActions({ changed: () => service.schedule(), current: id => { const source = data.source(id); return service.panelTargetItem() === id && source ? widgetDetailKey(source) : null; }, targets: createWidgetActionTargets({ source: id => data.source(id), bases: ports.bases, tasks, refresh: id => data.refresh(id), navigate: async (command, live) => { await ports.send(command, live); service.closePanel(false); }, label: (key, values) => translate(ports.locale(), key, values) }) });
    const detail = createDockWidgetDetail({ mainDirectory: ports.mainDirectory, gateway: integration.gateway, packages, source: id => data.source(id), read: (id, sources) => data.read(id, sources),
      actions: (owner, id) => actions.owner!.list(owner, id), invokeAction: (owner, id, ref, live) => actions.owner!.invoke(owner, id, ref, live), releaseActions: owner => actions.owner!.release(owner), locale: ports.locale, theme: () => nativeTheme.shouldUseDarkColors ? 'dark' : 'light',
      changed: () => service.schedule(), closePanel: () => service.closePanel(false), focusPanel: () => service.panel.focus(), label: key => translate(ports.locale(), key) });
    native.owner = detail;
    disposers.set('detail', () => detail.close());
    const previews=createDockWidgetPreviews({applications,packages,api,runtime:{...ports,tasks},gateway:integration.gateway,scope:()=>integration.dockScope(),masked:()=>local.get().privacyMask,
      account:id=>{const backend=knownBackend(builtinProviderCatalog,id);return backend?backendRuntimeRegistry.accountFingerprint(backend):null;},onAccounts:listener=>backendRuntimeRegistry.subscribe(()=>listener()),label:key=>translate(ports.locale(),key)});
    disposers.set('preview',()=>previews.close());
    const installations:WidgetInstallations=new WidgetInstallations({userData:ports.userData,config,packages,applications,scope:()=>integration.dockScope(),cloud:()=>integration.remote.widgets(),validate:(dock,widget)=>data.validate(dock,widget),changed:input.changed,revoked:subject=>definitions.blocked(subject)});
    disposers.set('installation',()=>installations.close());
    const delivery=new WidgetDeliveryQueue(packages,{cloud:()=>integration.remote.widgets(),changed:input.changed});disposers.set('delivery',()=>delivery.close());
    const definitions:WidgetDefinitionLifecycle=new WidgetDefinitionLifecycle({userData:ports.userData,scope:()=>integration.dockScope(),cloud:()=>integration.remote.widgets(),changed:input.changed,
      name:subject=>authoring.definitions().find(value=>value.id===subject.definitionId&&subject.sourceInstallationId===integration.dockScope().installationId)?.name??installations.installedDefinitions().find(value=>value.definitionId===subject.definitionId&&value.sourceInstallationId===subject.sourceInstallationId)?.name??translate(ports.locale(),'systemDock.widgets.untitled'),
      impact:subject=>{const items=config.layout().items.filter(item=>item.kind==='widget'&&item.widget.type==='custom'&&item.widget.definition.definitionId===subject.definitionId&&item.widget.definition.sourceInstallationId===subject.sourceInstallationId);return{instances:items.map(item=>({id:item.id,name:item.kind==='widget'?item.label??'':''})),identity:items.map(item=>({item,revision:item.kind==='widget'?applications.accepted(item)?.revision??null:null}))};},
      retireLocal:async(subject,operationId,scope)=>{
        const live=()=>{if(canonicalJson(integration.dockScope())!==canonicalJson(scope))throw new Error('WIDGET_DEFINITION_SCOPE_CHANGED');};live();delivery.cancelDefinition(subject);await api.retireDefinition(scope,subject.definitionId);live();
        if(subject.sourceInstallationId===scope.installationId){applications.invalidateDefinitionPreviews(subject.definitionId);previews.reconcile();await applications.retirePendingDefinition(subject.definitionId);live();}
        data.reconcile();detail.reconcile();await installations.retireDefinition(subject,operationId);live();await packages.retireDefinition(subject);live();
        await config.edit(layout=>{live();const removed=new Set(layout.items.filter(item=>item.kind==='widget'&&item.widget.type==='custom'&&item.widget.definition.definitionId===subject.definitionId&&item.widget.definition.sourceInstallationId===subject.sourceInstallationId).map(item=>item.id));return{...layout,items:layout.items.filter(item=>!removed.has(item.id)),order:layout.order.filter(id=>!removed.has(id))};});live();data.reconcile();detail.reconcile();
      }});disposers.set('definitions',()=>definitions.close());
    const directory=new WidgetAccountDirectory({scope:()=>integration.dockScope(),cloud:()=>integration.remote.widgets(),revoked:entry=>definitions.receive(entry),connected:()=>definitions.reconnect(),changed:input.changed});disposers.set('directory',()=>directory.close());
    const handlers: Record<WidgetCommand, (value: unknown,webContentsId?:number) => unknown> = {
      widgetApiControl:value=>connections.control(value),
      widgetInstallReview:value=>installations.review(widgetInstallReviewQuerySchema.parse(value).itemId),
      confirmWidgetInstall:value=>installations.confirm(widgetInstallConfirmSchema.parse(value)),
      widgetInstallOperation:value=>installations.operation(widgetInstallOperationSchema.parse(value).operationId),
      retryWidgetInstall:value=>installations.retry(widgetInstallOperationSchema.parse(value).operationId),
      cancelWidgetInstall:value=>installations.cancel(widgetInstallOperationSchema.parse(value).operationId),
      widgetLifecycleControl:value=>{const request=widgetLifecycleControlSchema.parse(value);switch(request.kind){
        case 'definition-install-review':return installations.reviewDefinition({definitionId:request.definitionId,sourceInstallationId:request.sourceInstallationId},request.reference).then(review=>({kind:'install-review',review}));
        case 'definition-edit':{const cached=installations.installedDefinitions().find(value=>value.definitionId===request.definitionId&&value.sourceInstallationId===request.sourceInstallationId)?.sourceChatId;return{kind:'source-edit',target:cached?{chatId:cached,sourceInstallationId:request.sourceInstallationId}:directory.edit(request)};}
        case 'definition-review':return{kind:'definition-review',review:definitions.review({definitionId:request.definitionId,sourceInstallationId:request.sourceInstallationId})};
        case 'definition-confirm':return definitions.confirm(request).then(result=>({kind:'definition-result',result}));
        case 'definition-operation':return{kind:'definition-result',result:definitions.operation(request.operationId)};
        case 'definition-retry':return definitions.retry(request.operationId).then(result=>({kind:'definition-result',result}));
        case 'uninstall-review':return{kind:'uninstall-review',review:installations.uninstallReview({definitionId:request.definitionId,sourceInstallationId:request.sourceInstallationId})};
        case 'uninstall-confirm':return installations.confirmUninstall(request).then(result=>({kind:'uninstall-result',result}));
        case 'uninstall-operation':return{kind:'uninstall-result',result:installations.uninstallOperation(request.operationId)};
        case 'uninstall-retry':return installations.retryUninstall(request.operationId).then(result=>({kind:'uninstall-result',result}));
      }},
      widgetDeliveryControl:async value=>{const request=widgetDeliveryControlSchema.parse(value);if(request.action==='retry')await delivery.retry(request.reference);else await delivery.abandon(request.reference);},
      widgetPreviewControl:(value,webContentsId)=>{if(webContentsId===undefined)throw new Error('DOCK_PREVIEW_WINDOW_UNAVAILABLE');return previews.command(webContentsId,value);},
      widgetBaseDirectory: value => { if (!base)
        throw new Error('DOCK_BASE_UNAVAILABLE'); return base.directory(widgetBaseDirectoryRequestSchema.parse(value)); },
      revokeWidgetBaseAccess: value => instances.revokeBase(widgetBaseRevokeSchema.parse(value)),
      widgetUpdateReview: value => applications.updateReview(widgetUpdateReviewQuerySchema.parse(value).previewId),
      widgetUpdateForm: value => { const request = widgetUpdateFormQuerySchema.parse(value); return applications.updateForm(request.previewId, request.itemId); },
      stageWidgetUpdate: value => applications.stageUpdate(stageWidgetUpdateSchema.parse(value)),
      widgetSnapshot: () => {
        const labels = new Map(service.allItems().map(item => [item.id, item.label])), rows = config.layout().items.flatMap(item => { if (item.kind !== 'widget')
          return []; const mapping = item.widget.type === 'custom' ? applications.accepted(item) : null; return [{ id: item.id, definitionId: item.widget.type === 'custom' ? item.widget.definition.definitionId : item.widget.type, name: labels.get(item.id) ?? item.label ?? '', ...(item.widget.type==='custom'?{sourceInstallationId:item.widget.definition.sourceInstallationId,installation:mapping&&!installations.blocked(item.widget)&&canonicalJson(mapping.widget)===canonicalJson(item.widget)&&packages.available(item.widget.definition.packageRef)?'ready' as const:installations.requiresRepair(item.widget)?'repair' as const:configurable(item.widget)?'needs-setup' as const:directory.preparing(item.widget.definition,item.widget.definition.packageRef)?'preparing' as const:item.widget.definition.sourceInstallationId===integration.dockScope().installationId?'source-review' as const:mapping?'update' as const:'install' as const}:{}), ...(mapping ? { paused: mapping.paused, mappingRevision: mapping.revision } : {}) }]; });
        const deliveries:WidgetDeliveryView[]=packages.deliveryRecords().filter(entry=>entry.delivery!=='discarded').map(entry=>({definitionId:entry.descriptor.source.definitionId,reference:entry.reference,generationId:entry.descriptor.source.generationId,state:delivery.activeReference()===entry.reference?'transferring':entry.error?'failed':entry.delivery==='delivered'?'ready':entry.delivery==='prepared'?'preparing':entry.delivery==='pending'?'pending':'abandoned'}));
        return {accountDefinitions:directory.definitions().filter(value=>!definitions.blocked(value)),retirements:definitions.pending(),installedDefinitions:installations.installedDefinitions().filter(value=>!definitions.blocked(value)),deliveries,installationProgress:installations.progress(),layoutRevision: config.snapshot().localRevision, instances: rows, definitions: authoring.definitions().filter(value=>!definitions.blocked({definitionId:value.id,sourceInstallationId:integration.dockScope().installationId})).map(definition => ({ ...definition,sourceInstallationId:integration.dockScope().installationId, instanceCount: rows.filter(instance => instance.definitionId === definition.id&&instance.sourceInstallationId===integration.dockScope().installationId).length })) };
      },
      newWidget: value => authoring.create(newDockWidgetSchema.parse(value), ports.locale()), editWidget: value => authoring.edit(editDockWidgetSchema.parse(value).definitionId),
      forkWidget: value => {
        const request = forkDockWidgetSchema.parse(value);
        return authoring.createFork(request, ports.locale(), async () => {
          const target = config.layout().items.find(item => item.id === request.itemId);
          if (target?.kind !== 'widget')
            throw new Error('DOCK_WIDGET_NOT_FOUND');
          const widget = target.widget, instanceName = service.allItems().find(item => item.id === target.id)?.label ?? target.label ?? '';
          const name = widget.type === 'custom' ? authoring.definitions().find(definition => definition.id === widget.definition.definitionId)?.name ?? instanceName : entryLabel(ports.locale(), widget.type === 'builtin.tasks' ? 'tasks' : widget.type === 'builtin.ai-limits' ? 'limits' : 'activity');
          const nameKey = widget.type === 'custom' ? 'systemDock.widgets.copyName' : 'systemDock.widgets.customName', marker = '__widget_name__', pattern = translate(ports.locale(), nameKey, { name: marker }), remaining = 80 - [...pattern.replace(marker, '')].length, forkName = translate(ports.locale(), nameKey, { name: [...name].slice(0, Math.max(1, remaining)).join('') });
          if (target.widget.type === 'custom') {
            const accepted = applications.accepted(target);
            if (!accepted || canonicalJson(accepted.widget) !== canonicalJson(target.widget))
              throw new Error('DOCK_INSTANCE_CONFLICT');
            await packages.read(target.widget.definition.packageRef);
            return { name: forkName, seed: { target, instanceName, source: { kind: 'package' as const, reference: target.widget.definition.packageRef } } };
          }
          return { name: forkName, seed: { target, instanceName, source: { kind: 'official' as const, revision: 1 as const, dock: officialDockContribution(target.widget, (key, values) => translate(ports.locale(), key, values)) } } };
        });
      },
      buildWidget: value => applications.build(editDockWidgetSchema.parse(value).definitionId), widgetPreview: value => applications.preview(editDockWidgetSchema.parse(value).definitionId), widgetVersions: value => applications.versions(editDockWidgetSchema.parse(value).definitionId),
      previewWidgetVersion: value => { const request = previewWidgetVersionSchema.parse(value); return applications.previewVersion(request.definitionId, request.generationId); },
      applyWidget: async (value) => { const receipt = await applications.apply(applyDockWidgetSchema.parse(value)); if (receipt.itemIds[0])
        service.highlight(receipt.itemIds[0]); service.schedule(); return receipt; },
      widgetOperation: value => applications.operation(widgetOperationQuerySchema.parse(value).operationId), instancePreview: value => instances.preview(widgetInstanceQuerySchema.parse(value).itemId), savedWidgetPreview: value => {const request=savedWidgetQuerySchema.parse(value);return instances.previewSaved(request.definitionId,request.sourceInstallationId);},
      submitWidgetInstance: async (value) => { const receipt = await instances.submit(applyDockWidgetSchema.parse(value)); if (receipt.status === 'applied')
        service.highlight(receipt.itemId); return receipt; },
      officialWidgetPreview: value => instances.previewOfficial(officialWidgetQuerySchema.parse(value)), submitOfficialWidget: async (value) => { const receipt = await instances.submitOfficial(submitOfficialWidgetSchema.parse(value)); if (receipt.status === 'applied')
        service.highlight(receipt.itemId); return receipt; },
      setWidgetPaused: value => instances.pause(widgetInstancePauseSchema.parse(value)), removeWidgetInstance: value => instances.remove(widgetInstanceRemoveSchema.parse(value)),
    };
    const initializeOwners=async()=>{await api.initialize();check();await definitions.initialize();check();await applications.initialize();check();await instances.initialize();check();await installations.initialize();check();};
    const cleanup=integration.widgetCleanup();if(cleanup)disposers.set('cleanup-registration',await cleanup.initialize({api:accountId=>api.clearAccount(accountId),definitions:accountId=>definitions.clearAccount(accountId),applications:accountId=>applications.clearAccount(accountId),instances:accountId=>instances.clearAccount(accountId),installations:accountId=>installations.clearAccount(accountId)},initializeOwners));else await initializeOwners();
    await applications.recover();
    check();
    await instances.recover();
    check();
    await applications.reconcileLayout();
    check();
    const retention=new DockWidgetRetention(packages,applications,()=>[...applications.retainedReferences(),...instances.retainedReferences(),...installations.retainedReferences(),...authoring.retainedReferences()]);disposers.set('retention',()=>retention.close());retention.reconcile();
    directory.reconcile();definitions.wake();delivery.wake();void installations.recover().catch(error=>console.warn('[widgets] installation recovery failed',error));
    return { data, detail, invoke: (command, value,webContentsId) => { check(); return handlers[command](value,webContentsId); }, health: () => ({ ...detail.health(), base: base?.health() ?? { consumers: 0, flights: 0, timers: 0 },api:api.health(),preview:previews.health() }), reconcile: () => {directory.reconcile();definitions.wake();retention.reconcile();delivery.wake();if(current())void installations.recover().catch(error=>console.warn('[widgets] installation recovery failed',error));previews.reconcile();data.reconcile(); detail.reconcile(); if(current())void applications.reconcileLayout().catch(error=>console.warn('[system-dock] Widget acceptance retirement failed',error)); }, close };
  }
  catch (error) {
    try {
      await close();
    }
    catch (cleanup) {
      throw new AggregateError([error, cleanup], 'DOCK_WIDGET_INITIALIZATION_FAILED');
    }
    throw error;
  }
}
