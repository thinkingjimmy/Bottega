/**
 * [INPUT]: Depends on canonical JSON serialization and the v1 bounded JSON Schema subset
 * [OUTPUT]: Provides strict preference schema/value validation with bounds, forbidden keys, and canonical byte accounting
 * [POS]: Shared main-side semantic authority for compiler validation and durable preference writes
 */

import { canonicalJson } from "../gui-build/metadata";

const ALLOWED_SCHEMA_KEYS = new Set([
  "type", "properties", "required", "additionalProperties", "enum", "default",
  "items", "minItems", "maxItems", "minimum", "maximum", "minLength", "maxLength",
]);
const VALUE_TYPES = new Set(["object", "array", "string", "number", "integer", "boolean"]);
const FORBIDDEN_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const MAX_DEPTH = 8;
const MAX_PROPERTIES = 128;
const MAX_ARRAY = 256;

export type PreferenceJsonSchema = Readonly<Record<string, unknown>>;

export function validatePreferenceSchema(value: unknown): value is PreferenceJsonSchema {
  return validateSchemaNode(value, 0, { properties: 0 });
}

export function validatePreferenceValue(value: unknown, schema: unknown) {
  return validateValueNode(value, schema, 0, new Set());
}

export function preferenceBytes(value: unknown) {
  return Buffer.byteLength(canonicalJson(value), "utf8");
}

function validateSchemaNode(value: unknown, depth: number, budget: { properties: number }): value is PreferenceJsonSchema {
  if (!isRecord(value) || depth > MAX_DEPTH) return false;
  if (!Object.keys(value).every((key) => ALLOWED_SCHEMA_KEYS.has(key))) return false;
  if (!VALUE_TYPES.has(String(value.type))) return false;
  if (value.enum !== undefined && (!Array.isArray(value.enum) || !value.enum.length || value.enum.length > 64)) return false;
  if (value.type === "object") {
    if (value.additionalProperties !== false || !isRecord(value.properties)) return false;
    const propertyMap = value.properties;
    const properties = Object.entries(propertyMap);
    budget.properties += properties.length;
    if (budget.properties > MAX_PROPERTIES || properties.some(([key]) => FORBIDDEN_KEYS.has(key))) return false;
    if (value.required !== undefined) {
      if (!Array.isArray(value.required) || new Set(value.required).size !== value.required.length) return false;
      if (value.required.some((key) => typeof key !== "string" || !(key in propertyMap))) return false;
    }
    return properties.every(([, child]) => validateSchemaNode(child, depth + 1, budget));
  }
  if (value.type === "array") {
    if (!validateSchemaNode(value.items, depth + 1, budget)) return false;
    return optionalInteger(value.minItems, 0, MAX_ARRAY) && optionalInteger(value.maxItems, 0, MAX_ARRAY) && ordered(value.minItems, value.maxItems);
  }
  if (value.type === "string") {
    return optionalInteger(value.minLength, 0, 4_096) && optionalInteger(value.maxLength, 0, 4_096) && ordered(value.minLength, value.maxLength);
  }
  if (value.type === "number" || value.type === "integer") {
    return optionalFinite(value.minimum) && optionalFinite(value.maximum) && ordered(value.minimum, value.maximum);
  }
  return true;
}

function validateValueNode(value: unknown, schema: unknown, depth: number, seen: Set<object>): boolean {
  if (!isRecord(schema) || depth > MAX_DEPTH) return false;
  if (value && typeof value === "object") {
    if (seen.has(value)) return false;
    seen.add(value);
  }
  try {
    if (Array.isArray(schema.enum) && !schema.enum.some((item) => canonicalJson(item) === canonicalJson(value))) return false;
    if (schema.type === "object") {
      if (!isRecord(value) || !isRecord(schema.properties)) return false;
      const properties = schema.properties;
      const required = new Set(Array.isArray(schema.required) ? schema.required : []);
      if ([...required].some((key) => typeof key !== "string" || !(key in value))) return false;
      return Object.entries(value).every(([key, child]) =>
        !FORBIDDEN_KEYS.has(key) && key in properties && validateValueNode(child, properties[key], depth + 1, seen));
    }
    if (schema.type === "array") {
      return Array.isArray(value) && within(value.length, schema.minItems, schema.maxItems) &&
        value.every((item) => validateValueNode(item, schema.items, depth + 1, seen));
    }
    if (schema.type === "string") return typeof value === "string" && within([...value].length, schema.minLength, schema.maxLength);
    if (schema.type === "number") return typeof value === "number" && Number.isFinite(value) && within(value, schema.minimum, schema.maximum);
    if (schema.type === "integer") return typeof value === "number" && Number.isSafeInteger(value) && within(value, schema.minimum, schema.maximum);
    return schema.type === "boolean" && typeof value === "boolean";
  } finally {
    if (value && typeof value === "object") seen.delete(value);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function optionalInteger(value: unknown, minimum: number, maximum: number) {
  return value === undefined || (Number.isSafeInteger(value) && Number(value) >= minimum && Number(value) <= maximum);
}

function optionalFinite(value: unknown) {
  return value === undefined || (typeof value === "number" && Number.isFinite(value));
}

function ordered(minimum: unknown, maximum: unknown) {
  return minimum === undefined || maximum === undefined || Number(minimum) <= Number(maximum);
}

function within(value: number, minimum: unknown, maximum: unknown) {
  return (minimum === undefined || value >= Number(minimum)) && (maximum === undefined || value <= Number(maximum));
}
