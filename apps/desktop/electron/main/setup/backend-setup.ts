/**
 * [INPUT]: Depends on the runtime registry, version cache, model-catalog change notifications, fixed terminal delivery, credential reservations and trusted Setup IPC.
 * [OUTPUT]: Owns installation-only/full check scopes, per-Agent coordination, scope-preserving terminal return checks, and notifyModelsInvalidated as the single models-invalidated sink.
 * [POS]: Main setup coordinator; registration stays passive and the workbench requests full checks after onboarding.
 */

import type { BrowserWindow } from "electron";
import type { AppLocale } from "@ai-chat/ui/lib/locale";
import type {
  AgentBackendId,
  BackendInfo,
} from "../../../shared/agent-ipc";
import {
  SETUP_CHANNEL,
  type SetupEvent,
  type SetupStatus,
  type SetupTerminalAction,
  type SetupCheckScope,
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
import { onModelCatalogChanged } from "../backends/model-catalog";
import { rendererIpc } from "../ipc-registrar";
import { reserveAgentCredentialUse } from "../agent-process-supervisor";
import { LatestVersionCache } from "./latest-version";
import { launchSetupTerminalAction } from "./terminal-action";

type CheckFlight<T> = { scope: SetupCheckScope; promise: Promise<T> };

export class BackendSetupService {
  private window: BrowserWindow | null = null;
  private readonly latest = new LatestVersionCache();
  private unsubscribeRuntime?: () => void;
  private unsubscribeTurns?: () => void;
  private unsubscribeModels?: () => void;
  private readonly subscribers = new Map<string, TrustedRendererContext>();
  /* 已把用户送去外部终端登录、但还没回来对账的后端。
     登录动作是一句"这个后端的认证态即将改变"的声明——而模型目录的 TTL
     对此一无所知，于是登录完回来还能看见至多五分钟的旧（免费）模型集。 */
  private readonly awaitingLogin = new Set<AgentBackendId>();
  private readonly pendingActions = new Map<AgentBackendId, SetupTerminalAction>();
  private readonly returnScopes = new Map<AgentBackendId, SetupCheckScope>();
  private readonly terminalFlights = new Map<AgentBackendId, Promise<Awaited<ReturnType<typeof launchSetupTerminalAction>>>>();
  private readonly automaticFlights = new Map<AgentBackendId, CheckFlight<unknown>>();
  private readonly checkFlights = new Map<AgentBackendId, CheckFlight<SetupStatus>>();
  private readonly credentialActions = new Map<AgentBackendId, ReturnType<typeof reserveAgentCredentialUse>>();

  constructor(private readonly locale: () => AppLocale = () => "en",
    private readonly launchTerminal: typeof launchSetupTerminalAction = launchSetupTerminalAction) {}

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
    /* 启动期的目录来自磁盘缓存，后台刷新才是当下事实。只有主进程知道两者
       不一致——renderer 早已按缓存画完，不会自己再问一次。 */
    this.unsubscribeModels?.();
    this.unsubscribeModels = onModelCatalogChanged((backend) => this.notifyModelsInvalidated(backend));
    register(rendererUrl, "拒绝非主窗口的初始化请求")
      .handle(SETUP_CHANNEL.check, () => this.check())
      .handle(SETUP_CHANNEL.refreshIfNeeded, (scope) => this.refreshIfNeeded(this.assertScope(scope)))
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
      .handleWithContext(SETUP_CHANNEL.recheck, (context, backend, scope) => {
        this.assertResidence(context);
        return this.recheck(this.assertBackend(backend), "user-recheck", this.assertScope(scope));
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
      if (this.terminalFlights.has(backend)) continue;
      void this.recheck(backend, "login-return", this.returnScopes.get(backend)).catch(() => undefined);
    }
  }

  async check(): Promise<SetupStatus> {
    return { backends: backendRuntimeRegistry.listSnapshots().map((base) => this.withLatest(base)) };
  }

  async refreshIfNeeded(scope: SetupCheckScope = "full"): Promise<SetupStatus> {
    await Promise.all(orderedBackends().map(({ id }) => this.refreshOne(id, scope)));
    return this.check();
  }

  private refreshOne(backend: AgentBackendId, scope: SetupCheckScope): Promise<unknown> {
    if (this.terminalFlights.has(backend) || this.awaitingLogin.has(backend)) return Promise.resolve();
    const existing = this.checkFlights.get(backend) ?? this.automaticFlights.get(backend);
    if (existing) return scope === "full" && existing.scope === "installation"
      ? existing.promise.then(() => this.refreshOne(backend, scope)) : existing.promise;
    if (scope === "full") void this.refreshLatest(backend, false);
    const task = (scope === "installation" ? backendRuntimeRegistry.resolve(backend)
      : backendRuntimeRegistry.refreshIfNeeded(backend)).finally(() => {
      if (this.automaticFlights.get(backend)?.promise === task) this.automaticFlights.delete(backend);
    });
    this.automaticFlights.set(backend, { scope, promise: task });
    return task;
  }

  recheck(backend: AgentBackendId, intent: "user-recheck" | "login-return" = "user-recheck", scope: SetupCheckScope = "full"): Promise<SetupStatus> {
    const existing = this.checkFlights.get(backend);
    if (existing) return scope === "full" && existing.scope === "installation"
      ? existing.promise.then(() => this.recheck(backend, intent, scope)) : existing.promise;
    const task = this.runRecheck(backend, intent, scope).finally(() => {
      if (this.checkFlights.get(backend)?.promise === task) this.checkFlights.delete(backend);
    });
    this.checkFlights.set(backend, { scope, promise: task });
    return task;
  }

  private async runRecheck(backend: AgentBackendId, intent: "user-recheck" | "login-return", scope: SetupCheckScope) {
    await this.terminalFlights.get(backend);
    /* Recheck 是用户在说"我刚在外面动过它"。运行时结论会重算，模型目录
       却缩在 TTL 里不动——于是登录完回来仍看见空目录，还以为是本应用的
       毛病。缓存跟着复检一起作废，广播让 renderer 强制重取。 */
    backendById(backend).models?.invalidate?.();
    this.awaitingLogin.delete(backend);
    this.pendingActions.delete(backend);
    this.returnScopes.delete(backend);
    if (scope === "full") void this.refreshLatest(backend, intent === "user-recheck");
    const reservation = this.credentialActions.get(backend);
    const check = scope === "installation" ? backendRuntimeRegistry.resolve(backend, true)
      : intent === "user-recheck" ? backendRuntimeRegistry.recheck(backend) : backendRuntimeRegistry.fullCheck(backend, intent);
    const snapshot = await check.finally(() => {
      if (reservation) this.releaseCredentialAction(backend, reservation);
    });
    const status = this.info(backend, snapshot);
    this.send({ type: "status", backend, status });
    if (scope === "full") this.send({ type: "models-invalidated", backend });
    return this.check();
  }

  /**
   * A background catalog refresh disagreed with the cached list the renderer
   * already painted. Same contract as a Recheck: re-fetch, do not wait for TTL.
   */
  notifyModelsInvalidated(backend: AgentBackendId) {
    this.send({ type: "models-invalidated", backend });
  }

  async refreshLatest(backend: AgentBackendId, force: boolean) {
    const descriptor = backendById(backend);
    const load = descriptor.setup?.latestVersion;
    if (!load) return this.latest.current(backend);
    const request = this.latest.refresh(backend, load, force);
    if (this.latest.current(backend)?.checking) this.send({ type: "latest-version", backend, checking: true });
    const entry = await request;
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
    this.unsubscribeTurns = undefined;
    this.unsubscribeModels?.();
    this.unsubscribeModels = undefined;
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
      scope?: unknown;
    };
    if ("command" in candidate) throw new Error("renderer 不得提交 raw command");
    const backend = this.assertBackend(candidate.backend);
    const scope = this.assertScope(candidate.scope);
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
    if (this.terminalFlights.has(backend)) throw new Error("An Agent setup action is already opening");
    const priorCheck = this.checkFlights.get(backend)?.promise;
    const priorAutomatic = this.automaticFlights.get(backend)?.promise;
    const task = (async () => {
      await Promise.all([priorCheck, priorAutomatic]);
      let reservation: ReturnType<typeof reserveAgentCredentialUse> | undefined;
      try {
        const result = await this.launchTerminal(this.window, command, { locale: this.locale, beforeLaunch: async () => {
          await backendRuntimeRegistry.waitForCheck(backend);
          reservation = reserveAgentCredentialUse(backend);
          await reservation.ready;
        } });
        if (result.delivery === "terminal" && result.launched) {
          this.releaseCredentialAction(backend);
          if (reservation) this.credentialActions.set(backend, reservation);
          this.awaitingLogin.add(backend);
          this.pendingActions.set(backend, action);
          this.returnScopes.set(backend, scope);
          backendRuntimeRegistry.invalidate(backend);
        } else reservation?.release();
        return result;
      } catch (error) { reservation?.release(); throw error; }
    })().finally(() => {
      if (this.terminalFlights.get(backend) === task) this.terminalFlights.delete(backend);
    });
    this.terminalFlights.set(backend, task);
    return task;
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
      setupAction: this.pendingActions.get(base.id),
      ...(latest ? { latestVersion: latest } : {}),
      ...(latest && base.version
        ? { updateAvailable: isVersionNewer(latest, base.version) }
        : {}),
    };
  }

  private assertBackend(value: unknown) {
    return backendById(value as AgentBackendId).id;
  }

  private assertScope(value: unknown): SetupCheckScope {
    if (value === undefined || value === "full") return "full";
    if (value === "installation") return value;
    throw new Error("Invalid setup check scope");
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
