/**
 * [INPUT]: The shared encrypted-sync copy contract.
 * [OUTPUT]: Simplified Chinese setup, immediate password validation, unlock and recovery messages.
 * [POS]: Shared desktop and Web encryption presentation.
 */
import type { CloudEncryptionCopy } from "./en";
export const zhCN: CloudEncryptionCopy = {
  setupInProgress: "正在开启同步…", setupConnectionFailed: "网络连接失败，请检查网络后重试。",
  title: "解锁同步工作区", description: "请输入在桌面端设置的同步密码。", password: "同步密码", confirmation: "确认同步密码",
  setPassword: "设置同步密码", setupDescription: "密码至少需要 8 个字符，包含英文字母和数字。请妥善保管，Bottega 无法找回此密码。",
  risk: "我了解密码丢失后，云端数据可能无法恢复。", inProgress: "正在保护同步内容…",
  unlock: "解锁", unlocking: "正在解锁…", checking: "正在检查加密同步…", remember: "保持此浏览器解锁",
  rememberDescription: "在此浏览器保存加密的解锁密钥，你随时可以重新锁定。", remembered: "此浏览器将记住解锁密钥。", thisPageOnly: "仅在当前页面保持解锁。",
  saving: "正在保存解锁密钥…", saveFailed: "当前已解锁，但解锁密钥未能保存。下次可能仍需输入同步密码。", saveRetry: "重试保存解锁密钥",
  cachedStorageUnavailable: "安全本地存储不可用。重新打开应用时，可能需要再次输入同步密码。", cacheUnreadable: "无法读取已保存的解锁密钥，请输入同步密码继续。",
  cacheClearFailed: "未能移除已保存的解锁密钥。请重试，以取消此浏览器记住的解锁状态。", lock: "锁定此浏览器", locked: "同步工作区已锁定",
  offlineTitle: "联网后解锁工作区", offlineDescription: "浏览器需要先核验账号，才能解锁已保存的内容。加密缓存会保留。",
  unavailable: "未能检查加密同步，请重试。",
  reviewExpired: "本次扫描已过期，请重新扫描后确认。", connectionFailed: "网络暂时不可用。恢复联网后会继续加密同步。", retry: "重试", cancel: "取消", account: "账号与设备",
  showPassword: "显示密码", hidePassword: "隐藏密码", passwordMismatch: "两次输入的密码不一致。", independentPassword: "此密码独立于 Google 账号密码，只用于解锁同步内容。",
  unrecoverableCloud: "请妥善保存同步加密密码。Google 账号找回无法恢复同步加密密码。如果密码丢失，也没有任何设备能解密旧数据，仅存在云端的内容就无法恢复。",
  secureSaveFailedDesktop: "未能在此电脑安全保存解锁密钥，同步尚未开启。请先重试保存，再开启同步。",
  legacyUnsupported: "此账号仍有旧版同步格式的数据，处理完成前无法开启加密同步。",
  passwordTooShort: "密码至少需要 8 个字符。",
  "sync-password-invalid": "密码至少需要 8 个字符，且不超过 1,024 个 UTF-8 字节。部分字符会占用多个字节。",
  "sync-password-weak": "密码需要同时包含英文字母和数字。",
  "sync-unlock-failed": "此同步密码未能解锁工作区，请检查后重试。", "sync-integrity-failed": "无法验证此加密内容，请重新加载最新内容后重试。",
  "sync-encryption-unsupported": "此浏览器或设备无法运行所需的加密功能，请使用最新版 Chrome 或 Bottega 桌面端。",
  "sync-space-changed": "加密工作区或其密钥已发生变化，访问已暂停。请先核对账号和恢复信息。",
  "sync-operation-cancelled": "已取消解锁。", "sync-operation-busy": "另一项加密操作正在进行，请等待完成或取消。", "sync-locked": "请先解锁同步工作区。",
  checkingDescription: "正在查找此账号的加密空间。",
  unavailableTitle: "无法检查加密同步", unavailableDescription: "重试再查一次；你的登录信息已保留。",
  unsupportedTitle: "此浏览器无法运行加密同步", lockFailedTitle: "锁定未完成",
  cancelledDescription: "已取消解锁。输入同步密码可再试一次。",
  lockedDescription: "此浏览器已锁定，请输入同步密码继续。",
  missingUnlock: "此浏览器没有保存解锁信息，请重新输入同步密码。",
};
