/**
 * [INPUT]: Depends on exact local scope/instance identity, confirmed Base declarations/bindings, canonical hashing and the prior local permission.
 * [OUTPUT]: Provides strict local Base permission receipts and exact-range approval/revocation-preserving decisions.
 * [POS]: Widget mapping permission leaf; portable bindings, source edits, forks and version rollback never grant access themselves.
 */
import {createHash} from 'node:crypto';
import {z} from 'zod';
import {canonicalJson} from '@bottega/contracts/core/canonical-json';
import type {DockContribution} from '@bottega/contracts/plugins/dock/manifest';
import type {CustomDockWidget} from '../../../../../shared/system-dock/widgets/instance';
import type {AcceptedWidget,LocalWidgetScope} from './model';
export const baseAccessSchema=z.enum(['unconfirmed','approved','revoked']);
export const baseGrantSchema=z.object({digest:z.string().regex(/^sha256:[a-f0-9]{64}$/),revision:z.number().int().positive(),approvedAt:z.number().int().nonnegative()}).strict();
export const basePermissionSchema=z.object({baseAccess:baseAccessSchema,baseGrant:baseGrantSchema.nullable()}).strict().refine(value=>(value.baseAccess==='unconfirmed')===(value.baseGrant===null),'Base permission receipt is required');
export type BasePermission=z.infer<typeof basePermissionSchema>;
export function basePermissionFor(input:{itemId:string;scope:LocalWidgetScope;widget:CustomDockWidget;dock:DockContribution;prior:AcceptedWidget|null;consent:boolean}):BasePermission{
 const {itemId,scope,widget,dock,prior,consent}=input,queries=dock.data.filter(source=>source.kind==='base');
 if(!queries.length)return{baseAccess:'unconfirmed',baseGrant:null};
 if(!scope.libraryId)throw new Error('DOCK_BASE_AUTHORIZATION_REQUIRED');
 const rangeSettings=Object.fromEntries(queries.flatMap(source=>[source.fromSetting,source.toSetting].filter(Boolean).map(id=>[id!,widget.settings[id!]])));
 const digest='sha256:'+createHash('sha256').update(canonicalJson({itemId,scope,definitionId:widget.definition.definitionId,sourceInstallationId:widget.definition.sourceInstallationId,queries,bindings:widget.bindings,rangeSettings})).digest('hex');
 const previous=prior&&prior.itemId===itemId&&canonicalJson(prior.scope)===canonicalJson(scope)&&prior.widget.definition.definitionId===widget.definition.definitionId&&prior.widget.definition.sourceInstallationId===widget.definition.sourceInstallationId?prior:null;
 if(consent)return{baseAccess:'approved',baseGrant:{digest,revision:(previous?.baseGrant?.revision??0)+1,approvedAt:Date.now()}};
 if(previous?.baseGrant?.digest===digest&&(previous.baseAccess==='approved'||previous.baseAccess==='revoked'))return{baseAccess:previous.baseAccess,baseGrant:structuredClone(previous.baseGrant)};
 throw new Error('DOCK_BASE_AUTHORIZATION_REQUIRED');
}
