/**
 * [INPUT]: Depends on platform-neutral App declarations and shared validation primitives.
 * [OUTPUT]: Provides the canonical App manifest parser; its JSON Schema lives in manifest-json.ts.
 * [POS]: Canonical App schema shared by source validation and desktop readers; it grants no execution authority.
 */
import { z } from "zod";
import { APP_GUI_PRESET } from "./constants";
import { appCommandSchema } from "./command";

const sha256DigestSchema = z
  .string()
  .regex(/^sha256:[a-f0-9]{64}$/)
  .transform((value) => value as `sha256:${string}`);

// ============================================================
// Zod and JSON Schema describe the same contract and must keep identical fields.
// ============================================================

const requirementSchema = z
  .object({
    id: z.string().trim().min(1).max(120),
    kind: z.enum(["cli", "mcp", "config"]),
    label: z.string().trim().min(1).max(120),
    note: z.string().trim().max(500),
    required: z.boolean(),
    sensitive: z.boolean().optional(),
    configKey: z.string().trim().min(1).max(120).optional(),
  })
  .strict()
  .superRefine((requirement, context) => {
    if (requirement.kind === "config" && !requirement.configKey) {
      context.addIssue({
        code: "custom",
        path: ["configKey"],
        message: "Config requirements must provide configKey",
      });
    }
    if (requirement.kind !== "config" && requirement.configKey) {
      context.addIssue({
        code: "custom",
        path: ["configKey"],
        message: "Only config requirements may provide configKey",
      });
    }
  });

export const requirementsSchema = z
  .object({
    tools: z.array(requirementSchema).max(100),
  })
  .strict()
  .superRefine((requirements, context) => {
    const ids = new Set<string>();
    const configKeys = new Set<string>();
    requirements.tools.forEach((requirement, index) => {
      if (ids.has(requirement.id)) {
        context.addIssue({
          code: "custom",
          path: ["tools", index, "id"],
          message: `Duplicate requirement ID: ${requirement.id}`,
        });
      }
      ids.add(requirement.id);
      if (!requirement.configKey) return;
      const canonical = requirement.configKey.toUpperCase();
      if (configKeys.has(canonical)) {
        context.addIssue({
          code: "custom",
          path: ["tools", index, "configKey"],
          message: `Case-insensitive configKey conflict: ${requirement.configKey}`,
        });
      }
      configKeys.add(canonical);
    });
  });

const common = {
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().min(1).max(500),
  icon: z.string().trim().min(1).max(16),
  requirements: requirementsSchema.nullable(),
  extensionRequirements: z
    .array(
      z
        .object({
          declaredComponentIdentity: z.string().trim().min(3).max(300),
          packageDigest: sha256DigestSchema.optional(),
          versionRange: z.string().trim().min(1).max(120).optional(),
          required: z.boolean(),
          requestedConfig: z
            .record(z.string(), z.unknown())
            .superRefine((config, context) => {
              const forbidden = findForbiddenExtensionConfig(config);
              for (const path of forbidden) {
                context.addIssue({
                  code: "custom",
                  path,
                  message: "requestedConfig cannot inline execution, network, prompt or tool schemas",
                });
              }
            })
            .optional(),
          source: z
            .object({
              repoUrl: z.string().url().regex(/^https:\/\/github\.com\//),
              ref: z.string().trim().min(1).max(200).optional(),
            })
            .strict()
            .optional(),
        })
        .strict()
    )
    .max(100)
    .superRefine((requirements, context) => {
      const seen = new Set<string>();
      requirements.forEach((requirement, index) => {
        if (seen.has(requirement.declaredComponentIdentity)) {
          context.addIssue({
            code: "custom",
            path: [index, "declaredComponentIdentity"],
            message: `Duplicate extension component identity: ${requirement.declaredComponentIdentity}`,
          });
        }
        seen.add(requirement.declaredComponentIdentity);
      });
    })
    .optional(),
};

const FORBIDDEN_EXTENSION_CONFIG_KEYS = new Set([
  "command",
  "args",
  "env",
  "url",
  "headers",
  "prompt",
  "promptBody",
  "tools",
  "toolSchema",
  "inputSchema",
]);

function findForbiddenExtensionConfig(
  value: unknown,
  path: Array<string | number> = []
): Array<Array<string | number>> {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) =>
      findForbiddenExtensionConfig(item, [...path, index])
    );
  }
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, child]) => [
    ...(FORBIDDEN_EXTENSION_CONFIG_KEYS.has(key) ? [[...path, key]] : []),
    ...findForbiddenExtensionConfig(child, [...path, key]),
  ]);
}
const agentRequirements = z
  .object({
    mcpServers: z.array(z.string().trim().min(1).max(120)).max(50),
    skills: z.array(z.string().trim().min(1).max(120)).max(100),
  })
  .strict()
  .nullable();

const staticManifestSchema = z
  .object({
    ...common,
    kind: z.literal("static"),
    executionSchemaVersion: z.literal(1).optional(),
    installCmd: appCommandSchema.nullable(),
    buildCmd: appCommandSchema.nullable(),
    staticDir: z.string().trim().min(1).max(500),
    healthPath: z.string().regex(/^\/([^/]|$)/).max(500),
    agentRequirements,
  })
  .strict();

const serverManifestSchema = z
  .object({
    ...common,
    kind: z.literal("server"),
    executionSchemaVersion: z.literal(1).optional(),
    installCmd: appCommandSchema.nullable(),
    buildCmd: appCommandSchema.nullable(),
    startCmd: appCommandSchema,
    healthPath: z.string().regex(/^\/([^/]|$)/).max(500),
    serveAgentPrompt: z.string().trim().min(1).max(10_000).nullable(),
    serveTrigger: z
      .object({ watchPath: z.string().trim().min(1).max(500) })
      .strict()
      .nullable(),
    agentRequirements,
  })
  .strict()
  .refine((manifest) => {
    const configured = [
      manifest.serveAgentPrompt,
      manifest.serveTrigger,
      manifest.agentRequirements,
    ].filter(Boolean).length;
    return configured === 0 || configured === 3;
  }, {
      message:
        "serveAgentPrompt, serveTrigger and agentRequirements must all be present or all be null",
  });

const baseManifestSchema = z
  .object({
    ...common,
    kind: z.literal("base"),
    packageSchemaVersion: z.literal(2),
    gui: z
      .object({
        capabilities: z
          .array(z.enum(["row-insert", "row-patch", "row-delete", "attachment-read", "workspace-read"]))
          .max(5)
          .refine((values) => new Set(values).size === values.length),
        hostActions: z
          .array(z.enum(["compose-text", "file.export"]))
          .max(2)
          .refine((values) => new Set(values).size === values.length)
          .optional(),
        capabilityScopes: z
          .object({ workspaceRead: z.literal("design/").optional() })
          .strict()
          .optional(),
        build: z
          .object({
            preset: z.literal(APP_GUI_PRESET),
            entry: z.literal("src/main.tsx"),
            stylesheet: z.literal("src/styles.css"),
            iconLibrary: z.enum(["lucide", "phosphor"]),
          })
          .strict()
          .optional(),
        preferences: z
          .object({
            schema: z.literal("gui/preferences.schema.json"),
            schemaVersion: z.number().int().positive(),
            schemaDigest: sha256DigestSchema,
            defaults: z.literal("gui/preferences.defaults.json"),
            defaultsDigest: sha256DigestSchema,
            maxBytes: z.literal(65_536),
          })
          .strict()
          .optional(),
      })
      .strict()
      .superRefine((gui, context) => {
        const requested = gui.capabilities.includes("workspace-read");
        if (requested !== (gui.capabilityScopes?.workspaceRead === "design/")) {
          context.addIssue({
            code: "custom",
            message: "workspace-read capability and design/ scope must be declared together",
          });
        }
        if (gui.preferences && !gui.build) {
          context.addIssue({
            code: "custom",
            path: ["preferences"],
            message: "App preferences require the compiled bottega-react-v1 profile",
          });
        }
        if (gui.hostActions?.includes("file.export") && !gui.build) {
          context.addIssue({
            code: "custom",
            path: ["hostActions"],
            message: "file.export requires the compiled bottega-react-v1 profile",
          });
        }
      })
      .optional(),
  })
  .strict();

export const appManifestSchema = z.discriminatedUnion("kind", [
  staticManifestSchema,
  serverManifestSchema,
  baseManifestSchema,
]).superRefine((manifest, context) => {
  if (manifest.kind === "base" || manifest.executionSchemaVersion !== 1) return;
  const commands = [manifest.installCmd, manifest.buildCmd, ...(manifest.kind === "server" ? [manifest.startCmd] : [])];
  if (commands.some((command) => typeof command === "string")) context.addIssue({ code: "custom", message: "Versioned manifests require structured commands" });
});
