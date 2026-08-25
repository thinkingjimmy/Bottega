/**
 * [INPUT]: Depends on ACP form elicitation schema and shared Agent
 * [OUTPUT]: Provides form elicitation → Agent question mapping and answers → ACP content/decline response
 * [POS]: The structured translation questions of ACP turn transport; Claude AskUserQuestion is shared with MCP form, without a request lifecycle
 */

import type {
  CreateElicitationRequest,
  CreateElicitationResponse,
  ElicitationContentValue,
} from "@agentclientprotocol/sdk";
import type {
  AgentUserInputAnswers,
  AgentUserInputOption,
  AgentUserInputQuestion,
} from "../../../../../shared/agent-ipc";

type ElicitationFieldKind =
  | "string"
  | "number"
  | "integer"
  | "boolean"
  | "array";

type ElicitationField = {
  id: string;
  kind: ElicitationFieldKind;
  required: boolean;
  customKey?: string;
  options: Map<string, string>;
};

type FormRequest = {
  mode: "form";
  message: string;
  sessionId?: string;
  toolCallId?: string | null;
  requestedSchema: {
    title?: string | null;
    properties?: Record<string, unknown>;
    required?: string[] | null;
  };
};

type EnumEntry = {
  label: string;
  description: string;
  value: string;
};

type SupportedProperty = {
  type: ElicitationFieldKind;
  title?: string | null;
  description?: string | null;
  entries: EnumEntry[];
};

export type AcpElicitationMapping = {
  questions: AgentUserInputQuestion[];
  fields: ElicitationField[];
};

function stringValue(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function enumEntries(value: unknown): EnumEntry[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const entries = value.flatMap((option) => {
    if (typeof option === "string") {
      return [{ label: option, description: "", value: option }];
    }
    if (!option || typeof option !== "object") return [];
    const record = option as Record<string, unknown>;
    const label = stringValue(record.title);
    const constant = stringValue(record.const);
    if (!label || !constant) return [];
    return [{
      label,
      description: stringValue(record.description) ?? "",
      value: constant,
    }];
  });
  return entries.length === value.length ? entries : undefined;
}

function parseProperty(value: unknown): SupportedProperty | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const property = value as Record<string, unknown>;
  const type = property.type;
  if (
    type !== "string" &&
    type !== "number" &&
    type !== "integer" &&
    type !== "boolean" &&
    type !== "array"
  ) {
    return undefined;
  }
  let entries: EnumEntry[] = [];
  if (type === "string") {
    const configured =
      enumEntries(property.oneOf) ?? enumEntries(property.enum);
    if (property.oneOf !== undefined || property.enum !== undefined) {
      if (!configured) return undefined;
      entries = configured;
    }
  } else if (type === "array") {
    if (
      !property.items ||
      typeof property.items !== "object" ||
      Array.isArray(property.items)
    ) {
      return undefined;
    }
    const items = property.items as Record<string, unknown>;
    const configured =
      enumEntries(items.anyOf) ?? enumEntries(items.enum);
    if (!configured?.length) return undefined;
    entries = configured;
  } else if (type === "boolean") {
    entries = [
      { label: "是", description: "", value: "true" },
      { label: "否", description: "", value: "false" },
    ];
  }
  return {
    type,
    title: stringValue(property.title),
    description: stringValue(property.description),
    entries,
  };
}

function formRequest(request: CreateElicitationRequest): FormRequest | undefined {
  if (
    request.mode !== "form" ||
    !("requestedSchema" in request) ||
    !request.requestedSchema ||
    typeof request.requestedSchema !== "object" ||
    Array.isArray(request.requestedSchema)
  ) {
    return undefined;
  }
  const schema = request.requestedSchema as Record<string, unknown>;
  const properties =
    schema.properties &&
    typeof schema.properties === "object" &&
    !Array.isArray(schema.properties)
      ? (schema.properties as Record<string, unknown>)
      : undefined;
  const required =
    Array.isArray(schema.required) &&
    schema.required.every((entry) => typeof entry === "string")
      ? schema.required
      : undefined;
  return {
    mode: "form",
    message: request.message,
    ...("sessionId" in request && typeof request.sessionId === "string"
      ? { sessionId: request.sessionId }
      : {}),
    ...("toolCallId" in request && typeof request.toolCallId === "string"
      ? { toolCallId: request.toolCallId }
      : {}),
    requestedSchema: {
      title: stringValue(schema.title),
      ...(properties ? { properties } : {}),
      ...(required ? { required } : {}),
    },
  };
}

function enumOptions(
  property: SupportedProperty
): {
  options: AgentUserInputOption[];
  values: Map<string, string>;
} {
  return {
    options: property.entries.map(({ label, description }) => ({
      label,
      description,
    })),
    values: new Map(
      property.entries.map(({ label, value }) => [label, value])
    ),
  };
}

function fieldQuestion(
  request: FormRequest,
  key: string,
  property: SupportedProperty,
  fieldCount: number,
  customKey: string | undefined
) {
  const { options, values } = enumOptions(property);
  const required = request.requestedSchema.required?.includes(key) ?? false;
  const header = property.title ?? request.requestedSchema.title;
  const question: AgentUserInputQuestion = {
    id: key,
    ...(header ? { header } : {}),
    question:
      fieldCount === 1
        ? request.message
        : property.description ?? property.title ?? key,
    ...(options.length ? { options } : {}),
    ...(property.type === "array" ? { multiSelect: true } : {}),
    ...(required ? { required: true } : {}),
    ...(customKey ? { isOther: true } : {}),
  };
  return {
    question,
    field: {
      id: key,
      kind: property.type as ElicitationFieldKind,
      required,
      ...(customKey ? { customKey } : {}),
      options: values,
    } satisfies ElicitationField,
  };
}

export function mapAcpElicitation(
  request: CreateElicitationRequest
): AcpElicitationMapping | undefined {
  const form = formRequest(request);
  if (!form?.sessionId) return undefined;
  const properties = form.requestedSchema.properties ?? {};
  const entries = Object.entries(properties).filter(
    ([key]) => !key.endsWith("_custom")
  );
  if (entries.length === 0) return undefined;
  const mapped = entries.flatMap(([key, value]) => {
    const property = parseProperty(value);
    if (!property) return [];
    return [fieldQuestion(
      form,
      key,
      property,
      entries.length,
      parseProperty(properties[`${key}_custom`])?.type === "string"
        ? `${key}_custom`
        : undefined
    )];
  });
  if (mapped.length !== entries.length) return undefined;
  return {
    questions: mapped.map(({ question }) => question),
    fields: mapped.map(({ field }) => field),
  };
}

function scalarValue(
  field: ElicitationField,
  answer: string
): ElicitationContentValue | undefined {
  const mapped = field.options.get(answer) ?? answer;
  if (field.kind === "boolean") {
    if (mapped === "true") return true;
    if (mapped === "false") return false;
    return undefined;
  }
  if (field.kind === "number" || field.kind === "integer") {
    const value = Number(mapped);
    if (!Number.isFinite(value)) return undefined;
    if (field.kind === "integer" && !Number.isInteger(value)) return undefined;
    return value;
  }
  return mapped;
}

export function elicitationOutcome(
  mapping: AcpElicitationMapping,
  answers: AgentUserInputAnswers
): CreateElicitationResponse {
  const content: Record<string, ElicitationContentValue> = {};
  for (const field of mapping.fields) {
    const values = answers[field.id]?.answers
      .map((answer) => answer.trim())
      .filter((answer) => answer && answer !== "Skip");
    if (!values?.length) {
      if (field.required) return { action: "cancel" };
      continue;
    }
    const custom =
      field.customKey &&
      values.length === 1 &&
      !field.options.has(values[0]!);
    if (custom) {
      content[field.customKey!] = values[0]!;
      continue;
    }
    if (field.kind === "array") {
      content[field.id] = values.map(
        (answer) => field.options.get(answer) ?? answer
      );
      continue;
    }
    const value = scalarValue(field, values[0]!);
    if (value === undefined) return { action: "cancel" };
    content[field.id] = value;
  }
  return Object.keys(content).length
    ? { action: "accept", content }
    : { action: "decline" };
}
