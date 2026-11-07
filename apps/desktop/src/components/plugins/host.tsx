/**
 * [INPUT]: Main-owned host-view IDs, the compile-time workbench flag, existing Project Workflow and Dock Settings controls, current Projects and shared navigation.
 * [OUTPUT]: NativePluginPage dispatches known native views and reports unavailable Workflows when the build flag is off, without an iframe lease, new Project or duplicate feature lifecycle.
 * [POS]: Unified page adapter for original native owners; manifests gain these fields only through privileged main registration.
 */
import { lazy,Suspense,useState } from 'react';
import { Link } from 'react-router';
import { workbenchUiEnabled } from '@ai-chat/ui/lib/workbench-flag';
import { PageShell } from '@/components/page-shell';
import { useProjects } from '@/components/providers/projects-provider';
import { useAppTranslation } from '@/components/providers/preferences/i18n-provider';
import { SettingsButton } from '@/components/settings/settings-layout';
import { pluginPlatformCopy } from '@/lib/plugin-platform/copy';
import { effectiveLocale } from '@/lib/appearance/i18n-locale';
import { loadSection } from '../../../shared/i18n/sections';
const ProjectWorkflows=workbenchUiEnabled?lazy(()=>import('@/components/settings/project/workflows/project-workflows-section').then(module=>({default:module.ProjectWorkflowsSection}))):null;
const DockSettings=lazy(()=>Promise.all([import('@/views/settings/dock/settings-dock'),loadSection('systemDock',effectiveLocale())]).then(([module])=>({default:module.DockSettingsContent})));
export function NativePluginPage({view,name}:{view:'workflow'|'dock-settings';name:string}){
  const {i18n}=useAppTranslation(),copy=pluginPlatformCopy(i18n.language),{projects}=useProjects(),[selected,setSelected]=useState('');
  const available=projects.filter(project=>!project.archivedAt&&!project.missing&&project.role!=='base-custody'),project=available.find(project=>project.id===selected);
  return <PageShell title={name} backHref="/"><div className="h-full overflow-auto" data-native-plugin-view={view}><Suspense fallback={<p className="p-6 text-sm text-muted-foreground">{copy.loading}</p>}>
    {view==='dock-settings'?<DockSettings/>:ProjectWorkflows?<><div className="mx-auto flex w-full max-w-4xl flex-wrap items-center gap-3 px-6 pt-6"><label className="flex min-w-56 flex-1 items-center gap-3 text-sm">{copy.projects}<select value={selected} onChange={event=>setSelected(event.target.value)} aria-label={copy.nativeSelectProject} className="min-h-10 min-w-0 flex-1 rounded-md border bg-background px-3"><option value="">{copy.nativeSelectProject}</option>{available.map(project=><option key={project.id} value={project.id}>{project.name}</option>)}</select></label>{project&&<SettingsButton asChild variant="outline"><Link to={`/bases/project/${encodeURIComponent(project.id)}`}>{copy.nativeOpenBase}</Link></SettingsButton>}</div>{project?<ProjectWorkflows key={project.id} project={project}/>:<p className="mx-auto w-full max-w-4xl px-6 py-8 text-sm text-muted-foreground">{available.length?copy.nativeSelectProject:copy.nativeNoProjects}</p>}</>:<p role="alert" className="p-6 text-sm text-muted-foreground">{copy.pageUnavailable}</p>}
  </Suspense></div></PageShell>;
}
