/**
 * [INPUT]: Canonical plugin install bridge, source directory input and shared dialog controls.
 * [OUTPUT]: Installs authored/official sources directly and confirms external trusted code once before installation.
 * [POS]: Unified plugin acquisition; cancellation performs no install or Project creation.
 */
import { useRef,useState } from 'react';
import { Input } from '@ai-chat/ui/components/ui/input';
import { AppDialogContent,ConfirmationDialog } from '@ai-chat/ui/components/ui/app-dialog';
import { Dialog,DialogDescription,DialogFooter,DialogHeader,DialogTitle } from '@ai-chat/ui/components/ui/dialog';
import { SettingsAlert,SettingsButton } from '@/components/settings/settings-layout';
import { pluginPlatformBridge } from '@/lib/plugin-platform/client';
import { pluginPlatformCopy } from '@/lib/plugin-platform/copy';
export function InstallUnifiedPlugin({locale,onInstalled}:{locale:string;onInstalled:(id:string)=>void}){
  const copy=pluginPlatformCopy(locale),[open,setOpen]=useState(false),[directory,setDirectory]=useState(''),[busy,setBusy]=useState(false),[trust,setTrust]=useState(false),[error,setError]=useState(''),[source,setSource]=useState(''),expected=useRef<string|undefined>(undefined),lock=useRef(false);
  const install=async(accepted=false)=>{if(lock.current)return;const bridge=pluginPlatformBridge();if(!bridge)return;lock.current=true;setBusy(true);setError('');
    try{if(!accepted){const inspection=await bridge.inspect({directory:directory.trim()});expected.current=inspection.manifestDigest;if(inspection.requiresTrust){setSource(`${inspection.manifest.name} · ${inspection.manifest.source.url??directory}`);setOpen(false);setTrust(true);return;}}
      const plugin=await bridge.install({directory:directory.trim(),...(expected.current?{expectedManifestDigest:expected.current}:{}),...(accepted?{trust:true}: {})});setOpen(false);setTrust(false);setDirectory('');onInstalled(plugin.manifest.id);}
    catch(cause){const message=cause instanceof Error?cause.message:String(cause);if(/trust.*(required|confirm)|PLUGIN_TRUST_REQUIRED/i.test(message)){setOpen(false);setTrust(true);}else setError(message);}
    finally{lock.current=false;setBusy(false);}};
  return <><SettingsButton disabled={!pluginPlatformBridge()} variant="outline" onClick={()=>{setError('');setOpen(true);}} data-unified-plugin-install="">{copy.install}</SettingsButton>
    <Dialog open={open} onOpenChange={value=>{if(!busy)setOpen(value);}}><AppDialogContent><DialogHeader><DialogTitle>{copy.install}</DialogTitle><DialogDescription>{copy.directory}</DialogDescription></DialogHeader>
      <Input aria-label={copy.directory} placeholder="/path/to/plugin" value={directory} onChange={event=>setDirectory(event.target.value)} disabled={busy}/>{error&&<SettingsAlert>{error}</SettingsAlert>}
      <DialogFooter><SettingsButton variant="ghost" disabled={busy} onClick={()=>setOpen(false)}>{copy.cancel}</SettingsButton><SettingsButton disabled={busy||!directory.trim()} onClick={()=>void install()}>{busy?copy.loading:copy.installAction}</SettingsButton></DialogFooter>
    </AppDialogContent></Dialog>
    <ConfirmationDialog open={trust} busy={busy} title={copy.trust} description={<div className="space-y-3"><p>{copy.trustBody}</p><p className="break-all">{copy.sourceInfo}: {source||directory}</p>{error&&<SettingsAlert>{error}</SettingsAlert>}</div>} confirmLabel={copy.continue} onOpenChange={value=>{if(!busy){setTrust(value);if(!value)setError('');}}} onConfirm={()=>void install(true)}/>
  </>;
}
