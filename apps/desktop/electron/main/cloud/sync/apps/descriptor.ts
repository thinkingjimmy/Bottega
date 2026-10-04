/**
 * [INPUT]: Depends on validated public App/package DTOs and local portable descriptor schemas.
 * [OUTPUT]: Maps metadata-first cloud App identities into the Store's authority-free projection.
 * [POS]: Cloud-to-Store adapter; package metadata never constitutes local installation or execution authority.
 */
import { appItemSchema, appPackageSchema, type CloudApp, type CloudAppPackage } from "@ai-chat/cloud-protocol/apps/model";
import { appDescriptorSchema, type AppDescriptor } from "../../../apps/store/portable/model";
export function appDescriptor(input: CloudApp, packageInput: CloudAppPackage | null): AppDescriptor {
  const app = appItemSchema.parse(input), candidate = packageInput && appPackageSchema.parse(packageInput);
  if (candidate && (candidate.appId !== app.appId || candidate.packageRevision !== app.activePackageRevision)) throw new Error("APP_PACKAGE_IDENTITY_CONFLICT");
  return appDescriptorSchema.parse({ appId: app.appId, projectId: app.projectId, baseId: app.baseId, name: app.displayName,
    dataCoverage: app.dataCoverage, cloudRevision: app.revision, createdAt: app.createdAt, updatedAt: app.updatedAt,
    packageRevision: candidate?.packageRevision ?? null, manifestDigest: candidate?.manifestDigest ?? null,
    sourcePackageDigest: candidate?.sourcePackageDigest ?? null, sourceBlob: candidate?.packageBlob ?? null });
}
