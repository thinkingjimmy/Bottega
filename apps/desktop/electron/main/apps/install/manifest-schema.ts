/**
 * [INPUT]: Depends on zod and the AppManifest field contract for shared/apps-ipc
 * [OUTPUT]: Provides static/server/Base manifests, including compiled GUI build/preferences identities, host actions, extension requirements, and isomorphic JSON Schema
 * [POS]: The free-of-charge agreement for apps/install; App with component identity reference capability to support pre-freeze installation with selected source
 */

import { z } from "zod";

const sha256DigestSchema = z
  .string()
  .regex(/^sha256:[a-f0-9]{64}$/)
  .transform((value) => value as `sha256:${string}`);

// ============================================================
// zod 与 JSON Schema 是同一契约的两种表示，字段必须逐一对应
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
        message: "config requirement 必须提供 configKey",
      });
    }
    if (requirement.kind !== "config" && requirement.configKey) {
      context.addIssue({
        code: "custom",
        path: ["configKey"],
        message: "只有 config requirement 可以提供 configKey",
      });
    }
  });

const requirementsSchema = z
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
          message: `requirement id 重复：${requirement.id}`,
        });
      }
      ids.add(requirement.id);
      if (!requirement.configKey) return;
      const canonical = requirement.configKey.toUpperCase();
      if (configKeys.has(canonical)) {
        context.addIssue({
          code: "custom",
          path: ["tools", index, "configKey"],
          message: `configKey 大小写冲突：${requirement.configKey}`,
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
                  message: "requestedConfig 不得内联执行、网络、prompt 或 tool schema",
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
            message: `extension declaredComponentIdentity 重复：${requirement.declaredComponentIdentity}`,
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
    installCmd: z.string().trim().min(1).max(2_000),
    buildCmd: z.string().trim().min(1).max(2_000).nullable(),
    staticDir: z.string().trim().min(1).max(500),
    healthPath: z.string().regex(/^\/([^/]|$)/).max(500),
    agentRequirements,
  })
  .strict();

const serverManifestSchema = z
  .object({
    ...common,
    kind: z.literal("server"),
    installCmd: z.string().trim().min(1).max(2_000),
    buildCmd: z.string().trim().min(1).max(2_000).nullable(),
    startCmd: z.string().trim().min(1).max(2_000),
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
        "serveAgentPrompt、serveTrigger 与 agentRequirements 必须同时存在或同时为 null",
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
            preset: z.literal("bottega-react-v1"),
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
]);

const commonJsonProperties = {
  name: { type: "string", minLength: 1, maxLength: 120 },
  description: { type: "string", minLength: 1, maxLength: 500 },
  icon: { type: "string", minLength: 1, maxLength: 16 },
  requirements: {
    anyOf: [
      { type: "null" },
      {
        type: "object",
        additionalProperties: false,
        required: ["tools"],
        properties: {
          tools: {
            type: "array",
            maxItems: 100,
            items: {
              type: "object",
              additionalProperties: false,
              required: [
                "id",
                "kind",
                "label",
                "note",
                "required",
              ],
              properties: {
                id: { type: "string", minLength: 1, maxLength: 120 },
                kind: { type: "string", enum: ["cli", "mcp", "config"] },
                label: { type: "string", minLength: 1, maxLength: 120 },
                note: { type: "string", maxLength: 500 },
                required: { type: "boolean" },
                sensitive: { type: "boolean" },
                configKey: {
                  type: "string",
                  minLength: 1,
                  maxLength: 120,
                },
              },
            },
          },
        },
      },
    ],
  },
  extensionRequirements: {
    type: "array",
    maxItems: 100,
    items: {
      type: "object",
      additionalProperties: false,
      required: ["declaredComponentIdentity", "required"],
      properties: {
        declaredComponentIdentity: { type: "string", minLength: 3, maxLength: 300 },
        packageDigest: {
          type: "string",
          pattern: "^sha256:[a-f0-9]{64}$",
        },
        versionRange: { type: "string", minLength: 1, maxLength: 120 },
        required: { type: "boolean" },
        requestedConfig: { type: "object" },
        source: {
          type: "object",
          additionalProperties: false,
          required: ["repoUrl"],
          properties: {
            repoUrl: { type: "string", pattern: "^https://github\\.com/" },
            ref: { type: "string", minLength: 1, maxLength: 200 },
          },
        },
      },
    },
  },
} as const;

const agentRequirementsJson = {
  anyOf: [
    { type: "null" },
    {
      type: "object",
      additionalProperties: false,
      required: ["mcpServers", "skills"],
      properties: {
        mcpServers: {
          type: "array",
          maxItems: 50,
          items: { type: "string", minLength: 1, maxLength: 120 },
        },
        skills: {
          type: "array",
          maxItems: 100,
          items: { type: "string", minLength: 1, maxLength: 120 },
        },
      },
    },
  ],
} as const;

export const APP_MANIFEST_JSON_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  anyOf: [
    {
      type: "object",
      additionalProperties: false,
      required: [
        "kind",
        "name",
        "description",
        "icon",
        "requirements",
        "installCmd",
        "buildCmd",
        "staticDir",
        "healthPath",
        "agentRequirements",
      ],
      properties: {
        ...commonJsonProperties,
        kind: { const: "static" },
        installCmd: { type: "string", minLength: 1, maxLength: 2_000 },
        buildCmd: { type: ["string", "null"], maxLength: 2_000 },
        staticDir: { type: "string", minLength: 1, maxLength: 500 },
        healthPath: {
          type: "string",
          pattern: "^/([^/]|$)",
          maxLength: 500,
        },
        agentRequirements: agentRequirementsJson,
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: [
        "kind",
        "name",
        "description",
        "icon",
        "requirements",
        "installCmd",
        "buildCmd",
        "startCmd",
        "healthPath",
        "serveAgentPrompt",
        "serveTrigger",
        "agentRequirements",
      ],
      properties: {
        ...commonJsonProperties,
        kind: { const: "server" },
        installCmd: { type: "string", minLength: 1, maxLength: 2_000 },
        buildCmd: { type: ["string", "null"], maxLength: 2_000 },
        startCmd: { type: "string", minLength: 1, maxLength: 2_000 },
        healthPath: {
          type: "string",
          pattern: "^/([^/]|$)",
          maxLength: 500,
        },
        serveAgentPrompt: {
          type: ["string", "null"],
          maxLength: 10_000,
        },
        serveTrigger: {
          anyOf: [
            { type: "null" },
            {
              type: "object",
              additionalProperties: false,
              required: ["watchPath"],
              properties: {
                watchPath: {
                  type: "string",
                  minLength: 1,
                  maxLength: 500,
                },
              },
            },
          ],
        },
        agentRequirements: agentRequirementsJson,
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: [
        "kind",
        "packageSchemaVersion",
        "name",
        "description",
        "icon",
        "requirements",
      ],
      properties: {
        ...commonJsonProperties,
        kind: { const: "base" },
        packageSchemaVersion: { const: 2 },
        gui: {
          type: "object",
          additionalProperties: false,
          required: ["capabilities"],
          properties: {
            capabilities: {
              type: "array",
              uniqueItems: true,
              maxItems: 5,
              items: {
                enum: ["row-insert", "row-patch", "row-delete", "attachment-read", "workspace-read"],
              },
            },
            hostActions: {
              type: "array",
              uniqueItems: true,
              maxItems: 2,
              items: { enum: ["compose-text", "file.export"] },
            },
            capabilityScopes: {
              type: "object",
              additionalProperties: false,
              properties: { workspaceRead: { const: "design/" } },
            },
            build: {
              type: "object",
              additionalProperties: false,
              required: ["preset", "entry", "stylesheet", "iconLibrary"],
              properties: {
                preset: { const: "bottega-react-v1" },
                entry: { const: "src/main.tsx" },
                stylesheet: { const: "src/styles.css" },
                iconLibrary: { enum: ["lucide", "phosphor"] },
              },
            },
            preferences: {
              type: "object",
              additionalProperties: false,
              required: [
                "schema",
                "schemaVersion",
                "schemaDigest",
                "defaults",
                "defaultsDigest",
                "maxBytes",
              ],
              properties: {
                schema: { const: "gui/preferences.schema.json" },
                schemaVersion: { type: "integer", minimum: 1 },
                schemaDigest: { type: "string", pattern: "^sha256:[a-f0-9]{64}$" },
                defaults: { const: "gui/preferences.defaults.json" },
                defaultsDigest: { type: "string", pattern: "^sha256:[a-f0-9]{64}$" },
                maxBytes: { const: 65_536 },
              },
            },
          },
        },
      },
    },
  ],
} as const;
