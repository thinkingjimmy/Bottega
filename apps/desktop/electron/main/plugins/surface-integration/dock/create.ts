/**
 * [INPUT]: Depends on Library/source ports, immutable package custody and the shared authored runtime.
 * [OUTPUT]: Provides DockSourceOwner and createDockSourceOwner with guarded initialization and complete ordered cleanup.
 * [POS]: Deferred plugin integration branch; source/package owners are absent until the Widget feature needs them.
 */
import type {WidgetScopeCleanup} from '../../../cloud/widgets/cleanup/owner';
import { DockAuthoringService } from '../../authoring/dock/service';
import { WidgetPackageStore } from '../../surface-runtime/packages/store';
import type { PluginSurfaceRuntime } from '../../surface-runtime/service';
import type { ProjectsService } from '../../../projects/projects-service';
import type { ChatStore } from '../../../chats/chat-store';
import type { SourceChatInput } from '../../../chats/lifecycle/source/create';
type Ports = {
  widgetCleanup?:WidgetScopeCleanup;
  userData: string;
  libraryId(): string | null;
  accountId(): string;
  deviceId: string;
  projects: ProjectsService;
  chats: ChatStore;
  runtime: PluginSurfaceRuntime;
  createSourceChat?(input: SourceChatInput): Promise<unknown>;
  restoreSourceChat?(input: {
    chatId: string;
    incarnationId: string;
    projectId: string;
  }, current: () => boolean): Promise<void>;
};
export type DockSourceOwner = {
  authoring: DockAuthoringService;
  packages: WidgetPackageStore;
  close(): Promise<void>;
};
export async function createDockSourceOwner(ports: Ports, current: () => boolean): Promise<DockSourceOwner> {
  const check = () => { if (!current())
    throw new Error('DOCK_AUTHORING_CLOSED'); };
  check();
  const packages = new WidgetPackageStore(ports.userData, ports.runtime, () => ({ accountId: ports.accountId(), installationId: ports.deviceId }));
  const authoring = new DockAuthoringService({ ...ports, createChat: ports.createSourceChat, restoreChat: ports.restoreSourceChat, readPackage: reference => packages.read(reference) });
  let detachCleanup=()=>{};
  const close = async () => {detachCleanup(); const errors: unknown[] = []; for (const run of [() => authoring.close(), () => packages.close()])
    try {
      await run();
    }
    catch (error) {
      errors.push(error);
    } if (errors.length)
    throw new AggregateError(errors, 'DOCK_SOURCE_CLEANUP_FAILED'); };
  try {
    const initialize=async()=>{await authoring.initialize();check();await packages.initialize();check();};
    if(ports.widgetCleanup)detachCleanup=await ports.widgetCleanup.initialize({packages:accountId=>packages.clearAccount(accountId)},initialize);else await initialize();
    return { authoring, packages, close };
  }
  catch (error) {
    try {
      await close();
    }
    catch (cleanup) {
      throw new AggregateError([error, cleanup], 'DOCK_SOURCE_INITIALIZATION_FAILED');
    }
    throw error;
  }
}
