/**
 * [INPUT]: Canonical plugin install bridge, source authoring callback, localized labels and shared menu/dialog controls.
 * [OUTPUT]: PluginAddMenu opens source authoring or reviewed local installation and restores trigger focus after dismissal.
 * [POS]: Unified catalog acquisition; cancellation performs no install or Project creation.
 */
import { useRef,useState } from 'react';
import { ChevronDown,FolderOpen,Plus,SquarePen } from 'lucide-react';
import { Input } from '@ai-chat/ui/components/ui/input';
import { AppDialogContent,ConfirmationDialog } from '@ai-chat/ui/components/ui/app-dialog';
import { Dialog,DialogDescription,DialogFooter,DialogHeader,DialogTitle } from '@ai-chat/ui/components/ui/dialog';
import { DropdownMenu,DropdownMenuContent,DropdownMenuItem,DropdownMenuTrigger } from '@ai-chat/ui/components/ui/dropdown-menu';
import { focusIsLost } from '@ai-chat/ui/lib/focus-return';
import { SettingsAlert,SettingsButton } from '@/components/settings/settings-layout';
import { pluginPlatformBridge } from '@/lib/plugin-platform/client';
import { pluginPlatformCopy } from '@/lib/plugin-platform/copy';
export function PluginAddMenu({locale,onNew,onInstalled}:{locale:string;onNew:()=>void;onInstalled:(id:string)=>void}){
  const copy=pluginPlatformCopy(locale),[open,setOpen]=useState(false),[directory,setDirectory]=useState(''),[busy,setBusy]=useState(false),[trust,setTrust]=useState(false),[error,setError]=useState(''),[source,setSource]=useState(''),expected=useRef<string|undefined>(undefined),lock=useRef(false);
  const trigger=useRef<HTMLButtonElement>(null);
  const returnFocus=(event:Event)=>{event.preventDefault();if(focusIsLost())trigger.current?.focus();};
  const install=async(accepted=false)=>{if(lock.current)return;const bridge=pluginPlatformBridge();if(!bridge)return;lock.current=true;setBusy(true);setError('');
    try{if(!accepted){const inspection=await bridge.inspect({directory:directory.trim()});expected.current=inspection.manifestDigest;if(inspection.requiresTrust){setSource(`${inspection.manifest.name} · ${inspection.manifest.source.url??directory}`);setOpen(false);setTrust(true);return;}}
      const plugin=await bridge.install({directory:directory.trim(),...(expected.current?{expectedManifestDigest:expected.current}:{}),...(accepted?{trust:true}: {})});setOpen(false);setTrust(false);setDirectory('');onInstalled(plugin.manifest.id);}
    catch(cause){const message=cause instanceof Error?cause.message:String(cause);if(/trust.*(required|confirm)|PLUGIN_TRUST_REQUIRED/i.test(message)){setOpen(false);setTrust(true);}else setError(message);}
    finally{lock.current=false;setBusy(false);}};
  return <>
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <SettingsButton ref={trigger} disabled={!pluginPlatformBridge()} className="gap-1.5">
          <Plus aria-hidden className="size-3.5" />{copy.addPlugin}<ChevronDown aria-hidden className="size-3.5" />
        </SettingsButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-max min-w-48">
        <DropdownMenuItem onSelect={onNew}><SquarePen aria-hidden />{copy.newPlugin}</DropdownMenuItem>
        <DropdownMenuItem data-unified-plugin-install="" onSelect={()=>{setError('');setOpen(true);}}><FolderOpen aria-hidden />{copy.install}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
    <Dialog open={open} onOpenChange={value=>{if(!busy)setOpen(value);}}><AppDialogContent onCloseAutoFocus={returnFocus}><DialogHeader><DialogTitle>{copy.install}</DialogTitle><DialogDescription>{copy.directory}</DialogDescription></DialogHeader>
      <Input aria-label={copy.directory} placeholder="/path/to/plugin" value={directory} onChange={event=>setDirectory(event.target.value)} disabled={busy}/>{error&&<SettingsAlert>{error}</SettingsAlert>}
      <DialogFooter><SettingsButton variant="ghost" disabled={busy} onClick={()=>setOpen(false)}>{copy.cancel}</SettingsButton><SettingsButton disabled={busy||!directory.trim()} onClick={()=>void install()}>{busy?copy.loading:copy.installAction}</SettingsButton></DialogFooter>
    </AppDialogContent></Dialog>
    <ConfirmationDialog open={trust} busy={busy} title={copy.trust} description={<div className="space-y-3"><p>{copy.trustBody}</p><p className="break-all">{copy.sourceInfo}: {source||directory}</p>{error&&<SettingsAlert>{error}</SettingsAlert>}</div>} confirmLabel={copy.continue} onOpenChange={value=>{if(!busy){setTrust(value);if(!value)setError('');}}} onCloseAutoFocus={returnFocus} onConfirm={()=>void install(true)}/>
  </>;
}
