/**
 * [INPUT]: Node SHA-256 and the shared canonical JSON digest.
 * [OUTPUT]: pluginHash and pluginBytesHash provide source/package identity without filesystem inventory.
 * [POS]: Small identity leaf shared by startup orchestration and on-demand source/compiler modules.
 */
import { createHash } from 'node:crypto';
import { hashCanonical } from '@bottega/contracts/core/canonical-json';

export const pluginHash = (value: unknown) => `sha256:${hashCanonical(value)}`;
export const pluginBytesHash = (value: Uint8Array) => `sha256:${createHash('sha256').update(value).digest('hex')}`;
