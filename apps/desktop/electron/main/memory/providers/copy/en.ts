/**
 * [INPUT]: Depends on the shared MemoryBackendCopy contract only.
 * [OUTPUT]: Provides backend-owned en copy for summaries, configuration and release behavior.
 * [POS]: Main-only Memory backend localization; descriptors carry it to settings over IPC.
 */
import type { MemoryBackendCopy } from "../../../../../shared/ipc/content/memory-ipc";

export const backendCopyEn = {
    openviking: {
      unverifiedVersionWarning: "This release has not been validated by the product. It reuses the locked release's model specification and existing files; if upstream changes the model filename, OpenViking may download it itself on first launch without app progress.",
      summary: "Cleanup is workspace-scoped — deleting one scope leaves the rest.",
      panel: { title: "OpenViking extraction model", description: "The key, Base URL, and model stay in local secrets and a managed 0600 ov.conf. Manual takeover means editing that file directly." },
      field: {
        OPENVIKING_LLM_API_KEY: { label: "Extraction API key", description: "Required to extract long-term memory from conversations." },
        OPENVIKING_LLM_BASE_URL: { label: "Base URL", description: "OpenAI-compatible endpoint, such as https://api.deepseek.com/v1." },
        OPENVIKING_LLM_MODEL: { label: "Model", description: "Extraction model name, such as deepseek-chat." },
      },
    },
    everos: {
      summary: "Cleanup resets the whole runtime — every scope goes at once.",
      panel: { title: "EverOS extraction credentials", description: "EverOS needs a model-service key to start. Credentials stay in local secrets and LaunchAgent; CLI credentials are never read." },
      field: {
        EVEROS_LLM__API_KEY: { label: "Extraction API key", description: "OpenAI-compatible model-service key used for memory extraction." },
        EVEROS_LLM__BASE_URL: { label: "Base URL", description: "OpenAI-compatible endpoint, such as https://api.deepseek.com/v1." },
        EVEROS_LLM__MODEL: { label: "Model", description: "Extraction model name, such as deepseek-chat." },
      },
    },
  } satisfies Record<string, MemoryBackendCopy>;
