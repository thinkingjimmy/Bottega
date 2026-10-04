/**
 * [INPUT]: No runtime dependencies; the corpus is inline plugin/skill/host-package file literals with expected verdicts
 * [OUTPUT]: Provides ADMISSION_CONFORMANCE_CORPUS, consumed by the conformance suite and digested into VALIDATOR_FIXTURE_DIGEST
 * [POS]: The only source of truth for extensions/conformance content; any change to it is a change of admission evidence
 */

const skill = (name = "fixture") =>
  `---\nname: ${name}\ndescription: Fixture skill\n---\n\n# Fixture\n`;

const plugin = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
    name: "fixture-plugin",
    ...extra,
  });

const host = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    schema: "bottega.host-package/v1", packageId: "bottega.fixture", packageVersion: "1.0.0", family: "host-package",
    presentation: "plugin", displayName: "Fixture host package", entries: { bridge: "dist/bridge.mjs" }, uiDelivery: "none",
    provides: [{ contract: "bottega.fixture.echo/v1", actions: ["echo"] }], requires: ["bottega.operations/v1"],
    permissions: { executionTrust: "explicitly-trusted-code", requestedCapabilities: ["storage.own-namespace"] },
    ...extra,
  });
const bridge = "export function activate() { return {}; }\n";

export const ADMISSION_CONFORMANCE_CORPUS = [
  {
    id: "plugin-minimal",
    adapterId: "agent-plugins-1.0.0",
    files: { "plugin.json": plugin(), "skills/fixture/SKILL.md": skill() },
    expected: { valid: true, skills: 1, mcp: 0, reports: 0 },
  },
  {
    id: "plugin-unknown-field",
    adapterId: "agent-plugins-1.0.0",
    files: {
      "plugin.json": plugin({ futureField: true }),
      "skills/fixture/SKILL.md": skill(),
    },
    expected: { valid: true, skills: 1, mcp: 0, reports: 1 },
  },
  {
    id: "plugin-unsupported-version",
    adapterId: "agent-plugins-1.0.0",
    files: {
      "plugin.json": JSON.stringify({ $schema: "https://example.com/v2", name: "fixture-plugin" }),
    },
    expected: { valid: false, skills: 0, mcp: 0, reports: 0, errors: 1, code: "unsupported-version" },
  },
  {
    id: "plugin-body-name-constraint",
    adapterId: "agent-plugins-1.0.0",
    files: { "plugin.json": plugin({ name: "bad--name" }) },
    expected: { valid: false, skills: 0, mcp: 0, reports: 0, errors: 1 },
  },
  {
    id: "plugin-mcp-isolated",
    adapterId: "agent-plugins-1.0.0",
    files: {
      "plugin.json": plugin(),
      "skills/fixture/SKILL.md": skill(),
      "mcp.json": "{}",
    },
    expected: { valid: true, skills: 1, mcp: 0, reports: 0, errors: 1 },
  },
  {
    id: "plugin-mcp-version-isolated",
    adapterId: "agent-plugins-1.0.0",
    files: {
      "plugin.json": plugin(),
      "skills/fixture/SKILL.md": skill(),
      "mcp.json": JSON.stringify({ $schema: "https://example.com/mcp-v2", mcpServers: {} }),
    },
    expected: { valid: true, skills: 1, mcp: 0, reports: 0, errors: 1 },
  },
  {
    id: "plugin-mcp-server-isolated",
    adapterId: "agent-plugins-1.0.0",
    files: {
      "plugin.json": plugin(),
      "mcp.json": JSON.stringify({
        $schema: "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
        mcpServers: {
          good: { type: "streamable-http", url: "https://example.com/mcp" },
          bad: { type: "stdio", command: "../escape" },
        },
      }),
    },
    expected: { valid: true, skills: 0, mcp: 1, reports: 0, errors: 1 },
  },
  {
    id: "plugin-stdio-env-isolated",
    adapterId: "agent-plugins-1.0.0",
    files: {
      "plugin.json": plugin(),
      "mcp.json": JSON.stringify({
        $schema: "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
        mcpServers: {
          good: { type: "stdio", command: "node", cwd: "${PLUGIN_DATA}/cache" },
          bad: { type: "stdio", command: "node", env: { PLUGIN_ROOT: "x" } },
        },
      }),
    },
    expected: { valid: true, skills: 0, mcp: 1, reports: 0, errors: 1 },
  },
  {
    id: "plugin-cwd-containment",
    adapterId: "agent-plugins-1.0.0",
    files: {
      "plugin.json": plugin(),
      "mcp.json": JSON.stringify({
        $schema: "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
        mcpServers: {
          good: { type: "stdio", command: "node", cwd: "${PLUGIN_ROOT}/skills" },
          bad: { type: "stdio", command: "node", cwd: "${PLUGIN_ROOT}/../escape" },
        },
      }),
      "skills/fixture/SKILL.md": skill(),
    },
    expected: { valid: true, skills: 1, mcp: 1, reports: 0, errors: 1 },
  },
  {
    id: "plugin-remote-url-header",
    adapterId: "agent-plugins-1.0.0",
    files: {
      "plugin.json": plugin(),
      "mcp.json": JSON.stringify({
        $schema: "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
        mcpServers: {
          good: { type: "streamable-http", url: "http://127.0.0.1:8080/mcp", headers: { "x-mode": "test" } },
          badUrl: { type: "sse", url: "http://example.com/events" },
          badHeader: { type: "sse", url: "https://example.com/events", headers: { "bad header": "x" } },
        },
      }),
    },
    expected: { valid: true, skills: 0, mcp: 1, reports: 0, errors: 2 },
  },
  {
    id: "skill-repo-minimal",
    adapterId: "skill-repo-1.0.0",
    files: { "skills/fixture/SKILL.md": skill() },
    expected: { valid: true, skills: 1, mcp: 0, reports: 0 },
  },
  {
    id: "skill-repo-no-skill",
    adapterId: "skill-repo-1.0.0",
    files: { "README.md": "nothing here" },
    expected: { valid: false, skills: 0, mcp: 0, reports: 0, errors: 1 },
  },
  {
    id: "host-minimal",
    adapterId: "bottega-host-package-1",
    files: { "bottega.extension.json": host(), "dist/bridge.mjs": bridge },
    expected: { valid: true, skills: 0, mcp: 0, reports: 0, hosts: 1 },
  },
  {
    id: "host-service-and-surface",
    adapterId: "bottega-host-package-1",
    files: { "bottega.extension.json": host({ entries: { service: "dist/service.mjs", ui: "dist/ui.js" }, uiDelivery: "isolated-surface" }),
      "dist/service.mjs": bridge, "dist/ui.js": "export {};\n" },
    expected: { valid: true, skills: 0, mcp: 0, reports: 0, hosts: 2 },
  },
  {
    id: "host-example-only-refused",
    adapterId: "bottega-host-package-1",
    files: { "bottega.extension.json": host({ exampleOnly: true }), "dist/bridge.mjs": bridge },
    expected: { valid: false, skills: 0, mcp: 0, reports: 0, errors: 1, hosts: 0 },
  },
  {
    id: "host-with-app-json-refused",
    adapterId: "bottega-host-package-1",
    files: { "bottega.extension.json": host(), "dist/bridge.mjs": bridge, "app.json": "{}" },
    expected: { valid: false, skills: 0, mcp: 0, reports: 0, errors: 1, hosts: 0 },
  },
  {
    id: "host-with-plugin-json-refused",
    adapterId: "bottega-host-package-1",
    files: { "bottega.extension.json": host(), "dist/bridge.mjs": bridge, "plugin.json": plugin() },
    expected: { valid: false, skills: 0, mcp: 0, reports: 0, errors: 1, hosts: 0 },
  },
  {
    id: "host-entry-missing-refused",
    adapterId: "bottega-host-package-1",
    files: { "bottega.extension.json": host() },
    expected: { valid: false, skills: 0, mcp: 0, reports: 0, errors: 1, hosts: 0 },
  },
  {
    id: "host-entry-escape-refused",
    adapterId: "bottega-host-package-1",
    files: { "bottega.extension.json": host({ entries: { bridge: "../outside.mjs" } }), "dist/bridge.mjs": bridge },
    expected: { valid: false, skills: 0, mcp: 0, reports: 0, errors: 1, hosts: 0 },
  },
  {
    id: "host-trusted-build-needs-app",
    adapterId: "bottega-host-package-1",
    files: { "bottega.extension.json": host({ entries: { bridge: "dist/bridge.mjs", ui: "dist/ui.js" }, uiDelivery: "trusted-build" }),
      "dist/bridge.mjs": bridge, "dist/ui.js": "export {};\n" },
    expected: { valid: false, skills: 0, mcp: 0, reports: 0, errors: 1, hosts: 0 },
  },
] as const;
