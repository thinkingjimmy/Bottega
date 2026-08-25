/**
 * [INPUT]: Depends on BrowserWindow, shared AppLocale, backend runtime registry, latest-version cache, fixed terminal action and setup IPC
 * [OUTPUT]: Provides BackendSetupService: non-blocking check, explicit recheck/latest refresh and list of terminal actions
 * [POS]: Setup the main process sorting layer; No download, uninstall, unload CLI, no holding or migration of credentials
 */

import type { BrowserWindow } from "electron";
import type { AppLocale } from "../../../shared/i18n/locale";
import type {
  AgentBackendId,
  BackendInfo,
} from "../../../shared/agent-ipc";
import {
  SETUP_CHANNEL,
  type SetupEvent,
  type SetupStatus,
  type SetupTerminalAction,
} from "../../../shared/setup-ipc";
import {
  backendById,
  backendRuntimeRegistry,
  orderedBackends,
} from "../backends";
import { isVersionNewer } from "../backends/runtime-probe";
import { rendererIpc } from "../ipc-registrar";
import { LatestVersionCache } from "./latest-version";
import { launchSetupTerminalAction } from "./terminal-action";

export class BackendSetupService {
  private window: BrowserWindow | null = null;
  private readonly latest = new LatestVersionCache();
  private unsubscribeRuntime?: () => void;
  /* 已把用户送去外部终端登录、但还没回来对账的后端。
     登录动作是一句"这个后端的认证态即将改变"的声明——而模型目录的 TTL
     对此一无所知，于是登录完回来还能看见至多五分钟的旧（免费）模型集。 */
  private readonly awaitingLogin = new Set<AgentBackendId>();

  constructor(private readonly locale: () => AppLocale = () => "en") {}

  register(window: BrowserWindow, rendererUrl: string) {
    this.window = window;
    this.unsubscribeRuntime?.();
    this.unsubscribeRuntime = backendRuntimeRegistry.subscribe(
      (backend, snapshot) => {
        this.send({
          type: "status",
          backend,
          status: this.info(backend, snapshot),
        });
      }
    );
    rendererIpc(window, rendererUrl, "拒绝非主窗口的初始化请求")
      .handle(SETUP_CHANNEL.check, () => this.check())
      .handle(SETUP_CHANNEL.recheck, (backend) =>
        this.recheck(this.assertBackend(backend))
      )
      .handle(SETUP_CHANNEL.refreshLatest, (backend) =>
        this.refreshLatest(this.assertBackend(backend), true)
      )
      .handle(SETUP_CHANNEL.terminalAction, (value) =>
        this.terminalAction(value)
      );
    /* 「登录引导完成回到 app」这件事，在主进程里唯一看得见的信号就是窗口
       重新获得焦点。只对 awaitingLogin 里的后端作废，所以普通 alt-tab 不会
       把每次切窗都变成一次 15s 子进程探测。 */
    window.on("focus", () => this.reconcileLogins());
    window.once("closed", () => {
      if (this.window === window) {
        this.window = null;
        this.unsubscribeRuntime?.();
        this.unsubscribeRuntime = undefined;
      }
    });
  }

  private reconcileLogins() {
    for (const backend of this.awaitingLogin) {
      backendById(backend).models?.invalidate?.();
      this.send({ type: "models-invalidated", backend });
    }
    this.awaitingLogin.clear();
  }

  async check(): Promise<SetupStatus> {
    const backends = await Promise.all(
      orderedBackends().map(async (descriptor) => {
        const snapshot = await backendRuntimeRegistry.resolve(descriptor.id);
        void this.refreshLatest(descriptor.id, false);
        return this.info(descriptor.id, snapshot);
      })
    );
    return { backends };
  }

  async recheck(backend: AgentBackendId) {
    /* Recheck 是用户在说"我刚在外面动过它"。运行时结论会重算，模型目录
       却缩在 TTL 里不动——于是登录完回来仍看见空目录，还以为是本应用的
       毛病。缓存跟着复检一起作废，广播让 renderer 强制重取。 */
    backendById(backend).models?.invalidate?.();
    this.awaitingLogin.delete(backend);
    const snapshot = await backendRuntimeRegistry.recheck(backend);
    const status = this.info(backend, snapshot);
    this.send({ type: "status", backend, status });
    this.send({ type: "models-invalidated", backend });
    return this.check();
  }

  async refreshLatest(backend: AgentBackendId, force: boolean) {
    const descriptor = backendById(backend);
    const load = descriptor.setup?.latestVersion;
    if (!load) return this.latest.current(backend);
    this.send({ type: "latest-version", backend, checking: true });
    const entry = await this.latest.refresh(backend, load, force);
    this.send({
      type: "latest-version",
      backend,
      checking: false,
      version: entry.version,
    });
    const snapshot = backendRuntimeRegistry.current(backend);
    if (snapshot) {
      this.send({
        type: "status",
        backend,
        status: this.info(backend, snapshot),
      });
    }
    return entry;
  }

  async shutdown() {
    this.unsubscribeRuntime?.();
    this.unsubscribeRuntime = undefined;
  }

  private async terminalAction(value: unknown) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("终端动作格式无效");
    }
    const candidate = value as {
      backend?: unknown;
      action?: unknown;
      command?: unknown;
    };
    if ("command" in candidate) throw new Error("renderer 不得提交 raw command");
    const backend = this.assertBackend(candidate.backend);
    if (
      candidate.action !== "install" &&
      candidate.action !== "update" &&
      candidate.action !== "login"
    ) {
      throw new Error("未知终端动作");
    }
    const action = candidate.action as SetupTerminalAction;
    const command = backendById(backend).setup?.commands[action];
    if (!command) throw new Error("当前后端不支持该终端动作");
    if (action === "login") this.awaitingLogin.add(backend);
    return launchSetupTerminalAction(this.window, command, {
      locale: this.locale,
    });
  }

  private info(
    backend: AgentBackendId,
    snapshot: Parameters<typeof backendRuntimeRegistry.toBackendInfo>[1]
  ): BackendInfo {
    const base = backendRuntimeRegistry.toBackendInfo(backend, snapshot);
    const latest = this.latest.current(backend)?.version;
    return {
      ...base,
      ...(latest ? { latestVersion: latest } : {}),
      ...(latest && base.version
        ? { updateAvailable: isVersionNewer(latest, base.version) }
        : {}),
    };
  }

  private assertBackend(value: unknown) {
    return backendById(value as AgentBackendId).id;
  }

  private send(event: SetupEvent) {
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send(SETUP_CHANNEL.event, event);
    }
  }
}
