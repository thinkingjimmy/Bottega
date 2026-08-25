/**
 * [INPUT]: Depends on the provider Port/InstallSpec shape, OpenVikingProvider and EverOSProvider
 * [OUTPUT]: Provides the only MemoryProviderModule registry and its derivatives: MEMORY_PROVIDER_IDS, descriptor lists, config panels, installationSpec and createProvider factories containing model assets/PyPI master packages/real destination parsing contracts; Internal consistency of the module asserts when loaded
 * [POS]: The main/memory plugins are registered at the single point; enum/installer/panel/tender is all derived from this, and the new provider just changed this file with its own adapter
 */

import { EverOSProvider } from "./everos";
import { OpenVikingProvider } from "./openviking";
import type { MemoryProviderModule } from "../core/provider";

/* ============================================================
 * 一个模块 = descriptor + 工厂 + 可选安装规格 + 可选配置面板。
 * 除了这张表，产品里不该存在第二处「有哪些 provider」的知识。
 * ============================================================ */

const openviking: MemoryProviderModule = {
  descriptor: {
    id: "openviking",
    displayName: "OpenViking",
    summary:
      "清理精确到 workspace——删掉一个范围，其余的留着。",
    homepage: "https://github.com/volcengine/OpenViking",
    commitModel: "async-task",
    purgeModel: "workspace-purge",
    managed: true,
    defaultBaseUrl: "http://127.0.0.1:1933",
    configPanelId: "openviking-model",
    lockedVersion: "0.4.11",
  },
  createProvider: ({ baseUrl }) => new OpenVikingProvider(baseUrl),
  installSpec: {
    providerId: "openviking",
    launchLabel: "ai.openviking.server",
    lockedVersion: "0.4.11",
    pythonVersion: "3.12",
    executable: "openviking-server",
    serveArgs: ["--config", "{{dataRoot}}/ov.conf"],
    initMode: "builder",
    configFiles: ["ov.conf"],
    /* OV 是 per-arch 编译 wheel（cp310-abi3），没有可统一锁 SHA 的
       单一产物——走 uv 的精确锁版安装；逐架构哈希校验入延后账本。 */
    artifacts: [],
    /* 随 lockedVersion 一起复核：上游的规格表与包版本解耦——0.4.11 与
       0.4.16 实测指向同一个模型文件，因此这份常量不需要跟着每次升版
       改，但每次改 lockedVersion 都必须回来确认它仍是同一份。 */
    modelAssets: [
      {
        filename: "bge-small-zh-v1.5-f16.gguf",
        url: "https://huggingface.co/CompendiumLabs/bge-small-zh-v1.5-gguf/resolve/main/bge-small-zh-v1.5-f16.gguf?download=true",
        bytes: 47_886_240,
        sha256:
          "ab9b81d9cd329c712eee379cf0068eabe6a5e2a01d0def61535eba9384085e2c",
      },
    ],
    pypiPackage: "openviking",
    /* 与 dev/openviking-e2e.lock 的复现指令同源：运行时关键包精确锁版。
       OpenViking 0.4.11 把 str 直接交给 xxhash；4.0.0 改为只收 bytes，
       会让每次向量主键 partial update 失败，因此它不是可漂移的实现细节。 */
    pinnedPackages: [
      "mcp==1.29.0",
      "llama-cpp-python==0.3.34",
      "xxhash==3.8.1",
    ],
    staticEnv: {},
    configBuilders: {
      "ov.conf": ({ dataRoot, installRoot, values }) => ({
        storage: { workspace: `${dataRoot}/workspace` },
        embedding: {
          dense: {
            provider: "local",
            model: "bge-small-zh-v1.5-f16",
            cache_dir: `${installRoot}/models`,
            dimension: 512,
          },
        },
        vlm: {
          provider: "openai",
          model: values.OPENVIKING_LLM_MODEL,
          api_key: values.OPENVIKING_LLM_API_KEY,
          api_base: values.OPENVIKING_LLM_BASE_URL,
          temperature: 0,
          max_retries: 2,
        },
        server: { host: "127.0.0.1", port: 1933, auth_mode: "dev" },
      }),
    },
    extractionDestination: {
      file: "ov.conf",
      baseUrlPath: ["vlm", "api_base"],
      modelPath: ["vlm", "model"],
    },
  },
  configPanel: {
    panelId: "openviking-model",
    providerId: "openviking",
    title: "OpenViking 提取模型",
    description:
      "密钥、Base URL 与模型名只保存在本机 secrets 与 0600 受管 ov.conf 中，不进入 LaunchAgent、不上传。支持 OpenAI 兼容服务，例如 DeepSeek；手工接管 ov.conf 后需在文件中自行更新。",
    fields: [
      {
        key: "OPENVIKING_LLM_API_KEY",
        label: "提取模型 API Key",
        description: "必填；用于从对话中提取长期记忆。",
        secret: true,
        retainedWhenBlank: true,
        required: true,
        transport: "file",
      },
      {
        key: "OPENVIKING_LLM_BASE_URL",
        label: "Base URL",
        description: "OpenAI 兼容接口地址；DeepSeek 可填 https://api.deepseek.com/v1。",
        secret: false,
        retainedWhenBlank: false,
        required: false,
        defaultValue: "https://api.openai.com/v1",
        transport: "file",
        format: "model-base-url",
      },
      {
        key: "OPENVIKING_LLM_MODEL",
        label: "Model",
        description: "提取模型名；使用 DeepSeek 时可填 deepseek-chat。",
        secret: false,
        retainedWhenBlank: false,
        required: false,
        defaultValue: "gpt-4.1-mini",
        transport: "file",
      },
    ],
  },
};

const everos: MemoryProviderModule = {
  descriptor: {
    id: "everos",
    displayName: "EverOS",
    summary:
      "清理会重置整个 runtime——所有范围一次性清空。",
    homepage: "https://github.com/EverMind-AI/EverOS",
    commitModel: "sync",
    purgeModel: "runtime-reset",
    managed: true,
    defaultBaseUrl: "http://127.0.0.1:1934",
    configPanelId: "everos-secrets",
    lockedVersion: "1.2.1",
  },
  createProvider: ({ baseUrl }) => new EverOSProvider(baseUrl),
  installSpec: {
    providerId: "everos",
    launchLabel: "ai.everos.server",
    lockedVersion: "1.2.1",
    pythonVersion: "3.12",
    executable: "everos",
    /* CLI 真值（sdist entrypoints/cli/main.py）：serve 挂在 server
       子应用下，init 是顶级命令；两者都收 --root <dataRoot>。 */
    serveArgs: ["server", "start", "--root", "{{dataRoot}}"],
    initMode: "argv",
    initArgs: ["init", "--root", "{{dataRoot}}"],
    /* init 的两个产出（init_cmd.py）：everos.toml + ome.toml。
       缺一从已安装包模板补齐，缺二才真正跑 init。 */
    configFiles: ["everos.toml", "ome.toml"],
    artifacts: [
      {
        url: "https://files.pythonhosted.org/packages/08/23/135f48195411fecee6a7df387071d0140d55e096e1601db64328d28bad33/everos-1.2.1.tar.gz",
        filename: "everos-1.2.1.tar.gz",
        sha256:
          "2ea75f30856715916059de9f3ed9356694da1a573139f6e7ee144b13e5421d03",
      },
    ],
    pinnedPackages: [],
    /* 静态 env 键名以 sdist config/settings.py 为准（EVEROS_<节>__<键>）：
       不含任何密钥，第一阶段就能装好文件；LLM 密钥是 EverOS 的启动级
       硬依赖，经 config-write 写入 plist 后服务才起得来——这是 D6
       两阶段的物理基础。 */
    staticEnv: {
      EVEROS_MEMORIZE__MODE: "chat",
      EVEROS_API__PORT: "1934",
    },
  },
  configPanel: {
    panelId: "everos-secrets",
    providerId: "everos",
    title: "EverOS 提取密钥",
    description:
      "EverOS 需要模型服务密钥才能启动并提取长期记忆。密钥与可选设置保存在本机 secrets 和 LaunchAgent，不读取 CLI 凭据、不上传；支持 DeepSeek 等 OpenAI 兼容服务。",
    fields: [
      {
        key: "EVEROS_LLM__API_KEY",
        label: "提取模型 API Key",
        description: "用于长期记忆提取的模型服务密钥（OpenAI 兼容）。",
        secret: true,
        retainedWhenBlank: true,
        required: true,
        transport: "env",
      },
      {
        key: "EVEROS_LLM__BASE_URL",
        label: "Base URL",
        description: "OpenAI 兼容接口地址；DeepSeek 可填 https://api.deepseek.com/v1。",
        secret: false,
        retainedWhenBlank: false,
        required: false,
        defaultValue: "https://api.openai.com/v1",
        transport: "env",
        format: "model-base-url",
      },
      {
        key: "EVEROS_LLM__MODEL",
        label: "Model",
        description: "提取模型名；使用 DeepSeek 时可填 deepseek-chat。",
        secret: false,
        retainedWhenBlank: false,
        required: false,
        defaultValue: "gpt-4.1-mini",
        transport: "env",
      },
    ],
  },
};

export const MEMORY_PROVIDER_MODULES: readonly MemoryProviderModule[] = [
  openviking,
  everos,
];

/* 单文件注册的代价是 id 在 descriptor/installSpec/configPanel 里各出现
   一次；装载时断言同源，写错一处立即在启动与测试里炸出来，而不是在
   运行期把安装规格找错主。 */
for (const module of MEMORY_PROVIDER_MODULES) {
  const id = module.descriptor.id;
  if (module.installSpec && module.installSpec.providerId !== id) {
    throw new Error(`Memory 注册表不一致：${id} 的 installSpec 属于别家`);
  }
  if (
    module.installSpec &&
    module.installSpec.lockedVersion !== module.descriptor.lockedVersion
  ) {
    throw new Error(`Memory 注册表不一致：${id} 的 lockedVersion 两处不同`);
  }
  if (module.configPanel) {
    if (module.configPanel.providerId !== id) {
      throw new Error(`Memory 注册表不一致：${id} 的 configPanel 属于别家`);
    }
    if (module.configPanel.panelId !== module.descriptor.configPanelId) {
      throw new Error(`Memory 注册表不一致：${id} 的 configPanelId 两处不同`);
    }
  } else if (module.descriptor.configPanelId !== null) {
    throw new Error(`Memory 注册表不一致：${id} 声明了面板却没有提供`);
  }
}

export const MEMORY_PROVIDER_IDS = MEMORY_PROVIDER_MODULES.map(
  (module) => module.descriptor.id
);

export const MEMORY_PROVIDER_DESCRIPTORS = MEMORY_PROVIDER_MODULES.map(
  (module) => module.descriptor
);

export const MEMORY_CONFIG_PANELS = MEMORY_PROVIDER_MODULES.flatMap((module) =>
  module.configPanel ? [module.configPanel] : []
);

export function memoryModule(providerId: string) {
  return (
    MEMORY_PROVIDER_MODULES.find(
      (module) => module.descriptor.id === providerId
    ) ?? null
  );
}

export function requireMemoryModule(providerId: string) {
  const module = memoryModule(providerId);
  if (!module) throw new Error(`未知的 Memory provider：${providerId}`);
  return module;
}

export const DEFAULT_MEMORY_PROVIDER_ID = MEMORY_PROVIDER_MODULES[0]!.descriptor.id;
