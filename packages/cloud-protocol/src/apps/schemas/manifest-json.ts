/**
 * [INPUT]: Depends on zod's JSON Schema emitter, the App command schema and the GUI preset constant.
 * [OUTPUT]: Provides appManifestJsonSchema(), the authored App manifest as JSON Schema, built on first use.
 * [POS]: Kept apart from manifest.ts so the JSON Schema emitter is not loaded wherever manifests are parsed; the desktop loads this module lazily when it writes the schema file (OPT-34 budget).
 */
import { z } from "zod";
import { APP_GUI_PRESET } from "./constants";
import { appCommandSchema } from "./command";

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

const manifestJsonSchema = (command: unknown) => ({
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
        executionSchemaVersion: { const: 1 },
        installCmd: { anyOf: [command, { type: "null" }] },
        buildCmd: { anyOf: [command, { type: "null" }] },
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
        executionSchemaVersion: { const: 1 },
        installCmd: { anyOf: [command, { type: "null" }] },
        buildCmd: { anyOf: [command, { type: "null" }] },
        startCmd: command,
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
                preset: { const: APP_GUI_PRESET },
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
}) as const;

let cached: ReturnType<typeof manifestJsonSchema> | null = null;
export function appManifestJsonSchema() {
  return cached ??= manifestJsonSchema(z.toJSONSchema(appCommandSchema, { unrepresentable: "any", io: "input" }));
}
