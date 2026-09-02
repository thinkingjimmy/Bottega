/**
 * [INPUT]: Depends on the database protocol's command, request, response, and failure types
 * [OUTPUT]: Provides exact command-envelope validation and command-specific response validation
 * [POS]: Runtime codec for the main/worker trust boundary; protocol types remain declarative in database-protocol.ts
 */

import type {
  ChatDatabaseFailure,
  DatabaseCommand,
  DatabaseRequest,
  DatabaseResponse,
} from "./database-protocol";

type Rule = (value: unknown) => boolean;
type Fields = Readonly<Record<string, Rule>>;

const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
const string: Rule = (value) => typeof value === "string";
const number: Rule = (value) => typeof value === "number" && Number.isFinite(value);
const boolean: Rule = (value) => typeof value === "boolean";
const object: Rule = isObject;
const array: Rule = Array.isArray;
const nullable = (rule: Rule): Rule => (value) => value === null || rule(value);
const arrayOf = (rule: Rule): Rule => (value) => Array.isArray(value) && value.every(rule);
const literal = (...values: readonly unknown[]): Rule => (value) => values.includes(value);

const shape = (
  required: Fields,
  optional: Fields = {},
  exact = false
): Rule => (value) => {
  if (!isObject(value)) return false;
  if (!Object.entries(required).every(([key, rule]) => key in value && rule(value[key]))) return false;
  if (!Object.entries(optional).every(([key, rule]) => !(key in value) || rule(value[key]))) return false;
  return !exact || Object.keys(value).every((key) => key in required || key in optional);
};

const command = (required: Fields = {}, optional: Fields = {}): Rule =>
  shape({ kind: string, ...required }, optional, true);
const op = { operationId: string, requestHash: string };
const chatDevice = { chatId: string, deviceId: string };
const revisions = {
  expectedAggregateRevision: number,
  nextAggregateRevision: number,
};
const messageRevisions = {
  ...revisions,
  expectedMessageRevision: number,
  nextMessageRevision: number,
  nextSeq: number,
  updatedAt: number,
  retainedFromSeq: number,
  trimmedThroughSeq: number,
};
const sagaMutation = { ...op, sagaId: string, now: number };
const searchDocumentCursor: Rule = shape(
  { updatedAt: number, chatId: string, kindRank: number, rowId: number },
  {},
  true
);
const nativeMessageSelector: Rule = (value) =>
  shape({ kind: literal("first-user") }, {}, true)(value) ||
  shape({ kind: literal("id"), messageId: string }, {}, true)(value) ||
  shape({ kind: literal("seq"), seq: number }, {}, true)(value);

const COMMAND_RULES: Record<DatabaseCommand["kind"], Rule> = {
  initialize: command({
    databasePath: string,
    deviceId: string,
    mode: literal("canonical", "verification"),
  }),
  "list-metadata": command({ deviceId: string }, { chatId: string }),
  "get-record": command(chatDevice),
  "get-native-message": command({ ...chatDevice, selector: nativeMessageSelector }),
  "get-native-messages": command(chatDevice),
  "get-native-subagents": command(chatDevice),
  "get-timeline-page": command({ input: object, deviceId: string }),
  "get-timeline-around": command({ input: object, deviceId: string }),
  "get-outline-page": command({ ...chatDevice, limit: number }, { cursor: object }),
  "find-messages": command({
    ...chatDevice,
    grams: arrayOf(string),
    tokens: arrayOf(string),
    limit: number,
  }, { cursor: object }),
  "upsert-record": command({ ...op, record: object, deviceId: string }, {
    lifecycleKind: literal("native", "external-managed"),
    expectedAggregateRevision: nullable(number),
  }),
  "update-chat-facts": command({
    ...op,
    ...chatDevice,
    expectedAggregateRevision: number,
    facts: object,
  }),
  "append-message": command({ ...op, ...chatDevice, message: object, ...messageRevisions }),
  "commit-turn": command({
    ...op,
    ...chatDevice,
    message: nullable(object),
    subagents: object,
    ...messageRevisions,
  }),
  "update-readonly-presentation": command({
    ...op,
    ...chatDevice,
    ...revisions,
    updatedAt: number,
    presentation: object,
  }),
  "remove-record": command({ ...op, ...chatDevice }, { expectedIncarnationId: string }),
  "get-operation-receipt": command({ operationId: string }),
  "list-attachment-ids": command(),
  "has-attachment-reference": command({ ...chatDevice, attachmentId: string }),
  "get-attachment-reference": command({ ...chatDevice, attachmentId: string }),
  "list-memory-summaries": command({ deviceId: string }),
  "get-memory-native-segment": command({ ...chatDevice, afterSeq: number, limit: number }),
  "search-documents": command({
    grams: arrayOf(string),
    cursor: nullable(searchDocumentCursor),
    limit: number,
    deviceId: string,
  }),
  "begin-history-import": command({ ...op, deviceId: string, source: object }),
  "append-history-import-batch": command({
    ...op,
    runId: string,
    sourceRevision: string,
    expectedCursor: nullable(string),
    expectedRollingDigest: string,
    nextCursor: string,
    entries: arrayOf(object),
  }),
  "finalize-history-import": command({
    ...op,
    runId: string,
    expectedEntryCount: number,
    expectedByteSize: number,
    expectedRollingDigest: string,
  }, { incompleteTail: boolean }),
  "cancel-history-import": command({ ...op, runId: string, reason: string }),
  "mark-import-source-status": command({
    ...op,
    chatId: string,
    sourceStatus: literal("match", "missing"),
  }),
  "get-history-import-run": command({ runId: string }),
  "begin-continuation-saga": command({
    ...op,
    chatId: string,
    generationId: string,
    deviceId: string,
    homeIntentId: string,
    continuationInput: object,
    finalizeOperationId: string,
    now: number,
  }),
  "mark-continuation-home-preparing": command(sagaMutation),
  "record-continuation-home-committed": command({
    ...sagaMutation,
    homeReceipt: object,
    homeDirIdentity: object,
  }),
  "finalize-continuation-saga": command({
    ...sagaMutation,
    deviceId: string,
    expectedGenerationId: string,
    incarnationId: string,
    homeDir: string,
    session: object,
    firstMessage: object,
    adoptionSnapshotId: string,
    snapshotDigest: string,
    startState: object,
    context: object,
    appRole: nullable(string),
    grants: array,
    grantRevision: number,
  }),
  "fail-continuation-precommit": command({ ...sagaMutation, reason: string }),
  "isolate-continuation-orphan": command({ ...sagaMutation, reason: string }),
  "list-reconcilable-continuations": command(),
  "maintenance-gate": command(),
  close: command(),
};

const failureKinds = new Set<ChatDatabaseFailure["kind"]>([
  "constraint", "conflict", "corrupt", "future-schema", "locked",
  "disk-full", "protocol", "unknown",
]);
const failure: Rule = shape({
  kind: (value) => typeof value === "string" && failureKinds.has(value as ChatDatabaseFailure["kind"]),
  message: string,
}, {}, true);
const upsertResult = shape({
  chatId: string,
  aggregateRevision: number,
  nativeMessageRevision: number,
});
const receipt = (kind: DatabaseCommand["kind"], result: Rule): Rule => shape({
  operationId: string,
  requestHash: string,
  kind: literal(kind),
  targetId: nullable(string),
  result,
  committedAt: number,
});
const mutation = (kind: DatabaseCommand["kind"], result: Rule): Rule => (value) => {
  if (!isObject(value)) return false;
  if (value.status === "committed") return receipt(kind, result)(value.receipt);
  if (value.status === "rejected") return failure(value.failure);
  return value.status === "outcome_unknown" && string(value.operationId) && string(value.reason);
};
const nullableObject = nullable(object);

const RESULT_RULES: Record<DatabaseCommand["kind"], Rule> = {
  initialize: shape({ sqliteVersion: string, compileOptions: arrayOf(string), startupMs: number }),
  "list-metadata": arrayOf(object),
  "get-record": nullableObject,
  "get-native-message": nullableObject,
  "get-native-messages": arrayOf(object),
  "get-native-subagents": object,
  "get-timeline-page": nullableObject,
  "get-timeline-around": nullableObject,
  "get-outline-page": nullableObject,
  "find-messages": nullable(shape({ items: array, total: number, nextCursor: nullableObject })),
  "upsert-record": mutation("upsert-record", upsertResult),
  "update-chat-facts": mutation("update-chat-facts", upsertResult),
  "append-message": mutation("append-message", upsertResult),
  "commit-turn": mutation("commit-turn", upsertResult),
  "update-readonly-presentation": mutation("update-readonly-presentation", upsertResult),
  "remove-record": mutation("remove-record", shape({ chatId: string, attachments: array })),
  "get-operation-receipt": nullable(shape({
    operationId: string,
    requestHash: string,
    kind: string,
    targetId: nullable(string),
    result: () => true,
    committedAt: number,
  })),
  "list-attachment-ids": arrayOf(string),
  "has-attachment-reference": boolean,
  "get-attachment-reference": nullableObject,
  "list-memory-summaries": arrayOf(object),
  "get-memory-native-segment": nullableObject,
  "search-documents": shape({ hits: arrayOf(object), nextCursor: nullable(searchDocumentCursor) }),
  "begin-history-import": mutation("begin-history-import", object),
  "append-history-import-batch": mutation("append-history-import-batch", object),
  "finalize-history-import": mutation("finalize-history-import", object),
  "cancel-history-import": mutation("cancel-history-import", object),
  "mark-import-source-status": mutation("mark-import-source-status", object),
  "get-history-import-run": nullableObject,
  "begin-continuation-saga": mutation("begin-continuation-saga", object),
  "mark-continuation-home-preparing": mutation("mark-continuation-home-preparing", object),
  "record-continuation-home-committed": mutation("record-continuation-home-committed", object),
  "finalize-continuation-saga": mutation("finalize-continuation-saga", object),
  "fail-continuation-precommit": mutation("fail-continuation-precommit", object),
  "isolate-continuation-orphan": mutation("isolate-continuation-orphan", object),
  "list-reconcilable-continuations": arrayOf(object),
  "maintenance-gate": shape({
    integrity: literal("ok"),
    foreignKeys: number,
    domainInvariants: literal("ok"),
    ftsRank: number,
    sourceProjection: object,
  }),
  close: shape({ closed: literal(true) }, {}, true),
};

const requestId = /^[A-Za-z0-9_-]{1,128}$/;

export function parseDatabaseRequestValue(value: unknown): DatabaseRequest {
  if (!isObject(value)) throw new Error("request must be an object");
  if (
    value.protocolVersion !== 1 ||
    typeof value.requestId !== "string" ||
    !requestId.test(value.requestId) ||
    !isObject(value.command) ||
    typeof value.command.kind !== "string" ||
    !Object.keys(value).every((key) => ["protocolVersion", "requestId", "command"].includes(key))
  ) {
    throw new Error("invalid database request envelope");
  }
  const rule = COMMAND_RULES[value.command.kind as DatabaseCommand["kind"]];
  if (!rule) throw new Error("invalid database request envelope");
  if (!rule(value.command)) throw new Error(`invalid ${value.command.kind} command payload`);
  return value as DatabaseRequest;
}

export function parseDatabaseResponseValue(
  value: unknown,
  expectedRequestId: string,
  expectedKind?: DatabaseCommand["kind"]
): DatabaseResponse {
  if (!isObject(value)) throw new Error("response must be an object");
  if (value.protocolVersion !== 1 || value.requestId !== expectedRequestId || typeof value.ok !== "boolean") {
    throw new Error("database response envelope mismatch");
  }
  const allowed = value.ok
    ? ["protocolVersion", "requestId", "ok", "result"]
    : ["protocolVersion", "requestId", "ok", "failure"];
  if (!Object.keys(value).every((key) => allowed.includes(key))) {
    throw new Error("database response envelope mismatch");
  }
  if (value.ok === true) {
    if (!("result" in value)) throw new Error("database response is missing result");
    if (expectedKind && !RESULT_RULES[expectedKind](value.result)) {
      throw new Error(`invalid ${expectedKind} response payload`);
    }
  } else if (!("failure" in value)) {
    throw new Error("database response is missing failure");
  } else if (!failure(value.failure)) {
    throw new Error("database response has an invalid failure");
  }
  return value as DatabaseResponse;
}
