/**
 * [INPUT]: Plugin catalog schema/shared plaintext budget, authenticated computer/connection identity and remote packet cipher.
 * [OUTPUT]: Seal/open helpers and the remote-plugins context; rejects cross-device, epoch and protocol substitution.
 * [POS]: Encrypted per-computer plugin catalog beside remote Agent and Memory capabilities.
 */
import type { ProtocolHeader } from "../../config";
import { assertCrypto, createRemotePluginsContext, canonicalJson, type CryptoScope } from "../../encryption";
import { encryptedRemotePluginsSchema, type EncryptedRemotePlugins } from "../../remote/encrypted/model";
import { sealRemotePacket, openRemotePacket, type RemoteCipherPort } from "../../remote/encrypted/client";
import { remotePluginCatalogSchema, REMOTE_PLUGIN_CATALOG_LIMITS, type RemotePluginCatalog } from "./catalog";
export const remotePluginsContext = (scope: CryptoScope, input: {deviceId:string;connectionEpoch:string;publicationId:string;protocolVersion:number}) =>
  createRemotePluginsContext(scope,input.publicationId,input.publicationId,input);
export async function sealRemotePlugins(catalog: RemotePluginCatalog, connectionEpoch: string, header: ProtocolHeader, crypto: RemoteCipherPort, signal?: AbortSignal) {
  const value=remotePluginCatalogSchema.parse(catalog),publicationId=globalThis.crypto.randomUUID();
  assertCrypto(new TextEncoder().encode(canonicalJson(value)).byteLength<=REMOTE_PLUGIN_CATALOG_LIMITS.plaintextBytes);
  const context=remotePluginsContext(crypto.scope,{deviceId:crypto.session.deviceId,connectionEpoch,publicationId,protocolVersion:header.protocolVersion});
  return encryptedRemotePluginsSchema.parse({publicationId,packet:await sealRemotePacket(crypto,context,value,signal)});
}
export async function openRemotePlugins(value: EncryptedRemotePlugins, target:{deviceId:string;connectionEpoch:string;protocolVersion:number},crypto:RemoteCipherPort,signal?:AbortSignal) {
  const sealed=encryptedRemotePluginsSchema.parse(value);
  const catalog=remotePluginCatalogSchema.parse(await openRemotePacket(crypto,remotePluginsContext(crypto.scope,{...target,publicationId:sealed.publicationId}),sealed.packet,signal));
  assertCrypto(new TextEncoder().encode(canonicalJson(catalog)).byteLength<=REMOTE_PLUGIN_CATALOG_LIMITS.plaintextBytes);return catalog;
}
