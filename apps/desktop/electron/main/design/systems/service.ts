/**
 * [INPUT]: Current main Chat/workspace authority, the canonical Provider default, closed system commands and the single document journal.
 * [OUTPUT]: Exact source extraction, paged three-way review, finite overrides, fixed consumption and controlled mounts.
 * [POS]: Design-system main adapter; no new registry, commit protocol or comment store.
 */
import { unpackArtifactArchive } from "@ai-chat/cloud-protocol/artifacts/archive";
import type { WorkspaceCommand } from "@ai-chat/cloud-protocol/artifacts/design/model";
import { DEFAULT_PROVIDER_ID } from "../../../../shared/providers/catalog";
import { designSystemSchema, systemCompileSchema, systemOverrideSchema, type DesignSystem, type SystemEntry } from "@ai-chat/cloud-protocol/artifacts/design/system/model";
import { designSystemChanges, mergeDesignSystem } from "@ai-chat/cloud-protocol/artifacts/design/system/difference";
import { validTokenValue, resolvedSystemToken } from "@ai-chat/cloud-protocol/artifacts/design/system/tokens";
import { designDocuments } from "../documents/runtime";
import { DesignDocumentError, designDigest, requestKey } from "../documents/model";
import type { DesignRevision } from "../documents/store";
import { transformedDesignSet } from "../documents/edits";
import { assertArtifactGeneration } from "../../artifacts/admission/state";
import { captureSystemSources } from "./sources";
import { extractCapturedSystem, extractionDigest } from "./extract";
import { initialSystemManifest, projectSystemFiles } from "./files";
import { readDesignSystem, validateDesignSystem } from "./validation";
import { compileSystemComponent } from "./compile";
import { bindDesignSystem } from "./consume";

export { validateDesignSystem } from "./validation";
export { inertSystemSources } from "./validation";
export { validateSystemBindings } from "./consume";
type Snapshot = { version: DesignRevision; files: { path: string; data: Uint8Array }[]; editable: boolean };
function currentAuthority(input: WorkspaceCommand) {
  const documents = designDocuments(), authority = documents.authority(input.chatId, input.incarnationId);
  const assertAuthority = () => {
    if (JSON.stringify(documents.authority(input.chatId, input.incarnationId)) !== JSON.stringify(authority)) throw new DesignDocumentError("PATH_DENIED", "Chat/workspace authority changed during the system operation");
  };
  return { authority, assertAuthority };
}
function checkedSystem(snapshot: Snapshot) {
  const result = readDesignSystem(snapshot.files, snapshot.version.manifest);
  if (!result.system || result.issues.length) throw new DesignDocumentError("INVALID_DOCUMENT", "System structure is invalid", result.issues);
  return result.system;
}
function checkedFiles(path: string, files: readonly { path: string; data: Uint8Array }[]) {
  const source = transformedDesignSet(path, files), issues = validateDesignSystem(source);
  if (issues.length) throw new DesignDocumentError("INVALID_DOCUMENT", "System values or captured resources are invalid", issues);
  return files;
}
async function capture(input: WorkspaceCommand) {
  if (!input.sources) throw new DesignDocumentError("INVALID_DOCUMENT", "Select explicit current source files; stored source metadata does not grant authority");
  const { authority, assertAuthority } = currentAuthority(input);
  const captured = await captureSystemSources(authority, input.sources, assertAuthority), system = extractCapturedSystem(captured);
  assertAuthority(); assertArtifactGeneration(input.generation);
  return { authority, assertAuthority, captured, system, sourceDigest: extractionDigest(system) };
}
function display(value: SystemEntry | null) {
  if (!value) return null;
  const text = "kind" in value ? Object.entries(value.values).map(([theme, literal]) => `${theme}: ${literal}`).join(" · ") :
    "target" in value ? `${value.theme}: {${value.target}}` : `${value.entry} · ${value.sourceDigest} · ${value.mode}`;
  return text.length <= 160 ? text : text.slice(0, 159) + "…";
}
function pageNumber(value: unknown) { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 4096 ? value : 0; }
function inventoryPage(system: DesignSystem, sourceDigest: string, value?: string) {
  const parameters = value ? JSON.parse(value) as { section?: string; cursor?: number } : {};
  const section = parameters.section ?? "tokens", cursor = pageNumber(parameters.cursor);
  const counts = { tokens: system.tokens.tokens.length, aliases: system.aliases.aliases.length, components: system.components.components.length,
    sources: system.sources.files.length, unsynced: system.sources.unsynced.length };
  const origin = (sourceId: string) => system.sources.files.find(source => source.id === sourceId);
  const values: Record<string, unknown[]> = {
    tokens: system.tokens.tokens.map(token => ({ name: token.name, kind: token.kind,
      values: Object.fromEntries(Object.entries(token.values).map(([theme, literal]) => [theme, literal.length <= 200 ? literal : literal.slice(0, 199) + "…"])),
      origins: token.origins, usage: token.usage.slice(0, 160), source: origin(token.sourceId)?.path,
      truncated: token.usage.length > 160 || Object.values(token.values).some(literal => literal.length > 200) })),
    aliases: system.aliases.aliases.map(alias => ({ ...alias, usage: alias.usage.slice(0, 160), source: origin(alias.sourceId)?.path, truncated: alias.usage.length > 160 })),
    components: system.components.components.map(component => ({ name: component.name, exportName: component.exportName, entry: component.entry,
      sourceDigest: component.sourceDigest, closureDigest: component.closureDigest, closureCount: component.closure.length, mode: component.mode, reason: component.reason.slice(0, 160),
      truncated: component.reason.length > 160 })),
    sources: system.sources.files,
    unsynced: system.sources.unsynced,
  };
  if (!Object.hasOwn(values, section)) throw new DesignDocumentError("INVALID_DOCUMENT", "Choose tokens, aliases, components, sources or unsynced inventory");
  const rows = values[section]!, items: unknown[] = [];
  const result = { status: "inventory" as const, sourceDigest, counts, themes: system.tokens.themes, section, cursor, nextCursor: null as number | null, items };
  while (cursor + items.length < rows.length && items.length < 8) {
    const item = rows[cursor + items.length]; items.push(item);
    if (Buffer.byteLength(JSON.stringify(result)) > 7600) { items.pop(); break; }
  }
  if (cursor < rows.length && !items.length) throw new DesignDocumentError("BUDGET_EXCEEDED", "One inventory row exceeds its encrypted result budget; read the named source directly");
  result.nextCursor = cursor + items.length < rows.length ? cursor + items.length : null;
  return result;
}
function differencePage(current: DesignSystem, incoming: DesignSystem, sourceDigest: string, value?: string) {
  const parameters = value ? JSON.parse(value) as { cursor?: number; unsyncedCursor?: number } : {};
  const cursor = pageNumber(parameters.cursor), unsyncedCursor = pageNumber(parameters.unsyncedCursor), changes = designSystemChanges(current, incoming);
  const changeRows = changes.slice(cursor, cursor + 8).map(change => ({ key: change.key, family: change.family, kind: change.kind, requiresDecision: change.requiresDecision,
    base: display(change.base), current: display(change.current), incoming: display(change.incoming) }));
  const unsyncedRows = incoming.sources.unsynced.slice(unsyncedCursor, unsyncedCursor + 4).map(item => ({ ...item, ...(item.name ? { name: item.name.slice(0, 80) } : {}), reason: item.reason.slice(0, 160) }));
  const result = { status: "difference" as const, sourceDigest, total: changes.length, cursor, nextCursor: null as number | null,
    changes: [] as typeof changeRows, unsynced: [] as typeof unsyncedRows,
    unsyncedTotal: incoming.sources.unsynced.length, unsyncedCursor, nextUnsyncedCursor: null as number | null };
  const advance = () => {
    result.nextCursor = cursor + result.changes.length < changes.length ? cursor + result.changes.length : null;
    result.nextUnsyncedCursor = unsyncedCursor + result.unsynced.length < incoming.sources.unsynced.length ? unsyncedCursor + result.unsynced.length : null;
  };
  const include = <T>(rows: T[], candidates: T[]) => {
    if (rows.length >= candidates.length) return false;
    rows.push(candidates[rows.length]!); advance();
    if (Buffer.byteLength(JSON.stringify(result)) > 8000) { rows.pop(); advance(); return false; }
    return true;
  };
  for (;;) {
    const changeAdded = include(result.changes, changeRows), omissionAdded = include(result.unsynced, unsyncedRows);
    if (!changeAdded && !omissionAdded) break;
  }
  advance();
  if (cursor < changes.length && !result.changes.length || unsyncedCursor < incoming.sources.unsynced.length && !result.unsynced.length)
    throw new DesignDocumentError("BUDGET_EXCEEDED", "One source difference row exceeds its encrypted result budget");
  if (Buffer.byteLength(JSON.stringify(result)) > 8000) throw new DesignDocumentError("BUDGET_EXCEEDED", "Source difference page exceeds its encrypted result budget");
  return result;
}
export async function extractDesignSystem(input: WorkspaceCommand, backend: string = DEFAULT_PROVIDER_ID) {
  assertArtifactGeneration(input.generation);
  if (input.save) {
    if (!input.systemId || !input.requestId || input.expectedRevision !== 0) throw new DesignDocumentError("INVALID_DOCUMENT", "Initial system save requires an ID, request ID and expectedRevision 0");
    const documents = designDocuments(), { authority } = currentAuthority(input), operation = documents.store.operation(requestKey(authority, input.requestId));
    const requestDigest = designDigest(JSON.stringify([input.systemId, input.sources]));
    if (operation) {
      const files = unpackArtifactArchive(await documents.store.read(operation.revision.snapshotRef));
      const archived = readDesignSystem(files, operation.revision.manifest).system;
      if (!archived || archived.sources.requestDigest !== requestDigest || operation.revision.path !== `design-systems/${input.systemId}`) throw new DesignDocumentError("REQUEST_MISMATCH", "requestId belongs to a different system extraction");
      return documents.commit(input.chatId, input.incarnationId, backend, { path: operation.revision.path, requestId: input.requestId,
        expectedRevision: 0, readSetDigest: operation.revision.readSetDigest }, AbortSignal.timeout(15000));
    }
    if (documents.store.latest(authority.ownerId, input.systemId, authority)) throw new DesignDocumentError("REVISION_CONFLICT", "This system already has revisions. Review a source difference instead of rebuilding it.");
  }
  const extracted = await capture(input), { system, assertAuthority, captured, sourceDigest } = extracted;
  if (!input.save) return inventoryPage(system, sourceDigest, input.value);
  if (!captured.files.length) throw new DesignDocumentError("INVALID_DOCUMENT", "No ordinary supported source files were captured; no system was saved", captured.unsynced.slice(0, 32).map(item => ({ file: item.path, message: item.reason })));
  const manifest = initialSystemManifest(input.systemId!), path = `design-systems/${input.systemId}`;
  system.sources.requestDigest = designDigest(JSON.stringify([input.systemId, input.sources]));
  const files = checkedFiles(path, projectSystemFiles(system, manifest, [], captured));
  assertAuthority(); assertArtifactGeneration(input.generation);
  return designDocuments().initializeSource(input, backend, files, () => assertArtifactGeneration(input.generation));
}
export async function designSystemAction(input: WorkspaceCommand, snapshot: Snapshot) {
  assertArtifactGeneration(input.generation);
  if (input.action !== "system-diff" && input.requestId) {
    const documents = designDocuments(), authority = documents.authority(input.chatId, input.incarnationId);
    const original = documents.store.operation(requestKey(authority, input.requestId));
    if (original?.sourceEdit) return documents.edit(input, snapshot.version, async () => { throw new DesignDocumentError("REQUEST_MISMATCH", "Original system operation is unavailable"); }, () => assertArtifactGeneration(input.generation));
  }
  if (input.action === "system-bind") {
    if (!snapshot.editable) throw new DesignDocumentError("PATH_DENIED", "Retained/historical references cannot change a source binding");
    return designDocuments().edit(input, snapshot.version, async source => {
      const files = await bindDesignSystem(input, snapshot.version, source); assertArtifactGeneration(input.generation); return files;
    }, () => assertArtifactGeneration(input.generation));
  }
  const system = checkedSystem(snapshot);
  if (input.action === "system-diff") {
    const incoming = await capture(input); return differencePage(system, incoming.system, incoming.sourceDigest, input.value);
  }
  if (!snapshot.editable) throw new DesignDocumentError("PATH_DENIED", "Retained/historical system references are read only");
  if (input.action === "system-update") {
    if (input.value && !input.sources) {
      const override = systemOverrideSchema.parse(JSON.parse(input.value));
      return designDocuments().edit(input, snapshot.version, async source => {
        const current = readDesignSystem(source.files, snapshot.version.manifest).system!;
        let token = current.tokens.tokens.find(token => token.name === override.token);
        const alias = current.aliases.aliases.find(alias => alias.name === override.token && alias.theme === override.theme) ??
          (!token?.values[override.theme] ? current.aliases.aliases.find(alias => alias.name === override.token && alias.theme === current.tokens.themes[0]!.id) : undefined);
        if (!token && alias) {
          const target = resolvedSystemToken(current, alias.target, override.theme);
          if (target) { token = { name: alias.name, kind: target.token.kind, values: {}, origins: {}, usage: alias.usage,
            sourceId: alias.sourceId, sourceKey: alias.sourceKey }; current.tokens.tokens.push(token); }
        }
        if (!token || !current.tokens.themes.some(theme => theme.id === override.theme)) throw new DesignDocumentError("INVALID_DOCUMENT", "Select an existing token or alias and theme");
        if (!validTokenValue(token.kind, override.value)) throw new DesignDocumentError("INVALID_DOCUMENT", "Enter a supported literal value. Your input is retained.");
        token.values[override.theme] = override.value; token.override = true;
        token.origins[override.theme] ??= alias ? { sourceId: alias.sourceId, sourceKey: alias.sourceKey } : { ...token.origins[current.tokens.themes[0]!.id]! };
        current.aliases.aliases = current.aliases.aliases.filter(alias => alias.name !== override.token || alias.theme !== override.theme);
        if (override.usage !== undefined) token.usage = override.usage;
        assertArtifactGeneration(input.generation); return checkedFiles(source.path, projectSystemFiles(current, snapshot.version.manifest, source.files));
      }, () => assertArtifactGeneration(input.generation));
    }
    if (!input.sources || !input.sourceDigest) throw new DesignDocumentError("INVALID_DOCUMENT", "Review the exact current-source difference before applying an update");
    return designDocuments().edit(input, snapshot.version, async source => {
      const incoming = await capture(input);
      if (incoming.sourceDigest !== input.sourceDigest) throw new DesignDocumentError("SOURCE_CHANGED", "Source changed after difference review. Choices and values are retained.");
      const current = readDesignSystem(source.files, snapshot.version.manifest).system!;
      let merged: ReturnType<typeof mergeDesignSystem>;
      try { merged = mergeDesignSystem(current, incoming.system, input.decisions ?? {}); }
      catch (cause) {
        if (cause instanceof Error && (cause.message === "Update decisions do not match the current source difference" ||
          cause.message.startsWith("Choose how to resolve ") ||
          /^Source .+ was removed\. Choose keep or delete\.$/.test(cause.message) ||
          cause.message.startsWith("Delete is available only for a removed source entry: ")))
          throw new DesignDocumentError("INVALID_DOCUMENT", cause.message);
        throw cause;
      }
      designSystemSchema.parse(merged.system); assertArtifactGeneration(input.generation);
      return checkedFiles(source.path, projectSystemFiles(merged.system, snapshot.version.manifest, source.files, incoming.captured));
    }, () => assertArtifactGeneration(input.generation));
  }
  if (input.action === "system-compile") {
    if (!input.entry || !input.value) throw new DesignDocumentError("INVALID_DOCUMENT", "Choose an actual source entry and component name");
    const selection = systemCompileSchema.parse(JSON.parse(input.value));
    return designDocuments().edit(input, snapshot.version, async source => {
      const current = readDesignSystem(source.files, snapshot.version.manifest).system!;
      const component = current.components.components.find(value => value.name === selection.component && value.entry === input.entry);
      if (!component) throw new DesignDocumentError("PATH_DENIED", "Component is not in this exact system revision");
      try {
        const compiled = await compileSystemComponent(current, component, source.files, selection.props);
        assertArtifactGeneration(input.generation);
        current.components.components = current.components.components.map(value => value.name === component.name ? compiled.component : value);
        current.sources.unsynced = current.sources.unsynced.filter(value => value.kind !== "component" || value.name !== component.name || value.path !== component.entry);
        const boardId = "c_" + designDigest(JSON.stringify([component.name, component.entry])).slice(7, 27);
        const manifest = { ...snapshot.version.manifest, boards: [...snapshot.version.manifest.boards.filter(board => board.id !== boardId),
          { id: boardId, title: component.name, file: compiled.component.preview!, mode: "responsive" as const, viewport: { width: 1200, height: 900 } }] };
        const files = new Map(source.files.map(file => [file.path, file.data])); for (const file of compiled.files) files.set(file.path, file.data);
        return checkedFiles(source.path, projectSystemFiles(current, manifest, [...files].map(([path, data]) => ({ path, data }))));
      } catch (error) {
        if (error instanceof DesignDocumentError && ["PATH_DENIED", "BUDGET_EXCEEDED", "ARTIFACT_DISABLED"].includes(error.code)) throw error;
        assertArtifactGeneration(input.generation);
        const reason = `Static representation: ${error instanceof Error ? error.message : "Component could not be mounted"}`.slice(0, 500);
        current.components.components = current.components.components.map(value => value.name === component.name && value.mode !== "mounted" ? { ...value, mode: "static", reason,
          preview: undefined, bundle: undefined, bundleDigest: undefined, evidence: undefined } : value);
        current.sources.unsynced = current.sources.unsynced.filter(value => value.kind !== "component" || value.name !== component.name || value.path !== component.entry);
        current.sources.unsynced.push({ path: component.entry, kind: "component", name: component.name, reason });
        return checkedFiles(source.path, projectSystemFiles(current, snapshot.version.manifest, source.files));
      }
    }, () => assertArtifactGeneration(input.generation));
  }
  throw new DesignDocumentError("INVALID_DOCUMENT", "Unknown system action");
}
