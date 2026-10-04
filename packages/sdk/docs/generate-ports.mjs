/**
 * [INPUT]: Public contract schemas, installed Zod and Node filesystem APIs.
 * [OUTPUT]: Generates and checks the canonical public port reference.
 * [POS]: SDK documentation generation; reference details derive from the validated contracts.
 */
/* Generates docs/ports.md from the contract schemas, so the reference cannot drift from what the host validates.

   node --import tsx docs/generate-ports.mjs          rewrites docs/ports.md
   node --import tsx docs/generate-ports.mjs --check  exits 1 when docs/ports.md differs from what the schemas produce

   JSON Schema cannot say everything a schema checks: cross-field rules (a zod refinement) are listed by name under each
   schema, so a reader sees every rule the host applies. */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
/* The contracts package: a sibling in the monorepo (packages/sdk/contracts), under packages/ in the SDK repository. */
const contracts = [join(here, "..", "contracts"), join(here, "..", "packages", "contracts")].find((path) => existsSync(join(path, "package.json")));
if (!contracts) throw new Error("generate-ports: @bottega/contracts not found next to docs/");
/* The zod the contracts were written against, wherever this runs (the monorepo or the SDK repository). */
const { z } = await import(createRequire(join(contracts, "package.json")).resolve("zod"));
const manifest = await import(join(contracts, "src", "host", "manifest.ts"));
const records = await import(join(contracts, "src", "base", "records.ts"));
const ports = await import(join(contracts, "src", "host", "ports.ts"));
const providerSource = join(contracts, "src", "model", "provider.ts");
const provider = await import(providerSource);
/* Field documentation lives in JSDoc, which a zod schema does not carry: read it from the source with the compiler the
   contracts are built with. */
const { default: ts } = await import(createRequire(join(contracts, "package.json")).resolve("typescript"));

/** The JSDoc of a `const name = z.object({...})` declaration and of each of its top-level fields. */
function schemaDocs(file, name) {
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const jsdoc = (node) => ts.getJSDocCommentsAndTags(node).filter(ts.isJSDoc)
    .map((doc) => ts.getTextOfJSDocComment(doc.comment) ?? "").join(" ").replace(/\s+/g, " ").trim();
  let found = null;
  const objectLiteral = (node) => {
    let literal = null;
    const walk = (child) => {
      if (literal) return;
      if (ts.isCallExpression(child) && ts.isPropertyAccessExpression(child.expression) && child.expression.name.text === "object"
        && child.arguments[0] && ts.isObjectLiteralExpression(child.arguments[0])) { literal = child.arguments[0]; return; }
      ts.forEachChild(child, walk);
    };
    walk(node);
    return literal;
  };
  const visit = (node) => {
    if (found) return;
    if (ts.isVariableDeclaration(node) && node.name.getText() === name) {
      const literal = objectLiteral(node.initializer);
      if (!literal) throw new Error(`generate-ports: ${name} is not a z.object literal`);
      found = { doc: jsdoc(node.parent.parent), fields: new Map(literal.properties.filter(ts.isPropertyAssignment).map((property) => [property.name.getText(), jsdoc(property)])) };
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (!found) throw new Error(`generate-ports: ${name} not found in ${file}`);
  return found;
}

/** A field table: each top-level field of a schema, whether it is required, and its JSDoc. */
function fieldTable(schema, docs) {
  const json = z.toJSONSchema(schema, { io: "input", unrepresentable: "any" });
  const required = new Set(json.required ?? []);
  return ["| Field | Required | Meaning |", "| --- | --- | --- |",
    ...Object.keys(json.properties).map((field) => `| \`${field}\` | ${required.has(field) ? "yes" : "no"} | ${docs.fields.get(field) || "—"} |`), ""];
}

/** Every refinement message in a schema tree, with the path it applies to. */
function rules(schema, path = "") {
  const def = schema?._zod?.def;
  if (!def) return [];
  const own = (def.checks ?? []).filter((check) => check._zod?.def?.check === "custom").flatMap((check) => {
    const message = check._zod.def.error?.({});
    return typeof message === "string" ? [`\`${message}\`${path ? ` (at \`${path}\`)` : ""}`] : [];
  });
  const child = (inner, suffix = "") => rules(inner, `${path}${suffix}`);
  switch (def.type) {
    case "object": return own.concat(Object.entries(def.shape).flatMap(([key, value]) => child(value, path ? `.${key}` : key)));
    case "array": return own.concat(child(def.element, "[]"));
    case "optional": case "nullable": case "default": case "prefault": case "readonly": return own.concat(child(def.innerType));
    case "pipe": return own.concat(child(def.in));
    case "union": return own.concat(def.options.flatMap((option) => child(option)));
    default: return own;
  }
}

function section(title, schema, note) {
  const json = z.toJSONSchema(schema, { io: "input", unrepresentable: "any" });
  delete json.$schema;
  const found = rules(schema);
  return [
    `### ${title}`, "", ...(note ? [note, ""] : []),
    "```json", JSON.stringify(json, null, 2), "```", "",
    ...(found.length ? ["Also checked (rules JSON Schema cannot express):", "", ...found.map((rule) => `- ${rule}`), ""] : []),
  ];
}

/* What each port limit measures; a new limit without a meaning here fails the generator instead of going unexplained. */
const LIMIT_MEANING = {
  keys: "Stored keys per package.",
  keyChars: "Characters per key.",
  valueBytes: "One stored value, as `portJsonBytes` (UTF-8 bytes of `JSON.stringify(value)`).",
  totalBytes: "Everything a package stores, as `portStorageBytes` (each key's UTF-8 bytes plus its value's `portJsonBytes`).",
  listPage: "Keys per `storage.list` page.",
  subscribersPerContract: "Subscribers of one contract, counted across all packages.",
  eventBytes: "One event payload, as `portJsonBytes`.",
};
const missingMeaning = (name) => { throw new Error(`generate-ports: no meaning written for port limit ${name}`); };

/* One entry per Base operation; a new operation without an entry here fails the generator instead of going undocumented. */
const BASE_INPUTS = {
  describe: records.describeInputSchema, query: records.queryInputSchema, read: records.readInputSchema,
  insert: records.rowsInsertInputSchema, patch: records.rowsPatchInputSchema, delete: records.rowsDeleteInputSchema,
  writeFields: records.writeFieldsInputSchema, attachment: records.attachmentInputSchema, report: records.reportInputSchema,
  results: records.resultsInputSchema, result: records.resultReadInputSchema,
};
const providerDocs = schemaDocs(providerSource, "providerDescriptorSchema");
const missing = Object.keys(records.BASE_OPERATIONS).filter((key) => !(key in BASE_INPUTS));
if (missing.length) throw new Error(`generate-ports: no input schema mapped for Base operation(s) ${missing.join(", ")}`);

const lines = [
  "# Ports reference",
  "",
  "Generated from `@bottega/contracts` by `docs/generate-ports.mjs`; do not edit by hand. 0.x is a host protocol preview: these shapes can change between minor versions until installs open.",
  "",
  "## Package manifest",
  "",
  `Every host package has \`${manifest.HOST_PACKAGE_MANIFEST}\` at its root. The host reads it before anything runs and refuses a package it does not match.`,
  "",
  ...section(`\`${manifest.HOST_PACKAGE_MANIFEST}\` (\`${manifest.HOST_PACKAGE_SCHEMA_ID}\`)`, manifest.hostPackageManifestSchema),
  "In 0.x a package's UI is not loaded. Declare `\"uiDelivery\": \"none\"` and no `entries.ui`; UI delivery comes in a later version.",
  "",
  "## Package ports",
  "",
  "Every host package can call these through `api.call(operation, input, refs)`. Storage is the package's own; no other package can read it. Events travel only on contracts a package declares: it publishes on contracts in `provides` and subscribes to contracts in `requires`.",
  "",
  "A contract is Bottega-defined: `bottega.<name>/v<n>`. In 0.x packages talk to each other only through contracts Bottega defines; other namespaces are refused.",
  "",
  "Stored values and event payloads must be strict JSON: no `undefined`, `NaN`, `Infinity`, `-0`, unsafe integers, lone surrogates, sparse arrays, accessors or objects that are not plain. `portJsonBytes` and `portStorageBytes` from `@bottega/contracts/host/ports` compute the byte limits exactly as the host does.",
  "",
  "| Limit | Value | Measures |",
  "| --- | --- | --- |",
  ...Object.entries(ports.PACKAGE_PORT_LIMITS).map(([name, value]) => `| \`${name}\` | ${value.toLocaleString("en-US")} | ${LIMIT_MEANING[name] ?? missingMeaning(name)} |`),
  "",
  ...Object.entries(ports.PACKAGE_PORT_INPUTS).flatMap(([operation, schema]) => section(`\`${operation}\``, schema, "Input:")),
  ...section("Delivered event", ports.packageEventSchema, "A subscriber receives each event as a call to its `event` handler. `from` names the publisher by an opaque handle: stable for this subscriber and that publisher, never an install identity, and different for every subscriber."),
  "## Provider descriptor",
  "",
  "A package that runs an Agent CLI (a manifest with `provider`) describes that CLI with a descriptor. The descriptor declares what the CLI can do; it never proves it. The host measures capabilities on each computer, and only measured ones count.",
  "",
  ...fieldTable(provider.providerDescriptorSchema, providerDocs),
  `**Home paths.** ${schemaDocs(providerSource, "homePathSchema").doc}`,
  "",
  `**Capabilities** (\`capabilities\`: each \`declared\` or \`unsupported\`): ${provider.PROVIDER_CAPABILITIES.map((name) => `\`${name}\``).join(", ")}.`,
  "",
  `**Purposes** (\`purposes\`: each \`native\`, \`host-fallback\` or \`unsupported\`): ${provider.PROVIDER_PURPOSES.map((name) => `\`${name}\``).join(", ")}.`,
  "",
  `**When a config field applies** (\`configFields[].appliesAt\`): ${provider.APPLIES_AT.map((name) => `\`${name}\``).join(", ")}.`,
  "",
  ...section("`bottega.provider-descriptor/v1`", provider.providerDescriptorSchema),
  ...section("Home path", provider.homePathSchema),
  "## Base records port",
  "",
  `Contracts: \`${records.BASE_RECORDS_CONTRACT}\` and \`${records.BOUND_RECORD_CONTRACT}\`. A package names the contract in \`requires\`, and calls each operation with \`api.call(operation, input, refs)\`; the first ref is the execution ref the host issued for the call.`,
  "",
  "| Limit | Value |",
  "| --- | --- |",
  ...Object.entries(records.BASE_PORT_LIMITS).map(([name, value]) => `| \`${name}\` | ${value.toLocaleString("en-US")} |`),
  "",
  ...Object.entries(records.BASE_OPERATIONS).flatMap(([key, operation]) => section(`\`${operation}\``, BASE_INPUTS[key], "Input:")),
  ...section("`base.query` output", records.queryOutputSchema, "A page is read from one revision; a different revision answers `gap`, and the reader starts again from the first page."),
];
const text = `${lines.join("\n").trimEnd()}\n`;
const target = join(here, "ports.md");
if (process.argv.includes("--check")) {
  let current = null;
  try { current = readFileSync(target, "utf8"); } catch { /* missing counts as drift */ }
  if (current !== text) { console.error("docs/ports.md is out of date: run node --import tsx docs/generate-ports.mjs"); process.exitCode = 1; }
  else console.log("docs/ports.md matches the schemas");
} else {
  writeFileSync(target, text);
  console.log(`wrote ${target}`);
}
