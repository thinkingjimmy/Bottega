/**
 * [INPUT]: Verified native runtime notices and immutable source license/notice text members.
 * [OUTPUT]: Inert complete license JSON carried with frozen native preview/export documents.
 * [POS]: Native distribution attribution; source and runtime notices are retained without running their content.
 */
export function nativeDocumentNotices(assets: ReadonlyMap<string, Uint8Array>, files: readonly { path: string; data: Uint8Array }[]) {
  const runtime = assets.get("third-party-licenses.txt");
  if (!runtime || runtime.length > 2 * 1024 * 1024) throw new Error("Native runtime notices are missing or exceed their budget");
  const decode = (bytes: Uint8Array) => new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const records = [{ path: "@runtime/third-party-licenses.txt", text: decode(runtime) }]; let total = 0;
  for (const file of files.filter(file => /(?:^|[/._-])(?:licen[cs]e|ofl|copyright|notices?)(?:[._-][A-Za-z0-9_.-]+)*$/i.test(file.path)).sort((a, b) => a.path.localeCompare(b.path, "en"))) {
    total += file.data.length;
    if (file.data.length > 64 * 1024 || total > 256 * 1024) throw new Error("Captured source notices exceed their text budget");
    records.push({ path: file.path, text: decode(file.data) });
  }
  return Buffer.from('<script type="application/json" data-bottega-native-notices>' + JSON.stringify(records).replaceAll("<", "\\u003c") + '</script>');
}
