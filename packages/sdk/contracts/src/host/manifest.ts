/**
 * [INPUT]: Depends on Zod, Provider identity, declarative settings and record UI contracts.
 * [OUTPUT]: Provides hostPackageManifestSchema and HostPackageManifest, including isolated record actions and UI-only packages.
 * [POS]: Public package manifest; host admission separately checks files, signatures, containment and family exclusivity.
 */
import { z } from "zod";
import { providerIdSchema } from "../model/provider";
import { settingFieldsSchema } from "../plugins/settings";
import { recordUiSchema } from "../plugins/records/definition";

export const HOST_PACKAGE_ADAPTER_ID = "bottega-host-package-1";
export const HOST_PACKAGE_SCHEMA_ID = "bottega.host-package/v1";
export const HOST_PACKAGE_MANIFEST = "bottega.extension.json";

const contract = z.string().regex(/^bottega\.[a-z0-9.-]+\/v[1-9][0-9]*$/);
const entryPath = z.string().min(1).max(200).regex(/^(?![/\\])(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._/-]+$/, "entry-path-invalid");
export const hostPackageManifestSchema = z.object({
  schema: z.literal(HOST_PACKAGE_SCHEMA_ID),
  packageId: z.string().min(1).max(128).regex(/^[a-z][a-z0-9.-]*$/),
  packageVersion: z.string().min(1).max(40).regex(/^[0-9A-Za-z.+-]+$/),
  family: z.literal("host-package"),
  presentation: z.enum(["app", "plugin"]),
  displayName: z.string().min(1).max(120),
  entries: z.object({ service: entryPath.optional(), ui: entryPath.optional(), bridge: entryPath.optional() }).strict()
    .refine(value => Boolean(value.service || value.ui || value.bridge), "entries-empty"),
  uiDelivery: z.enum(["none", "trusted-build", "isolated-surface"]),
  recordUi: recordUiSchema.optional(),
  provides: z.array(z.object({ contract, actions: z.array(z.string().min(1).max(80)).max(64) }).strict()).max(32)
    .refine(value => new Set(value.map(item => item.contract)).size === value.length, "provides-duplicate"),
  requires: z.array(contract).max(32),
  permissions: z.object({ executionTrust: z.literal("explicitly-trusted-code"), requestedCapabilities: z.array(z.string().min(1).max(160)).max(64) }).strict(),
  /* The same id space as every other Provider id (chats, configurations, measurements); a dotted id could never be chosen. */
  provider: z.object({ id: providerIdSchema, protocol: z.enum(["acp", "native-rpc"]),
    remoteLogin: z.enum(["device-code", "unsupported"]) }).strict().optional(),
  /* A package writes its own words; copy keys and existing owners (adapters) belong to built-in plugins. */
  settings: settingFieldsSchema.optional(),
}).strict()
  .refine(value => value.provides.length > 0 || Boolean(value.recordUi), "package-capability-required")
  .refine(value => !value.recordUi || /(^|\/)index\.html$/.test(value.entries.ui ?? ""), "record-ui-index-required")
  .refine(value => !value.recordUi || value.uiDelivery === "isolated-surface" && value.presentation === "plugin", "record-ui-requires-isolated-plugin")
  .refine(value => value.uiDelivery !== "trusted-build" || value.presentation === "app", "trusted-build-requires-app")
  .refine(value => (value.uiDelivery === "none") === !value.entries.ui, "ui-entry-and-delivery-disagree")
  .refine(value => (value.settings ?? []).every(field => field.owner === "store" && "text" in field.label && (!field.description || "text" in field.description)
    && (field.type !== "select" || field.options.every(option => "text" in option.label))), "settings-must-be-verbatim-store");
export type HostPackageManifest = z.infer<typeof hostPackageManifestSchema>;
