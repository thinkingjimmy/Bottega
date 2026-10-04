/**
 * [INPUT]: Depends on the English Bottega Dock key set.
 * [OUTPUT]: Provides zh-cn Bottega Dock copy using macOS's Simplified Chinese names (程序坞, 访达, 下载, 废纸篓, 系统设置).
 * [POS]: system-dock locale slice mounted as `systemDock` by the Simplified Chinese root catalog.
 */
import type { systemDockEn } from "./en";

export const systemDockZhCN: typeof systemDockEn = {
  presence: {
    retentionOffTitle: "要关闭后台运行吗？",
    retentionOffBody: "Bottega Dock 已开启。关闭后台运行后，关闭最后一个 Bottega 窗口会退出 Bottega，Bottega Dock 随之关闭，系统程序坞恢复显示。",
    retentionOffConfirm: "关闭",
  },
  settings: { title: "程序坞" },
};
