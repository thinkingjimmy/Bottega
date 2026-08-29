/**
 * [INPUT]: Depends on Electron app/dialog ports and the injected reversible/terminal shutdown operations from the composition root
 * [OUTPUT]: Installs the before-quit fence, user-visible recovery notice, and SafeQuitCoordinator terminal handoff
 * [POS]: Electron lifecycle adapter around safe-quit.ts; service ownership and close order remain explicit in index.ts
 */

import type { app, dialog } from "electron";
import {
  SafeQuitCoordinator,
  type SafeQuitPorts,
} from "./safe-quit";

export function installApplicationQuit(
  application: Pick<typeof app, "on" | "quit">,
  dialogs: Pick<typeof dialog, "showErrorBox">,
  ports: Omit<SafeQuitPorts, "notify" | "quit">
) {
  const safeQuit = new SafeQuitCoordinator({
    ...ports,
    notify: (recovered) =>
      dialogs.showErrorBox(
        "无法安全退出",
        recovered
          ? "退出准备发生错误，应用已恢复运行，聊天功能仍可使用。请稍后重试。"
          : "退出准备未能恢复。应用保持运行，但聊天与标题生成已禁用；请处理残留 Agent 进程后重试。"
      ),
    quit: () => application.quit(),
  });
  application.on("before-quit", (event) => {
    if (safeQuit.finished) return;
    event.preventDefault();
    void safeQuit.prepare("quit").then((ready) => {
      if (ready) application.quit();
    });
  });
  return safeQuit;
}
