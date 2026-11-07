/**
 * [INPUT]: The production plugin preload bridge and canonical source metadata types.
 * [OUTPUT]: Bridge access and source/editability/original-installation metadata helpers that preserve readonly official declarations and delegated App-format classification.
 * [POS]: Lightweight renderer authority boundary; paged management and optional detail/search hooks live in projection leaves.
 */
import type {UnifiedPluginBridge,UnifiedPluginCatalogItem,UnifiedPluginCatalogSummary} from '@bottega/contracts/plugins/platform';
declare global {interface Window {pluginPlatform?:UnifiedPluginBridge}}
export const pluginPlatformBridge=()=>typeof window==='undefined'?null:window.pluginPlatform??null;
type SourceItem=Pick<UnifiedPluginCatalogItem,'manifest'>|Pick<UnifiedPluginCatalogSummary,'manifest'>;
export const editablePlugin=(item:SourceItem)=>item.manifest.source.format==='bottega'&&(item.manifest.source.kind!=='official'||item.manifest.source.editable)&&('canCopy'in item.manifest.source?item.manifest.source.editable||item.manifest.source.canCopy:'contributions'in item.manifest&&!item.manifest.contributions.some(contribution=>'hostViewId'in contribution&&contribution.hostViewId));

/** Original installed authority is metadata only; main owns host-package provenance admission. */
export const hostPackageIdentity=(item:SourceItem)=>item.manifest.source.format==='host-package'?item.manifest.source.installIdentity??('contributions'in item.manifest?item.manifest.contributions.flatMap(contribution=>contribution.kind==='service'&&contribution.hostPackageId?[contribution.hostPackageId]:[])[0]:undefined):undefined;

export const isHostedAppPlugin=(item:SourceItem)=>['base-app','web-app','server-app'].includes(item.manifest.source.format);
