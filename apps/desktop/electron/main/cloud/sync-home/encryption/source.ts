/**
 * [INPUT]: Depends on complete frozen Home sources and original Chat outbox checkpoints.
 * [OUTPUT]: Saves bounded inventory pages and restores complete immutable sources after process restart.
 * [POS]: Main Home delivery adapter; the worker verifies the final manifest before allowing subsequent local writes.
 */
import { frozenHomeSchema, type FrozenHome } from "../../../chats/sqlite/cloud/delivery/home";
import type { ChatDeliveryCheckpoints } from "../../sync/chats/checkpoints";
export async function saveFrozenHome(checkpoints: ChatDeliveryCheckpoints, source: FrozenHome) {
  for (let offset = 0; offset < source.entries.length; offset += 50) await checkpoints.save({ kind: "home-entries", offset, entries: source.entries.slice(offset, offset + 50) });
  await checkpoints.save({ kind: "home-manifest", manifest: source.manifest }); return source;
}
export async function readFrozenHome(checkpoints: ChatDeliveryCheckpoints) {
  const manifest = await checkpoints.get("home-manifest");
  if (manifest?.kind === "home-manifest") {
    const entries: FrozenHome["entries"] = [];
    for (let offset = 0; offset < manifest.manifest.entryCount; offset += 50) {
      const page = await checkpoints.get(`home-entries:${offset}`);
      if (page?.kind !== "home-entries" || page.offset !== offset) throw new Error("HOME_ENTRY_PAGE_MISSING"); entries.push(...page.entries);
    }
    return frozenHomeSchema.parse({ manifest: manifest.manifest, entries });
  }
  return null;
}
