/**
 * [INPUT]: The shared protection copy contract.
 * [OUTPUT]: Simplified Chinese offline reading, the per-device offline switch and phone offer, background mask, secure-storage recovery and biometric setting messages.
 * [POS]: Shared Cloud Web / mobile shell presentation.
 */
import type { CloudProtectionCopy } from "./en";
export const zhCN: CloudProtectionCopy = {
  offlineBanner: "离线 · 上次同步 {{time}}", offlineBannerUnknown: "离线 · 正在显示已保存的内容",
  offlineReadOnly: "只读。重新联网后即可发送、编辑和下载。", reconnecting: "正在重新连接…",
  savedChats: "已保存的对话", allChats: "全部对话",
  offlineEmpty: "此设备还没有保存对话。联网后即可加载工作区。", offlineChatMissing: "这个对话没有保存离线副本。",
  offlineEarlier: "更早的消息需要联网后查看。", offlineDecryptFailed: "已保存的内容无法解密。请联网后重新加载。",
  offlineUnavailableTitle: "联网后打开工作区",
  offlineExpired: "此设备距离上次联网已太久。请连接网络后继续阅读。",
  offlineNoSnapshot: "此设备尚未开启离线阅读。请在联网时到设置中开启。",
  offlineClock: "此设备的时钟被调早了。请连接网络以验证访问权限。",
  offlineOpening: "正在打开已保存的内容…", retry: "重试",
  maskTitle: "Bottega 已锁定", maskDescription: "验证身份后显示工作区。", maskResume: "解锁", maskVerifying: "正在验证…",
  maskCancelled: "已取消验证。可以再试一次，或使用同步密码。", usePassword: "使用同步密码",
  capabilityMissing: "此设备的安全存储暂时不可用，无法打开已保存的解锁密钥。请重启或更新 App，或输入同步密码继续。",
  biometricChanged: "指纹或面容设置已变化，已保存的解锁密钥无法再打开。请重新输入一次同步密码。",
  biometricLabel: "需要指纹或面容验证",
  biometricDescription: "每次回到 Bottega 时都用指纹或面容验证。若录入的指纹或面容发生变化，需要重新输入一次同步密码。",
  biometricNotEnrolled: "请先在手机设置中录入指纹或面容。",
  biometricNeedsKeepUnlocked: "请先用同步密码解锁并开启「保持解锁」。",
  biometricFailed: "设置未能保存，请重试。",
  offlinePhoneLabel: "在这台手机上离线保留对话",
  offlineBrowserLabel: "信任此浏览器用于离线阅读",
  offlineDescription: "保存此设备在无网络时打开已保存对话所需的内容。距离上次联网 30 天内都能离线打开，之后需要重新联网。已保存在此设备上的对话会一直保留，直到你关闭此选项、锁定此设备或退出登录。",
  offlineBrowserWarning: "只在你信任的浏览器中开启：能使用这个浏览器配置文件的人都能离线打开已保存的对话。",
  offlineChangeFailed: "离线阅读设置未能更改，请重试。",
  offlineOfferTitle: "在这台手机上离线保留对话？",
  offlineOfferBody: "距离这台手机上次联网 30 天内，已保存的对话无需网络也能打开。你可以随时在设置中关闭，关闭后离线副本会被移除。",
  offlineOfferAccept: "离线保留",
  offlineOfferDecline: "暂不",
};
