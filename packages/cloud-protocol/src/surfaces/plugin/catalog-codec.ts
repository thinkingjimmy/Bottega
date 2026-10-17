/**
 * [INPUT]: Closed plugin/Artifact publication, existing plaintext budget and authenticated computer/connection/protocol/publication identity.
 * [OUTPUT]: Sealed entries plus exact-owner Artifact capability; cross-device/epoch/protocol substitutions are refused.
 * [POS]: Encrypted per-computer plugin catalog beside remote Agent and Memory capabilities.
 */
import type { ProtocolHeader } from "../../config";
import { assertCrypto, createRemotePluginsContext, canonicalJson, type CryptoScope } from "../../encryption";
import { encryptedRemotePluginsSchema, type EncryptedRemotePlugins } from "../../remote/encrypted/model";
import { sealRemotePacket, openRemotePacket, type RemoteCipherPort } from "../../remote/encrypted/client";
import { remotePluginCatalogSchema, REMOTE_PLUGIN_CATALOG_LIMITS, type RemotePluginCatalog } from "./catalog";
import { z } from "zod";
import { artifactCapabilitySchema, type ArtifactCapability } from "../../artifacts/design/core/capability";
const publicationSchema = z.object({ entries: remotePluginCatalogSchema, artifact: artifactCapabilitySchema.nullable() }).strict();
export const remotePluginsContext = (scope: CryptoScope, input: {deviceId:string;connectionEpoch:string;publicationId:string;protocolVersion:number}) =>
  createRemotePluginsContext(scope,input.publicationId,input.publicationId,input);
export async function sealRemotePlugins(catalog: RemotePluginCatalog, connectionEpoch: string, header: ProtocolHeader, crypto: RemoteCipherPort, signal?: AbortSignal, artifact: ArtifactCapability | null = null) {
  const value=publicationSchema.parse({ entries: catalog, artifact }),publicationId=globalThis.crypto.randomUUID();
  assertCrypto(new TextEncoder().encode(canonicalJson(value)).byteLength<=REMOTE_PLUGIN_CATALOG_LIMITS.plaintextBytes);
  const context=remotePluginsContext(crypto.scope,{deviceId:crypto.session.deviceId,connectionEpoch,publicationId,protocolVersion:header.protocolVersion});
  return encryptedRemotePluginsSchema.parse({publicationId,packet:await sealRemotePacket(crypto,context,value,signal)});
}
export async function openRemotePlugins(value: EncryptedRemotePlugins, target:{deviceId:string;connectionEpoch:string;protocolVersion:number},crypto:RemoteCipherPort,signal?:AbortSignal) {
  const sealed=encryptedRemotePluginsSchema.parse(value);
  const catalog=publicationSchema.parse(await openRemotePacket(crypto,remotePluginsContext(crypto.scope,{...target,publicationId:sealed.publicationId}),sealed.packet,signal));
  assertCrypto(new TextEncoder().encode(canonicalJson(catalog)).byteLength<=REMOTE_PLUGIN_CATALOG_LIMITS.plaintextBytes);return catalog;
}
