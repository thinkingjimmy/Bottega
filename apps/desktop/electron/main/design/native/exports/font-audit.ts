/**
 * [INPUT]: The exact owned producer webContents, fixed source/font bytes and original mounted output roots and opaque child CDP targets.
 * [OUTPUT]: Actual CDP glyph/family/style/weight plus loaded CSS face byte proofs under the main source policy, with bounded real text digests before original production proceeds.
 * [POS]: Native output font gate; authored messages and a separate unused captured font cannot grant delivery.
 */
import { fontAuditBrowserScript } from "./font-probe";
import { randomUUID } from "node:crypto";
import type { WebContents } from "electron";
import { verifyNativeFontRuns, type NativeFontFaceEvidence, type NativeFontRun } from "@ai-chat/cloud-protocol/artifacts/design/export/fonts";
import { fixedDesignFont } from "../fonts/catalog";
import { designDigest } from "../../documents/model";
import type { NativeExportPlan, NativeExportSnapshot } from "./plan";
type Node = { nodeId: number; nodeType: number; nodeName: string; nodeValue?: string; attributes?: string[]; children?: Node[]; shadowRoots?: Node[]; contentDocument?: Node };
type Face = { family: string; digest?: string; url?: string; weight: [number, number]; style: string; loaded: boolean };
export async function beginNativeFontAudit(contents: WebContents, snapshot: NativeExportSnapshot, plan: NativeExportPlan, leaseUrl: string, guard: () => void, strictSources = false, inheritedSessions: ReadonlyMap<string, Promise<void>> = new Map()) {
  const font = await fixedDesignFont(), nonce = randomUUID(), binding = "__bottegaFont_" + nonce.replaceAll("-", "");
  const client = contents.debugger, proofs: unknown[] = [], failures: unknown[] = [];
  const sources = new Map(snapshot.files.map(file => [file.path, designDigest(file.data)]));
  const fixed = { id: font.info.id, family: font.info.family, digests: font.info.sourceHashes.map(sha => "sha256:" + sha),
    weight: font.info.weight, style: font.info.style, ranges: font.ranges };
  await client.sendCommand("DOM.enable"); await client.sendCommand("CSS.enable");
  await client.sendCommand("Runtime.addBinding", { name: binding });
  const faceDigest = (face: Face) => {
    if (face.digest) return face.digest;
    if (!face.url) return "unverified";
    const url = new URL(face.url, leaseUrl), lease = new URL(leaseUrl), project = new URL("./project/", leaseUrl);
    if (url.origin !== lease.origin || url.search || url.hash) return "unverified";
    const path = decodeURIComponent(url.pathname);
    if (path.startsWith(decodeURIComponent(project.pathname))) return sources.get(path.slice(decodeURIComponent(project.pathname).length)) ?? "unverified";
    const asset = /\/_blob\/([a-f0-9]{32})$/.exec(path)?.[1];
    return asset ? [...sources].find(([path]) => path.startsWith("assets/" + asset + "."))?.[1] ?? "unverified" : "unverified";
  };
  const sessions = new Map(inheritedSessions);
  let calls = 0, chain: Promise<unknown> = Promise.resolve();
  const observe = async (payload: { nonce: string; id: string; faces: Face[] }, contextId: number) => {
    let error: string | undefined, evidence: unknown;
    try {
      guard(); if (++calls > 512 || payload.faces.length > 64) throw new Error("FONT_EVIDENCE_BUDGET");
      const find = (node: Node): Node | undefined => {
        const attribute = node.attributes?.indexOf("data-bottega-font-audit");
        if (attribute !== undefined && attribute >= 0 && node.attributes?.[attribute + 1] === payload.id) return node;
        for (const child of [...node.children ?? [], ...node.shadowRoots ?? [], ...(node.contentDocument ? [node.contentDocument] : [])]) { const found = find(child); if (found) return found; }
      };
      await Promise.all(sessions.values());
      let node: Node | undefined, target: string | undefined;
      for (const session of [undefined, ...sessions.keys()]) {
        try { const tree = await client.sendCommand("DOM.getDocument", { depth: -1, pierce: true }, session) as { root: Node }; const found = find(tree.root); if (found) { node = found; target = session; break; } }
        catch (cause) { if (session === undefined) throw cause; }
      }
      if (!node) throw new Error("The original output font root expired");
      const text = new Map<number, string>();
      const walk = (current: Node, parent?: Node) => {
        if (["SCRIPT", "STYLE", "NOSCRIPT"].includes(current.nodeName)) return;
        if (current.nodeType === 3 && current.nodeValue?.trim() && parent?.nodeType === 1) text.set(parent.nodeId, (text.get(parent.nodeId) ?? "") + current.nodeValue);
        for (const child of [...current.children ?? [], ...current.shadowRoots ?? []]) walk(child, current);
        if (current.contentDocument) walk(current.contentDocument);
      }; walk(node);
      if (text.size > 2048) throw new Error("FONT_EVIDENCE_BUDGET");
      const runs: NativeFontRun[] = [];
      for (const [nodeId, value] of text) {
        const computed = await client.sendCommand("CSS.getComputedStyleForNode", { nodeId }, target) as { computedStyle: { name: string; value: string }[] };
        const css = Object.fromEntries(computed.computedStyle.map(item => [item.name, item.value]));
        const fonts = await client.sendCommand("CSS.getPlatformFontsForNode", { nodeId }, target) as { fonts: NativeFontRun["fonts"] };
        runs.push({ text: value, family: (css["font-family"] ?? "").split(",")[0]!.trim().replace(/^["']|["']$/g, ""),
          weight: Number(css["font-weight"]), style: css["font-style"] ?? "normal", fonts: fonts.fonts });
      }
      const faces: NativeFontFaceEvidence[] = payload.faces.map(face => ({ ...face, digest: faceDigest(face) }));
      evidence = { faces: faces.map((face, index) => ({ ...face, url: payload.faces[index]?.url?.slice(0, 160) })), runs: runs.slice(0, 32).map(run => ({ ...run, text: undefined, textDigest: designDigest(run.text) })) };
      const proof = plan.spec.options.fonts.mode === "strict" || plan.spec.options.fonts.mode === "replace" ? verifyNativeFontRuns(runs, faces, fixed) :
        { status: "requires-confirmed-preview", runs: runs.length, mode: plan.spec.options.fonts.mode };
      guard(); proofs.push({ ...proof, textDigest: designDigest(runs.map(run => run.text).join("\n")), weights: [...new Set(runs.map(run => run.weight))],
        styles: [...new Set(runs.map(run => run.style))], textSamples: runs.slice(0, 16).map(run => designDigest(run.text)), families: [...new Set(runs.map(run => run.family))] });
    } catch (cause) { error = cause instanceof Error ? cause.message : String(cause); if (failures.length < 8) failures.push({ error, evidence }); }
    if (!contents.isDestroyed()) await client.sendCommand("Runtime.evaluate", { contextId, expression: "window.__bottegaNativeFontReply(" + JSON.stringify(payload.id) + "," + JSON.stringify(error ?? null) + ")" }).catch(() => {});
  };
  const listener: Parameters<typeof client.on>[1] = (_event, method, parameters) => {
    if (method === "Target.attachedToTarget" && parameters.targetInfo?.type === "iframe") {
      const id = parameters.sessionId as string;
      if (sessions.size >= 32) return;
      const ready = (async () => { await client.sendCommand("DOM.enable", {}, id); await client.sendCommand("CSS.enable", {}, id);
        if (strictSources) await client.sendCommand("CSS.setLocalFontsEnabled", { enabled: false }, id); })();
      sessions.set(id, ready); void ready.catch(() => { sessions.delete(id); }); return;
    }
    if (method === "Target.detachedFromTarget") { sessions.delete(parameters.sessionId as string); return; }
    if (method !== "Runtime.bindingCalled" || parameters.name !== binding || typeof parameters.payload !== "string" || parameters.payload.length > 32 * 1024) return;
    let payload: { nonce: string; id: string; faces: Face[] };
    try { payload = JSON.parse(parameters.payload); } catch { return; }
    if (payload.nonce !== nonce || !/^[a-f0-9-]{36}$/.test(payload.id) || !Array.isArray(payload.faces)) return;
    chain = chain.then(() => observe(payload, parameters.executionContextId as number)); void chain.catch(() => {});
  };
  client.on("message", listener);
  try { if (!strictSources) await client.sendCommand("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }); await contents.executeJavaScript(fontAuditBrowserScript(nonce, binding)); }
  catch (cause) { client.removeListener("message", listener); throw cause; }
  return { proofs, failures, close: () => { client.removeListener("message", listener); } };
}
