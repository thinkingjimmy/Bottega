/**
 * [INPUT]: Depends on the BrowserPanelService registry, webContents.debugger, browser action, per-tab lane, canceled action execution, Agent overlay and AbortSignal
 * [OUTPUT]: Provides CdpHarness: cross-frame/OOPIF AX snapshots, versioned ref, budget compression, batch action, stop semantics and final feedback snapshots
 * [POS]: The main/browser's Agent kernel is sorted; lane synchronization, action-execution, cancellation, AX/ref/ action syntax and result budget
 */

import { setTimeout as delay } from "node:timers/promises";
import type { BrowserAction } from "../../../shared/builtin-tools/browser";
import {
  boxCenter,
  removeAgentOverlay,
  showAgentOverlay,
} from "./agent-overlay";
import {
  BrowserPanelService,
  type BrowserDebuggerPort,
  type BrowserWebContentsPort,
  UserStoppedBrowserBatchError,
} from "./browser-service";
import {
  deadlineSignal,
  runCancelableAction,
} from "./execution/action-execution";
import { PerTabExecutionLane } from "./execution/execution-lane";

const ACTION_TIMEOUT_MS = 5_000;
const BATCH_TIMEOUT_MS = 60_000;
const EVAL_RESULT_BYTE_LIMIT = 16 * 1024;
const SNAPSHOT_MIN_BUDGET = 1_024;

type Route = {
  sessionId?: string;
  frameId?: string;
  backendDOMNodeId: number;
  name: string;
};

type HarnessState = {
  debuggerPort: BrowserDebuggerPort;
  contents: BrowserWebContentsPort;
  version: number;
  refs: Map<string, Route>;
  sessions: Set<string>;
  onMessage: (...args: unknown[]) => void;
  onDetach: (...args: unknown[]) => void;
};

type AxValue = { value?: unknown };
type AxNode = {
  ignored?: boolean;
  role?: AxValue;
  name?: AxValue;
  value?: AxValue;
  backendDOMNodeId?: number;
  properties?: Array<{ name?: string; value?: AxValue }>;
};

type Candidate = {
  route: Omit<Route, "name">;
  role: string;
  name: string;
  interactive: boolean;
  offscreen: boolean;
};

export type BrowserSnapshot = {
  snapshot: string;
  version: number;
  truncated: boolean;
  dropped: {
    interactive: number;
    viewportText: number;
    offscreen: number;
  };
};

export type BrowserActResult = {
  actions: Array<{
    index: number;
    type: BrowserAction["type"];
    ok: boolean;
    result?: unknown;
    error?: string;
    status?: number;
  }>;
  stopped_by_user: boolean;
  snapshot: BrowserSnapshot;
};

export class CdpHarness {
  private readonly states = new Map<string, HarnessState>();
  private readonly lanes = new PerTabExecutionLane();
  /** 全局单调快照版本：detach/重连也绝不回卷，杜绝旧 ref 撞上新 ref 静默点错元素。 */
  private snapshotVersion = 0;

  constructor(private readonly browser: BrowserPanelService) {}

  async snapshot(tabId: string, wireBudget: number): Promise<BrowserSnapshot> {
    const state = await this.ensureAttached(tabId);
    const candidates = await this.collectCandidates(state);
    state.version = ++this.snapshotVersion;
    state.refs = new Map();
    return this.compress(state, candidates, Math.max(SNAPSHOT_MIN_BUDGET, wireBudget));
  }

  async act(
    tabId: string,
    actions: readonly BrowserAction[],
    upstreamSignal: AbortSignal,
    wireBudget: number
  ): Promise<BrowserActResult> {
    return this.lanes.run(tabId, upstreamSignal, () =>
      this.runBatch(tabId, actions, upstreamSignal, wireBudget)
    );
  }

  private async runBatch(
    tabId: string,
    actions: readonly BrowserAction[],
    upstreamSignal: AbortSignal,
    wireBudget: number
  ): Promise<BrowserActResult> {
    const state = await this.ensureAttached(tabId);
    const batch = this.browser.beginAgentBatch(tabId, upstreamSignal);
    const timed = deadlineSignal(batch.signal, BATCH_TIMEOUT_MS);
    const results: BrowserActResult["actions"] = [];
    let evalBytes = 0;
    let stoppedByUser = false;
    const overlaySessions = new Set<string | undefined>([undefined]);

    try {
      await showAgentOverlay(state.debuggerPort, "Agent 正在控制");
      for (let index = 0; index < actions.length; index += 1) {
        const current = actions[index]!;
        try {
          timed.signal.throwIfAborted();
          this.browser.setAgentAction(tabId, actionLabel(current));
          const route = "ref" in current && current.ref
            ? this.requireRef(state, current.ref)
            : undefined;
          if (route) overlaySessions.add(route.sessionId);
          const result = await runCancelableAction({
            run: async () => {
              if (route) {
                await this.moveOverlay(
                  state,
                  route,
                  actionLabel(current)
                );
              }
              return this.execute(state, tabId, current, timed.signal);
            },
            timeoutMs:
              current.type === "wait_for"
                ? current.timeout_ms + 250
                : ACTION_TIMEOUT_MS,
            upstream: timed.signal,
            target: {
              debuggerPort: state.debuggerPort,
              contents: state.contents,
              sessionIds: [undefined, route?.sessionId],
            },
          });
          if (current.type === "eval") {
            const bytes = result === undefined ? 0 : jsonBytes(result);
            if (bytes > EVAL_RESULT_BYTE_LIMIT) {
              throw statusError(413, "eval 单动作结果超过 16KB");
            }
            evalBytes += bytes;
            if (evalBytes > Math.floor(wireBudget / 4)) {
              throw statusError(413, "eval 批内累计结果超过当前 wire 预算的四分之一");
            }
          }
          results.push({ index, type: current.type, ok: true, ...(result === undefined ? {} : { result }) });
        } catch (cause) {
          if (isUserStop(timed.signal.reason ?? cause)) {
            stoppedByUser = true;
          } else {
            const error = asError(cause);
            results.push({
              index,
              type: current.type,
              ok: false,
              error: error.message,
              ...("status" in error && typeof error.status === "number"
                ? { status: error.status }
                : {}),
            });
          }
          break;
        }
      }
    } finally {
      timed.dispose();
      for (const sessionId of overlaySessions) {
        await removeAgentOverlay(state.debuggerPort, sessionId);
      }
      batch.finish();
    }

    const used = jsonBytes({ actions: results, stopped_by_user: stoppedByUser });
    const snapshotBudget = Math.max(
      SNAPSHOT_MIN_BUDGET,
      wireBudget - used - 2_048
    );
    return {
      actions: results,
      stopped_by_user: stoppedByUser,
      snapshot: await this.snapshot(tabId, snapshotBudget),
    };
  }

  detach(tabId: string) {
    const state = this.states.get(tabId);
    if (!state) return;
    state.debuggerPort.removeListener("message", state.onMessage);
    state.debuggerPort.removeListener("detach", state.onDetach);
    if (state.debuggerPort.isAttached()) state.debuggerPort.detach();
    this.states.delete(tabId);
  }

  private async ensureAttached(tabId: string) {
    const record = this.browser.requireTab(tabId);
    const contents = record.view.webContents;
    this.browser.assertRegisteredWebContents(contents);
    const existing = this.states.get(tabId);
    if (
      existing &&
      existing.contents === contents &&
      existing.debuggerPort.isAttached()
    ) {
      return existing;
    }
    if (existing) this.detach(tabId);
    if (!contents.debugger.isAttached()) contents.debugger.attach("1.3");
    const state: HarnessState = {
      debuggerPort: contents.debugger,
      contents,
      version: 0,
      refs: new Map(),
      sessions: new Set(),
      onMessage: () => undefined,
      onDetach: () => undefined,
    };
    state.onMessage = (...args: unknown[]) => {
      const method = typeof args[1] === "string" ? args[1] : "";
      const params = isRecord(args[2]) ? args[2] : {};
      const sessionId = typeof args[3] === "string" ? args[3] : undefined;
      const targetInfo = isRecord(params.targetInfo) ? params.targetInfo : {};
      if (method === "Target.attachedToTarget") {
        const attached = params.sessionId;
        if (
          typeof attached === "string" &&
          typeof targetInfo.type === "string" &&
          ["iframe", "page"].includes(targetInfo.type)
        ) {
          state.sessions.add(attached);
        }
      }
      if (
        method === "Target.detachedFromTarget" &&
        typeof params.sessionId === "string"
      ) {
        state.sessions.delete(params.sessionId);
      }
      if (sessionId && method === "Inspector.detached") {
        state.sessions.delete(sessionId);
      }
    };
    state.onDetach = () => {
      state.debuggerPort.removeListener("message", state.onMessage);
      state.debuggerPort.removeListener("detach", state.onDetach);
      if (this.states.get(tabId) === state) this.states.delete(tabId);
    };
    contents.debugger.on("message", state.onMessage);
    contents.debugger.on("detach", state.onDetach);
    this.states.set(tabId, state);
    await contents.debugger.sendCommand("Target.setAutoAttach", {
      autoAttach: true,
      waitForDebuggerOnStart: false,
      flatten: true,
    });
    await delay(0);
    return state;
  }

  private async collectCandidates(state: HarnessState) {
    const trees: Array<{ nodes: AxNode[]; frameId?: string; sessionId?: string }> = [];
    const frameTree = await state.debuggerPort.sendCommand("Page.getFrameTree");
    const frameIds = flattenFrameIds(frameTree?.frameTree);
    for (const frameId of frameIds) {
      const result = await state.debuggerPort.sendCommand(
        "Accessibility.getFullAXTree",
        frameId ? { frameId } : {}
      );
      trees.push({
        nodes: (result.nodes ?? []) as AxNode[],
        ...(frameId ? { frameId } : {}),
      });
    }
    for (const sessionId of state.sessions) {
      try {
        const result = await state.debuggerPort.sendCommand(
          "Accessibility.getFullAXTree",
          {},
          sessionId
        );
        trees.push({ nodes: (result.nodes ?? []) as AxNode[], sessionId });
      } catch {
        state.sessions.delete(sessionId);
      }
    }
    const seen = new Set<string>();
    const candidates: Candidate[] = [];
    for (const tree of trees) {
      for (const node of tree.nodes) {
        if (node.ignored || !Number.isInteger(node.backendDOMNodeId)) continue;
        const role = stringValue(node.role) || "text";
        const name = compactText(
          stringValue(node.name) || stringValue(node.value)
        );
        if (!name) continue;
        const key = `${tree.sessionId ?? "main"}:${tree.frameId ?? ""}:${node.backendDOMNodeId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        candidates.push({
          route: {
            ...(tree.sessionId ? { sessionId: tree.sessionId } : {}),
            ...(tree.frameId ? { frameId: tree.frameId } : {}),
            backendDOMNodeId: node.backendDOMNodeId!,
          },
          role,
          name,
          interactive: INTERACTIVE_ROLES.has(role),
          offscreen: booleanProperty(node, "offscreen"),
        });
      }
    }
    return candidates.sort(
      (left, right) =>
        Number(right.interactive) - Number(left.interactive) ||
        Number(left.offscreen) - Number(right.offscreen)
    );
  }

  private compress(
    state: HarnessState,
    candidates: Candidate[],
    wireBudget: number
  ): BrowserSnapshot {
    const lines: string[] = [];
    const dropped = { interactive: 0, viewportText: 0, offscreen: 0 };
    // 增量记账代替整包重序列化：contentBytes 是 snapshot 字符串 JSON 转义后的
    // 字节数（不含引号），行间 "\n" 转义后恒为 2 字节，万节点页面保持 O(n)。
    let contentBytes = 0;
    let refIndex = 0;
    for (const candidate of candidates) {
      const ref = `e${state.version}_${refIndex + 1}`;
      const line = `[ref=${ref}] ${candidate.role} "${escapeSnapshot(candidate.name)}"`;
      const nextContentBytes =
        contentBytes + (lines.length ? 2 : 0) + jsonBytes(line) - 2;
      const envelopeBytes = jsonBytes({
        snapshot: "",
        version: state.version,
        truncated: false,
        dropped,
      });
      if (envelopeBytes + nextContentBytes > wireBudget) {
        dropped[bucket(candidate)] += 1;
        continue;
      }
      refIndex += 1;
      contentBytes = nextContentBytes;
      lines.push(line);
      state.refs.set(ref, { ...candidate.route, name: candidate.name });
    }
    const truncated = Object.values(dropped).some((value) => value > 0);
    return {
      snapshot: lines.join("\n"),
      version: state.version,
      truncated,
      dropped,
    };
  }

  private requireRef(state: HarnessState, ref: string) {
    const route = state.refs.get(ref);
    if (!route) {
      throw statusError(409, `ref ${ref} 已陈旧或不存在，请重新 browser_snapshot`);
    }
    return route;
  }

  private async resolveObject(state: HarnessState, route: Route) {
    const resolved = await state.debuggerPort.sendCommand(
      "DOM.resolveNode",
      { backendNodeId: route.backendDOMNodeId },
      route.sessionId
    );
    const objectId = resolved?.object?.objectId;
    if (typeof objectId !== "string") {
      throw statusError(409, "目标元素已失效，请重新 browser_snapshot");
    }
    return objectId;
  }

  private async moveOverlay(state: HarnessState, route: Route, label: string) {
    const model = await state.debuggerPort.sendCommand(
      "DOM.getBoxModel",
      { backendNodeId: route.backendDOMNodeId },
      route.sessionId
    ).catch(() => undefined);
    await showAgentOverlay(
      state.debuggerPort,
      `${label}${route.name ? `「${route.name.slice(0, 80)}」` : ""}`,
      boxCenter(model),
      route.sessionId
    );
  }

  private async execute(
    state: HarnessState,
    tabId: string,
    action: BrowserAction,
    signal: AbortSignal
  ): Promise<unknown> {
    signal.throwIfAborted();
    if (action.type === "goto") {
      await this.browser.navigate(tabId, action.url);
      await showAgentOverlay(state.debuggerPort, actionLabel(action));
      return { url: action.url };
    }
    if (action.type === "back") {
      this.browser.goBack(tabId);
      return { navigated: true };
    }
    if (action.type === "forward") {
      this.browser.goForward(tabId);
      return { navigated: true };
    }
    if (action.type === "reload") {
      this.browser.reload(tabId);
      return { reloaded: true };
    }
    if (action.type === "press") {
      await state.debuggerPort.sendCommand("Input.dispatchKeyEvent", {
        type: "keyDown",
        key: action.key,
        text: action.key.length === 1 ? action.key : undefined,
      });
      await state.debuggerPort.sendCommand("Input.dispatchKeyEvent", {
        type: "keyUp",
        key: action.key,
      });
      return { key: action.key };
    }
    if (action.type === "eval") {
      const response = await state.debuggerPort.sendCommand("Runtime.evaluate", {
        expression: `Promise.resolve((${action.fn})())`,
        awaitPromise: true,
        returnByValue: true,
      });
      if (response?.exceptionDetails) {
        throw statusError(
          400,
          cdpExceptionMessage(response.exceptionDetails, "eval 执行失败")
        );
      }
      return response?.result?.value;
    }
    if (action.type === "wait_for") {
      return this.waitFor(state, action, signal);
    }
    if (action.type === "scroll" && !action.ref) {
      await state.debuggerPort.sendCommand("Runtime.evaluate", {
        expression: `window.scrollBy({top:${action.dy},behavior:"instant"})`,
        returnByValue: true,
      });
      return { dy: action.dy };
    }

    const ref = "ref" in action ? action.ref : undefined;
    if (!ref) throw statusError(400, "动作缺少 ref");
    const route = this.requireRef(state, ref);
    const objectId = await this.resolveObject(state, route);
    if (action.type === "click") {
      return this.callOn(
        state,
        objectId,
        `function(){ this.click(); return {clicked:true}; }`,
        [],
        route.sessionId
      );
    }
    if (action.type === "fill") {
      return this.callOn(
        state,
        objectId,
        `function(value){
          this.focus();
          const prototype = Object.getPrototypeOf(this);
          const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
          if (setter) setter.call(this, value); else this.value = value;
          this.dispatchEvent(new Event("input", {bubbles:true}));
          this.dispatchEvent(new Event("change", {bubbles:true}));
          return {filled:true};
        }`,
        [{ value: action.value }],
        route.sessionId
      );
    }
    if (action.type === "select") {
      return this.callOn(
        state,
        objectId,
        `function(value){
          this.value = value;
          this.dispatchEvent(new Event("input", {bubbles:true}));
          this.dispatchEvent(new Event("change", {bubbles:true}));
          return {selected:this.value};
        }`,
        [{ value: action.value }],
        route.sessionId
      );
    }
    if (action.type === "scroll") {
      return this.callOn(
        state,
        objectId,
        `function(dy){ this.scrollBy({top:dy,behavior:"instant"}); return {dy}; }`,
        [{ value: action.dy }],
        route.sessionId
      );
    }
    throw statusError(400, "不支持的浏览器动作");
  }

  private async waitFor(
    state: HarnessState,
    action: Extract<BrowserAction, { type: "wait_for" }>,
    signal: AbortSignal
  ) {
    const deadline = Date.now() + action.timeout_ms;
    while (Date.now() < deadline) {
      signal.throwIfAborted();
      let found = false;
      if (action.ref) {
        const route = this.requireRef(state, action.ref);
        const objectId = await this.resolveObject(state, route);
        const visible = await this.callOn(
          state,
          objectId,
          `function(){ const r=this.getBoundingClientRect(); const s=getComputedStyle(this); return !!(r.width&&r.height&&s.visibility!=="hidden"&&s.display!=="none"); }`,
          [],
          route.sessionId
        );
        found = visible === true;
      }
      if (action.text) {
        const response = await state.debuggerPort.sendCommand("Runtime.evaluate", {
          expression: `document.body?.innerText.includes(${JSON.stringify(action.text)}) === true`,
          returnByValue: true,
        });
        found ||= response?.result?.value === true;
      }
      if (found) return { found: true };
      await delay(100, undefined, { signal });
    }
    throw statusError(408, "wait_for 超时");
  }

  /** 统一解包 callFunctionOn：页面内异常必须失败动作，绝不带着异常信封谎报 ok。 */
  private async callOn(
    state: HarnessState,
    objectId: string,
    functionDeclaration: string,
    args: Array<{ value: unknown }>,
    sessionId?: string
  ): Promise<unknown> {
    const response = await state.debuggerPort.sendCommand(
      "Runtime.callFunctionOn",
      {
        objectId,
        functionDeclaration,
        arguments: args,
        awaitPromise: true,
        returnByValue: true,
      },
      sessionId
    );
    if (response?.exceptionDetails) {
      throw statusError(
        400,
        cdpExceptionMessage(response.exceptionDetails, "页面动作执行失败")
      );
    }
    return response?.result?.value;
  }
}

const INTERACTIVE_ROLES = new Set([
  "button",
  "checkbox",
  "combobox",
  "link",
  "listbox",
  "menuitem",
  "option",
  "radio",
  "searchbox",
  "slider",
  "spinbutton",
  "switch",
  "tab",
  "textbox",
]);

function flattenFrameIds(root: unknown) {
  const ids: Array<string | undefined> = [undefined];
  const visit = (value: unknown) => {
    if (!isRecord(value) || !Array.isArray(value.childFrames)) return;
    for (const child of value.childFrames) {
      if (!isRecord(child)) continue;
      const frame = isRecord(child.frame) ? child.frame : {};
      if (typeof frame.id === "string") ids.push(frame.id);
      visit(child);
    }
  };
  visit(root);
  return ids;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

const stringValue = (value?: AxValue) =>
  typeof value?.value === "string" ? value.value : "";
const compactText = (value: string) => value.replace(/\s+/g, " ").trim().slice(0, 500);
const escapeSnapshot = (value: string) =>
  value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("\n", "\\n");
const booleanProperty = (node: AxNode, name: string) =>
  node.properties?.some(
    (property) => property.name === name && property.value?.value === true
  ) ?? false;
const bucket = (candidate: Candidate) =>
  candidate.interactive
    ? "interactive"
    : candidate.offscreen
      ? "offscreen"
      : "viewportText";
const jsonBytes = (value: unknown) =>
  Buffer.byteLength(JSON.stringify(value), "utf8");
const actionLabel = (action: BrowserAction) =>
  ({
    goto: "打开页面",
    click: "点击",
    fill: "填写",
    press: "按键",
    select: "选择",
    scroll: "滚动",
    wait_for: "等待",
    eval: "读取页面",
    back: "后退",
    forward: "前进",
    reload: "刷新",
  })[action.type];

const cdpExceptionMessage = (
  details: { text?: string; exception?: { description?: string } },
  fallback: string
) => (details.exception?.description ?? details.text ?? fallback).slice(0, 500);

const isUserStop = (cause: unknown) =>
  cause instanceof UserStoppedBrowserBatchError ||
  (cause instanceof Error && "code" in cause && cause.code === "stopped_by_user");
const asError = (cause: unknown) =>
  cause instanceof Error ? cause : new Error(String(cause));
function statusError(status: number, message: string) {
  return Object.assign(new Error(message), { status });
}
