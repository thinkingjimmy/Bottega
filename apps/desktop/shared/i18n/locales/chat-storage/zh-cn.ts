/**
 * [INPUT]: Depends on the English Chat-storage catalog shape
 * [OUTPUT]: Provides Simplified Chinese Chat-storage failure copy
 * [POS]: Simplified Chinese leaf for user-facing Chat-storage failures
 */

import { chatStorageEn } from "./en";

export const chatStorageZhCN: typeof chatStorageEn = {
  technicalDetails: "技术详情",
  copyDetails: "复制技术详情",
  copiedDetails: "已复制技术详情",
  code: {
    "file-quarantined": {
      title: "有一个聊天暂时无法打开",
      explanation: "Bottega 无法读取这个聊天，已保留原文件并跳过它。其他聊天不受影响。",
      resolution: "请更新并重启 Bottega。如果仍然出现，请保留备份，并复制技术详情联系支持。",
    },
    "backup-failed": {
      title: "聊天数据无法读取，也未能创建备份",
      explanation: "Bottega 已停止处理且没有修改这个文件，以免数据进一步丢失。",
      resolution: "请检查磁盘空间和文件权限，然后重启 Bottega。如果仍然失败，请复制技术详情联系支持。",
    },
    "recovery-conflict": {
      title: "发现多个无法安全恢复的聊天副本",
      explanation: "Bottega 无法确认哪个副本正确，因此没有覆盖或删除任何文件。",
      resolution: "请保留这些文件，不要手动修改，并复制技术详情联系支持。",
    },
  },
};
