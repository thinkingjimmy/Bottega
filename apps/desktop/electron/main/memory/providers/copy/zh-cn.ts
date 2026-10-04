/**
 * [INPUT]: Depends on the shared MemoryBackendCopy contract only.
 * [OUTPUT]: Provides backend-owned zh-CN copy for summaries, configuration and release behavior.
 * [POS]: Main-only Memory backend localization; descriptors carry it to settings over IPC.
 */
import type { MemoryBackendCopy } from "../../../../../shared/ipc/content/memory-ipc";

export const backendCopyZhCN = {
    openviking: {
      unverifiedVersionWarning: "该版本未经产品验证；模型沿用锁定版规格与既有文件。仅当上游改用新模型文件名时，首启才会由 OpenViking 无进度自行下载。",
      summary: "清理精确到 workspace——删掉一个范围，其余的留着。",
      panel: { title: "OpenViking 提取模型", description: "密钥、Base URL 与模型名只保存在本机 secrets 与 0600 受管 ov.conf；手工接管后需直接编辑文件。" },
      field: {
        OPENVIKING_LLM_API_KEY: { label: "提取模型 API Key", description: "必填；用于从对话中提取长期记忆。" },
        OPENVIKING_LLM_BASE_URL: { label: "Base URL", description: "OpenAI 兼容接口地址，例如 https://api.deepseek.com/v1。" },
        OPENVIKING_LLM_MODEL: { label: "Model", description: "提取模型名，例如 deepseek-chat。" },
      },
    },
    everos: {
      summary: "清理会重置整个 runtime——所有范围一次性清空。",
      panel: { title: "EverOS 提取密钥", description: "EverOS 需要模型服务密钥才能启动。凭据只留在本机 secrets 与 LaunchAgent，不读取 CLI 凭据。" },
      field: {
        EVEROS_LLM__API_KEY: { label: "提取模型 API Key", description: "用于长期记忆提取的 OpenAI 兼容模型服务密钥。" },
        EVEROS_LLM__BASE_URL: { label: "Base URL", description: "OpenAI 兼容接口地址，例如 https://api.deepseek.com/v1。" },
        EVEROS_LLM__MODEL: { label: "Model", description: "提取模型名，例如 deepseek-chat。" },
      },
    },
  } satisfies Record<string, MemoryBackendCopy>;
