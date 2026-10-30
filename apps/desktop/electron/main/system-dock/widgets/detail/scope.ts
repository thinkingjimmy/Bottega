/**
 * [INPUT]: Depends on exact accepted runtime snapshots and canonical JSON.
 * [OUTPUT]: Provides an opaque native instance/package/settings/name/source-account identity; source account changes retire old data sessions.
 * [POS]: Native detail identity leaf; desired references and source active/candidate pointers confer no execution authority.
 */
import {createHash} from 'node:crypto';
import {canonicalJson} from '@bottega/contracts/core/canonical-json';
import type {WidgetDetailSource} from './ports';
export function widgetDetailKey(source:WidgetDetailSource){return createHash('sha256').update(canonicalJson({scope:source.accepted.scope,itemId:source.item.id,revision:source.accepted.revision,widget:source.accepted.widget,name:source.item.label??source.manifest.name,dataIdentity:source.dataIdentity})).digest('hex');}
