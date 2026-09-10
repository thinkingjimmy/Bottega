/**
 * [INPUT]: Depends on BrowserWindow, shared AppLocale, backend runtime registry, latest-version cache, fixed terminal action and setup IPC
 * [OUTPUT]: Coordinates terminal authentication with quota cleanup and owns passive runtime reads, cached background update discovery, combined explicit rechecks, one-shot login returns and residence-fenced App management.
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
import { surfaceWindowController } from "../window/surfaces/surface-window-controller";
import { windowRegistry } from "../window/surfaces/window-registry";
import { rendererIdentity } from "../window/renderer-identity";
import type { TrustedRendererContext } from "../window/surfaces/trusted-renderer-context";
import { isVersionNewer } from "../backends/runtime-probe";
import { rendererIpc } from "../ipc-registrar";
import { reserveAgentCredentialUse } from "../agent-process-supervisor";
import { LatestVersionCache } from "./latest-version";
import { launchSetupTerminalAction } from "./terminal-action";

export class BackendSetupService {
  private window: BrowserWindow | null = null;
  private readonly latest = new LatestVersionCache();
  private unsubscribeRuntime?: () => void;
  private unsubscribeTurns?: () => void;
  private started = false;
  private readonly subscribers = new Map<string, TrustedRendererContext>();
  /* 已把用户送去外部终端登录、但还没回来对账的后端。
     登录动作是一句"这个后端的认证态即将改变"的声明——而模型目录的 TTL
     对此一无所知，于是登录完回来还能看见至多五分钟的旧（免费）模型集。 */
  private readonly awaitingLogin = new Set<AgentBackendId>();
  private readonly credentialActions = new Map<AgentBackendId, ReturnType<typeof reserveAgentCredentialUse>>();

  constructor(private readonly locale: () => AppLocale = () => "en") {}

  register(window: BrowserWindow, rendererUrl: string, register = rendererIpc) {
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
    this.unsubscribeTurns?.();
    this.unsubscribeTurns = backendRuntimeRegistry.subscribeTurnEvidence((evidence) => this.send({ type: "turn-evidence", evidence }));
    if (!this.started) {
      this.started = true;
      for (const descriptor of orderedBackends()) {
        void backendRuntimeRegistry.fullCheck(descriptor.id, "startup");
        void this.refreshLatest(descriptor.id, false);
      }
    }
    register(rendererUrl, "拒绝非主窗口的初始化请求")
      .handle(SETUP_CHANNEL.check, () => this.check())
      .handle(SETUP_CHANNEL.refreshLatest, (backend) =>
        this.refreshLatest(this.assertBackend(backend), true)
      )
      .handle(SETUP_CHANNEL.terminalAction, (value) =>
        this.terminalAction(value)
      )
      .roles("main", "app-window")
      .handleWithContext(SETUP_CHANNEL.watch, (context) => {
        this.assertResidence(context);
        this.subscribers.set(context.windowId, context);
      })
      .handleWithContext(SETUP_CHANNEL.recheck, (context, backend) => {
        this.assertResidence(context);
        return this.recheck(this.assertBackend(backend));
      })
      .handleWithContext(SETUP_CHANNEL.cancelCheck, (context, backend) => {
        this.assertResidence(context);
        backendRuntimeRegistry.cancelCheck(this.assertBackend(backend));
      })
      .handleWithContext(SETUP_CHANNEL.openManagement, (context, ...args) => {
        this.assertResidence(context);
        if (args.length) throw new Error("Agent management accepts no route or URL");
        const main = windowRegistry.main();
        if (!main || !windowRegistry.focus(main.windowId)) throw new Error("Open the main window to manage Agents");
        main.window.webContents.send(SETUP_CHANNEL.event, { type: "open-backends" } satisfies SetupEvent);
      });
    /* 「登录引导完成回到 app」这件事，在主进程里唯一看得见的信号就是窗口
       重新获得焦点。只对 awaitingLogin 里的后端作废，所以普通 alt-tab 不会
       把每次切窗都变成一次 15s 子进程探测。 */
    window.on("focus", () => this.reconcileLogins());
    window.once("closed", () => {
      if (this.window === window) {
        this.window = null;
      }
    });
  }

  private reconcileLogins() {
    for (const backend of this.awaitingLogin) {
      backendById(backend).models?.invalidate?.();
      this.send({ type: "models-invalidated", backend });
      const reservation = this.credentialActions.get(backend);
      void backendRuntimeRegistry.fullCheck(backend, "login-return").finally(() => {
        if (reservation) this.releaseCredentialAction(backend, reservation);
      });
    }
    this.awaitingLogin.clear();
  }

  async check(): Promise<SetupStatus> {
    return { backends: backendRuntimeRegistry.listSnapshots().map((base) => this.withLatest(base)) };
  }

  async recheck(backend: AgentBackendId) {
    /* Recheck 是用户在说"我刚在外面动过它"。运行时结论会重算，模型目录
       却缩在 TTL 里不动——于是登录完回来仍看见空目录，还以为是本应用的
       毛病。缓存跟着复检一起作废，广播让 renderer 强制重取。 */
    backendById(backend).models?.invalidate?.();
    this.awaitingLogin.delete(backend);
    void this.refreshLatest(backend, true);
    const reservation = this.credentialActions.get(backend);
    const snapshot = await backendRuntimeRegistry.recheck(backend).finally(() => {
      if (reservation) this.releaseCredentialAction(backend, reservation);
    });
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
      checking: entry.checking,
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
    for (const backend of this.credentialActions.keys()) this.releaseCredentialAction(backend);
    this.unsubscribeRuntime?.();
    this.unsubscribeRuntime = undefined;
    this.unsubscribeTurns?.();
    this.subscribers.clear();
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
    const reservation = reserveAgentCredentialUse(backend);
    try {
      await reservation.ready;
      backendRuntimeRegistry.invalidate(backend);
      const result = await launchSetupTerminalAction(this.window, command, { locale: this.locale });
      if (result.delivery === "terminal" && result.launched) {
        this.releaseCredentialAction(backend);
        this.credentialActions.set(backend, reservation);
        this.awaitingLogin.add(backend);
      } else reservation.release();
      return result;
    } catch (error) { reservation.release(); throw error; }
  }

  private releaseCredentialAction(backend: AgentBackendId, reservation = this.credentialActions.get(backend)) {
    if (this.credentialActions.get(backend) !== reservation) return;
    reservation?.release();
    this.credentialActions.delete(backend);
  }

  private info(
    backend: AgentBackendId,
    snapshot: Parameters<typeof backendRuntimeRegistry.toBackendInfo>[1]
  ): BackendInfo {
    const base = backendRuntimeRegistry.toBackendInfo(backend, snapshot);
    return this.withLatest(base);
  }

  private withLatest(base: BackendInfo): BackendInfo {
    const latest = this.latest.current(base.id)?.version;
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

  private assertResidence(context: TrustedRendererContext) {
    if (context.role === "main") return;
    if (!context.appId) throw new Error("App window identity is missing");
    surfaceWindowController.assertAppStudioMutation(context, context.appId);
  }

  private send(event: SetupEvent) {
    for (const [id, context] of this.subscribers) {
      if (context.role === "main") continue;
      try {
        if (!windowRegistry.get(id) || rendererIdentity(context.webContentsId).rendererSessionId !== context.rendererIncarnation) throw new Error("Expired renderer");
        this.assertResidence(context);
        if (event.type === "open-backends") continue;
        if (event.type === "turn-evidence") surfaceWindowController.assertAppConversationRead(context, event.evidence.conversationId);
        context.window.webContents.send(SETUP_CHANNEL.event, event);
      } catch {
        if (event.type !== "turn-evidence") this.subscribers.delete(id);
      }
    }
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send(SETUP_CHANNEL.event, event);
    }
  }
}
