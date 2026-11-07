/**
 * [INPUT]: A late Cloud package owner factory and account/shutdown lifecycle changes.
 * [OUTPUT]: Loads package delivery only on use, rejects cross-account initialization and closes late owners.
 * [POS]: Startup boundary; offline plugin execution does not initialize encrypted package delivery.
 */
type Owner={accountChanged():void;close():Promise<void>};
export function deferPluginPackages<T extends Owner>(create:()=>Promise<T>){
  let epoch=0,closed=false,current:T|undefined,flight:Promise<T>|undefined;
  return{
    async get(){
      if(closed)throw new Error('Plugin package owner is closed');
      const requestEpoch=epoch;
      const loaded=await(flight??=(async()=>{try{const owner=await create();current=owner;return owner;}catch(error){flight=undefined;throw error;}})());
      if(closed)throw new Error('Plugin package owner is closed');
      if(requestEpoch!==epoch)throw new Error('Plugin package account changed');
      return loaded;
    },
    accountChanged(){epoch++;current?.accountChanged();},
    async close(){closed=true;current?.accountChanged();const owner=await flight?.catch(()=>undefined);await owner?.close();},
  };
}
