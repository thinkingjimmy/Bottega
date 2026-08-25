/**
 * [INPUT]: No running time dependence; The content of the content is a mix of the following:
 * [OUTPUT]: Provides ADMISSION_CONFORMANCE_CORPUS for use in pairs of test scores and evidence digest
 * [POS]: The only true source of extensions/conformance content; Subject change is admission evidence change
 */

const skill = (name = "fixture") =>
  `---\nname: ${name}\ndescription: Fixture skill\n---\n\n# Fixture\n`;

const plugin = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
    name: "fixture-plugin",
    ...extra,
  });

export const ADMISSION_CONFORMANCE_CORPUS = [
  {
    id: "plugin-minimal",
    adapterId: "agent-plugins-1.0.0-wd",
    files: { "plugin.json": plugin(), "skills/fixture/SKILL.md": skill() },
    expected: { valid: true, skills: 1, mcp: 0, reports: 0 },
  },
  {
    id: "plugin-unknown-field",
    adapterId: "agent-plugins-1.0.0-wd",
    files: {
      "plugin.json": plugin({ futureField: true }),
      "skills/fixture/SKILL.md": skill(),
    },
    expected: { valid: true, skills: 1, mcp: 0, reports: 1 },
  },
  {
    id: "plugin-unsupported-version",
    adapterId: "agent-plugins-1.0.0-wd",
    files: {
      "plugin.json": JSON.stringify({ $schema: "https://example.com/v2", name: "fixture-plugin" }),
    },
    expected: { valid: false, skills: 0, mcp: 0, reports: 0, errors: 1, code: "unsupported-version" },
  },
  {
    id: "plugin-body-name-constraint",
    adapterId: "agent-plugins-1.0.0-wd",
    files: { "plugin.json": plugin({ name: "bad--name" }) },
    expected: { valid: false, skills: 0, mcp: 0, reports: 0, errors: 1 },
  },
  {
    id: "plugin-mcp-isolated",
    adapterId: "agent-plugins-1.0.0-wd",
    files: {
      "plugin.json": plugin(),
      "skills/fixture/SKILL.md": skill(),
      "mcp.json": "{}",
    },
    expected: { valid: true, skills: 1, mcp: 0, reports: 0, errors: 1 },
  },
  {
    id: "plugin-mcp-version-isolated",
    adapterId: "agent-plugins-1.0.0-wd",
    files: {
      "plugin.json": plugin(),
      "skills/fixture/SKILL.md": skill(),
      "mcp.json": JSON.stringify({ $schema: "https://example.com/mcp-v2", mcpServers: {} }),
    },
    expected: { valid: true, skills: 1, mcp: 0, reports: 0, errors: 1 },
  },
  {
    id: "plugin-mcp-server-isolated",
    adapterId: "agent-plugins-1.0.0-wd",
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
    adapterId: "agent-plugins-1.0.0-wd",
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
    adapterId: "agent-plugins-1.0.0-wd",
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
    adapterId: "agent-plugins-1.0.0-wd",
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
] as const;
