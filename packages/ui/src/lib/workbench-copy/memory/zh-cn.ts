/**
 * [INPUT]: Depends on the Memory plugin metadata, settings and pause impact contracts.
 * [OUTPUT]: Provides zh-cn copy for the official Memory plugin.
 * [POS]: Localized Memory feature copy within the workbench catalog.
 */
export const memoryPluginCopy = {
  "name": "Memory",
  "summary": "从对话中回忆有用的信息，共享范围由你选择。",
  "description": "Memory 记住对话里有用的信息，在需要时带回来，比如上周做过的决定、你喜欢的报告写法。\n\n共享范围由你选择：每个对话内、每个 Project 内，或所有对话之间。提取使用你选的模型，可能产生费用，所以开启前会先征得你的同意。已有的历史不会被处理。",
  "settings": {
    "backend": {
      "label": "记忆后端"
    },
    "sharingMode": {
      "label": "共享范围"
    },
    "phoneFacade": {
      "label": "在手机与 Web 上查看和控制 Memory"
    },
    "workflowRoles": {
      "label": "允许流程角色读取 Memory"
    }
  },
  "sharing": {
    "chat": "当前对话",
    "group": "当前项目",
    "personal": "所有对话"
  },
  "capability": {
    "recall": "在你选择的共享范围内回忆信息",
    "capture": "经你授权后保存符合条件的信息",
    "backfill": "仅处理你已授权的历史对话"
  },
  "confirmation": {
    "title": "确认 Memory 更改",
    "cutover": "使用所选后端。记忆提取使用 {{hostname}} 的 {{model}}，可能产生模型费用。不包含现有历史对话。",
    "chat": "今后的 Memory 仅在各自对话内使用。记忆提取使用 {{hostname}} 的 {{model}}，可能产生模型费用。不包含现有历史对话。",
    "group": "今后的 Memory 在各自项目内共享。记忆提取使用 {{hostname}} 的 {{model}}，可能产生模型费用。不包含现有历史对话。",
    "personal": "今后的 Memory 在所有对话间共享。记忆提取使用 {{hostname}} 的 {{model}}，可能产生模型费用。不包含现有历史对话。"
  },
  "effects": {
    "recall": "暂停新对话轮次和流程轮次的记忆召回。",
    "capture": "暂停新增记忆，保留已保存的记忆。",
    "backfill": "暂停常规历史处理。",
    "phone": "暂停手机与 Web 对话的 Memory。",
    "rebuild": "已授权的重建会继续，仍可能产生模型费用。"
  },
  "health": {
    "backend": "后端",
    "version": "已安装版本",
    "sharing": "共享范围",
    "service": "状态",
    "directory": "数据目录",
    "unknown": "尚未确认",
    "unsupported": "Memory 目前支持 macOS。",
    "missing": "请在 Memory 设置中安装所选后端。",
    "configuration": "请在 Memory 设置中完成后端配置。",
    "repair": "请在 Memory 设置中检查或修复后端。",
    "off": "完成设置后即可使用 Memory。",
    "paused": "已暂停，记忆数据已保留。",
    "ready": "已就绪",
    "checking": "正在检查后端…"
  }
};
