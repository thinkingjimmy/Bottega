/**
 * [INPUT]: Original App deletion ports, a durable uninstall intent and private configuration/source receipt authorities.
 * [OUTPUT]: Freezes uninstall facts, refuses missing-kind replay and verifies retained source/private config before success.
 * [POS]: Operation-only proof leaf of the original AppDeleteService; no public disposition DTO or second lifecycle owner.
 */
import type { AppDeleteDependencies } from '../app-delete';
import type { LifecycleIntent } from '../../../lifecycle/intent-types';
export function freezeUninstall(dependencies:AppDeleteDependencies,appId:string){
  const appKind=dependencies.store.get(appId)?.manifest?.kind;
  if(!['base','static','server'].includes(appKind??''))throw new Error('App uninstall kind is unavailable');
  return{appKind,configurationPresent:dependencies.configurationPresent?.(appId)??false};
}
export function uninstallKind(intent:LifecycleIntent){
  const kind=intent.allocated.appKind;
  if(!['base','static','server'].includes(String(kind))||typeof intent.allocated.configurationPresent!=='boolean')throw new Error('App uninstall kind or disposition proof is unavailable');
  return kind;
}
export async function verifyUninstall(dependencies:AppDeleteDependencies,intent:LifecycleIntent){
  const appId=String(intent.input.appId);
  if(!dependencies.hasRetainedRemoval||!await dependencies.hasRetainedRemoval(appId,intent.requestId))throw new Error('Retained App source custody is unavailable');
  if(intent.allocated.configurationPresent&&!dependencies.configurationPresent?.(appId))throw new Error('Retained App configuration is unavailable');
}
