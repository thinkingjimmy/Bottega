/**
 * [INPUT]: Depends on the results of the Runtime.evaluate and DOM.getBoxModel in the BrowserDebuggerPort
 * [OUTPUT]: Provides the CDP decoration layer function for injecting, moving, removing Agent virtual spotlight
 * [POS]: The main/browser's pure visual feedback layer; Pointer-events: none, never involved in element positioning, action successfully determined or security authorized
 */

import type { BrowserDebuggerPort } from "./browser-service";

const ROOT_ID = "__ai_chat_agent_browser_overlay__";

function command(
  debuggerPort: BrowserDebuggerPort,
  expression: string,
  sessionId?: string
) {
  return debuggerPort.sendCommand(
    "Runtime.evaluate",
    { expression, returnByValue: true },
    sessionId
  );
}

export async function showAgentOverlay(
  debuggerPort: BrowserDebuggerPort,
  label: string,
  point?: { x: number; y: number },
  sessionId?: string
) {
  const safeLabel = JSON.stringify(label);
  const safePoint = JSON.stringify(point ?? { x: 24, y: 24 });
  // 装饰层是纯观感：导航瞬间 context 销毁等注入失败一律吞掉，绝不影响动作成败。
  await command(
    debuggerPort,
    `(() => {
      const id = ${JSON.stringify(ROOT_ID)};
      let root = document.getElementById(id);
      if (!root) {
        root = document.createElement("div");
        root.id = id;
        root.setAttribute("aria-hidden", "true");
        root.style.cssText = "position:fixed;inset:0;z-index:2147483647;pointer-events:none;";
        root.innerHTML = '<div data-pointer style="position:absolute;width:18px;height:24px;transform:translate(-2px,-2px);filter:drop-shadow(0 1px 2px rgba(0,0,0,.35))"><svg viewBox="0 0 18 24" width="18" height="24"><path d="M2 1l13 13-6 .7 3.5 7-3 1.5-3.4-7L2 20z" fill="#fff" stroke="#111" stroke-width="1.2"/></svg></div><div data-label style="position:absolute;max-width:240px;padding:4px 7px;border-radius:6px;background:#111;color:#fff;font:500 12px/1.35 system-ui,sans-serif;box-shadow:0 2px 10px rgba(0,0,0,.25);white-space:nowrap;overflow:hidden;text-overflow:ellipsis"></div>';
        (document.documentElement || document.body).appendChild(root);
      }
      const point = ${safePoint};
      const pointer = root.querySelector("[data-pointer]");
      const tag = root.querySelector("[data-label]");
      pointer.style.left = point.x + "px";
      pointer.style.top = point.y + "px";
      tag.style.left = (point.x + 16) + "px";
      tag.style.top = (point.y + 18) + "px";
      tag.textContent = ${safeLabel};
    })()`,
    sessionId
  ).catch(() => undefined);
}

export async function removeAgentOverlay(
  debuggerPort: BrowserDebuggerPort,
  sessionId?: string
) {
  await command(
    debuggerPort,
    `document.getElementById(${JSON.stringify(ROOT_ID)})?.remove()`,
    sessionId
  ).catch(() => undefined);
}

export function boxCenter(model: unknown): { x: number; y: number } | undefined {
  const content = (model as { model?: { content?: unknown } })?.model?.content;
  if (
    !Array.isArray(content) ||
    content.length < 8 ||
    content.some((value) => typeof value !== "number")
  ) {
    return undefined;
  }
  const xs = [content[0], content[2], content[4], content[6]] as number[];
  const ys = [content[1], content[3], content[5], content[7]] as number[];
  return {
    x: xs.reduce((sum, value) => sum + value, 0) / xs.length,
    y: ys.reduce((sum, value) => sum + value, 0) / ys.length,
  };
}
