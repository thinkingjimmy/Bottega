/**
 * [INPUT]: The existing decrypted Cloud vault owner and current account/credential epoch.
 * [OUTPUT]: Read-only trusted plugin access to current Bottega Cloud session/vault credentials.
 * [POS]: Late-bound credential adapter; never reads OS, browser-profile or CLI credential files.
 */
import type {PluginCredentialPort} from '../../process/credentials';
type Vault={session?:{userId:string}|null;signOutRequested?:boolean};
type Identity={userId:string|null;epoch:number};
export function cloudPluginCredentials(input:{identity():Identity;read():Promise<Vault>}):PluginCredentialPort{
  return{
    list:async()=>input.identity().userId?['session','vault']:[],
    read:async key=>{
      if(!['session','vault'].includes(key))return null;
      const before=input.identity();if(!before.userId)return null;
      const vault=await input.read(),after=input.identity();
      if(before.userId!==after.userId||before.epoch!==after.epoch||vault.signOutRequested||vault.session?.userId!==after.userId)return null;
      return JSON.stringify(key==='session'?vault.session:vault);
    },
    write:async()=>{throw new Error('Cloud credentials are a read-only owner; use the Cloud account lifecycle to change them');},
  };
}
