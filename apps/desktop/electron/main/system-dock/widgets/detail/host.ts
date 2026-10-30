/**
* [INPUT]: Depends on verified accepted or temporary preview packages, the shared sender router, gateway, private sandbox preload and strict Dock RPCs.
* [OUTPUT]: Provides one isolated native owner per detail/preview context with independent partitions, scope validation, gesture actions, continuous liveness and exact release.
* [POS]: Main-owned author execution boundary; bar/main renderers and system Dock recovery never run or depend on author code.
*/
import { WebContentsView, ipcMain, session, type BrowserWindow, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron';
import { randomBytes } from 'node:crypto';
import { join, extname } from 'node:path';
import { canonicalJson } from '@bottega/contracts/core/canonical-json';
import { DOCK_RPC_BUDGET, DOCK_SESSION_TIMING, dockClientSessionSchema, parseDockRpcRequest, validateDockDataSnapshot, type DockRpcRequest } from '@bottega/contracts/plugins/dock/session';
import { DOCK_DETAIL_CHANNEL as CHANNEL, DOCK_DETAIL_ARGUMENT, type DockDetailSlot, type DockDetailChange } from '../../../../../shared/system-dock/widgets/native';
import type { DockSurfaceLease } from '../../../plugins/surface-runtime/gateway';
import { widgetDetailKey } from './scope';
import type { DockWidgetDetailPort, WidgetDetailPorts, WidgetDetailSource } from './ports';
import {createDockDetailRouter} from './router';
const routes=createDockDetailRouter(ipcMain);
type NativeSession = {
  view: WebContentsView;
  panel: BrowserWindow;
  source: WidgetDetailSource;
  key: string;
  nonce: string;
  id: string;
  lease: DockSurfaceLease | null;
  controller: AbortController;
  createdAt: number;
  lastHeartbeat: number;
  ready: boolean;
  timer: ReturnType<typeof setInterval> | null;
  closeTimer: ReturnType<typeof setTimeout> | null;
  second: number;
  calls: number;
  pending: number;
  gesture: number;
  gestureAt: number;
  usedGesture: number;
  preferences: string;
  nextActionsAt: number;
  releaseRPC():void;
};
const mime = (path: string) => ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.woff': 'font/woff', '.woff2': 'font/woff2' }[extname(path)] ?? 'application/octet-stream');
export class DockWidgetDetailHost implements DockWidgetDetailPort {
  private panel: BrowserWindow | null = null;
  private itemId: string | null = null;
  private slot: DockDetailSlot | null = null;
  private active: NativeSession | null = null;
  private epoch = 0;
  private accountEpoch = 0;
  private account = '';
  private closed = false;
  private admission: Promise<void> | null = null;
  private admittingKey: string | null = null;
  private readonly faults = new Set<string>();
  private readonly requests = new Set<Promise<unknown>>();
  private unwatchPanel: (() => void) | null = null;
  private partition: Electron.Session | null = null;
  private readonly denyDownload = (event: Electron.Event) => event.preventDefault();
  private readonly changed = () => this.reconcile();
  private readonly gesture = (event: IpcMainEvent, nonce: unknown, sequence: unknown) => {
    const current = this.sender(event, nonce);
    if (!current || !Number.isSafeInteger(sequence) || Number(sequence) !== current.gesture + 1) {
      return;
    }
    current.gesture = Number(sequence);
    current.gestureAt = Date.now();
    this.ports.focusPanel();
  };
  private readonly escape = (event: IpcMainEvent, nonce: unknown) => {
    if (this.sender(event, nonce)) {
      this.ports.closePanel();
    }
  };
  private readonly fault = (event: IpcMainEvent, nonce: unknown) => {
    const current = this.sender(event, nonce);
    if (current) {
      this.retire(current, true);
    }
  };
  constructor(private readonly ports: WidgetDetailPorts) {}
  presented(panel: BrowserWindow | null, itemId: string | null) {
    if (this.closed) {
      return;
    }
    if (this.panel !== panel) {
      this.unwatchPanel?.();
      this.unwatchPanel = null;
      if (panel) {
        panel.on('hide', this.changed);
        panel.on('closed', this.changed);
        panel.on('resize', this.changed);
        this.unwatchPanel = () => {
          panel.removeListener('hide', this.changed);
          panel.removeListener('closed', this.changed);
          panel.removeListener('resize', this.changed);
        };
      }
    }
    if (this.panel !== panel || this.itemId !== itemId) {
      this.epoch++;
      if (this.active) {
        this.retire(this.active, false);
      }
      this.slot = null;
    }
    this.panel = panel;
    this.itemId = itemId;
    this.reconcile();
  }
  bounds(slot: DockDetailSlot) {
    if (this.closed || slot.itemId !== this.itemId) {
      return;
    }
    const source = this.current();
    if (!source || widgetDetailKey(source) !== slot.key) {
      return;
    }
    this.slot = slot;
    this.reconcile();
  }
  retry(itemId: string, key: string) {
    const source = this.current();
    if (!source || source.item.id !== itemId || widgetDetailKey(source) !== key) {
      throw new Error('DOCK_DETAIL_SCOPE_CHANGED');
    }
    this.faults.delete(key);
    this.reconcile();
  }
  presentation(source: WidgetDetailSource) {
    const key = widgetDetailKey(source);
    return { key, state: this.faults.has(key) ? 'failed' as const : this.active?.key === key ? (this.active.ready ? 'ready' as const : 'loading' as const) : this.admittingKey === key ? 'loading' as const : 'available' as const };
  }
  health() {
    return { detail: { views: this.active && !this.active.view.webContents.isDestroyed() ? 1 : 0, sessions: this.active?.lease ? 1 : 0, timers: Number(Boolean(this.active?.timer)) + Number(Boolean(this.active?.closeTimer)), requests: this.requests.size + Number(this.admission !== null) } };
  }
  reconcile() {
    if (this.closed) {
      return;
    }
    const source = this.current(), key = source ? widgetDetailKey(source) : null;
    if (this.active && !this.live(this.active)) {
      this.retire(this.active, Boolean(this.active.lease && this.active.lease.expiresAt <= Date.now()));
    }
    if (this.admittingKey && this.admittingKey !== key) {
      this.epoch++;
    }
    if (this.active) {
      this.place(this.active);
      this.notify(this.active, { kind: 'data' });
      return;
    }
    if (source && this.slot?.key === key && !this.faults.has(key!) && !this.admission && !this.admittingKey) {
      this.admit(source);
    }
  }
  private current() {
    if (this.closed || !this.panel || this.panel.isDestroyed() || !this.panel.isVisible() || !this.itemId) {
      return null;
    }
    const source = this.ports.source(this.itemId);
    return source?.manifest.dock.detail.kind === 'surface' ? source : null;
  }
  private live(current: NativeSession) {
    const source = this.current();
    return this.active === current && !current.controller.signal.aborted && !current.view.webContents.isDestroyed() && current.panel === this.panel && source !== null && widgetDetailKey(source) === current.key && (!current.lease || current.lease.expiresAt > Date.now());
  }
  private admit(source: WidgetDetailSource) {
    const epoch = this.epoch, key = widgetDetailKey(source), panel = this.panel!;
    this.admittingKey = key;
    this.ports.changed();
    const admitted = () => !this.closed && epoch === this.epoch && this.panel === panel && this.current() !== null && widgetDetailKey(this.current()!) === key && this.slot?.key === key;
    const task = (async () => {
      const packet = await this.ports.packages.read(source.accepted.widget.definition.packageRef);
      if (!admitted()) {
        return;
      }
      const definition = source.accepted.widget.definition;
      if (packet.descriptor.source.accountId !== source.accepted.scope.accountId || packet.descriptor.source.installationId !== definition.sourceInstallationId || packet.descriptor.source.definitionId !== definition.definitionId || packet.descriptor.source.generationId !== definition.generationId || packet.descriptor.contractDigest !== definition.contractDigest) {
        throw new Error('DOCK_DETAIL_PACKAGE_CHANGED');
      }
      const partitionName=this.ports.contextKind==='authoring-preview'?'dock-widget-preview':'dock-widget-detail';
      const partition = session.fromPartition(partitionName);
      if (!this.partition) {
        this.partition = partition;
        partition.on('will-download', this.denyDownload);
      }
      partition.setPermissionRequestHandler((_contents, _permission, answer) => answer(false));
      partition.setPermissionCheckHandler(() => false);
      partition.setDevicePermissionHandler(() => false);
      partition.webRequest.onBeforeRequest((details, answer) => {
        const active = this.active;
        let allowed = false;
        try {
          allowed = Boolean(active && this.live(active) && new URL(details.url).origin === active.lease?.origin);
        }
        catch { /* Unknown schemes are denied. */
        }
        answer({ cancel: !allowed });
      });
      const nonce = randomBytes(32).toString('hex'), view = new WebContentsView({ webPreferences: { preload: join(this.ports.mainDirectory, '../preload/system-dock-detail.js'), additionalArguments: [DOCK_DETAIL_ARGUMENT + nonce], partition: partitionName, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, spellcheck: false, backgroundThrottling: false } });
      const now = Date.now(), current: NativeSession = { view, panel, source, key, nonce, id: randomBytes(16).toString('hex'), lease: null, controller: new AbortController(), createdAt: now, lastHeartbeat: now, ready: false, timer: null, closeTimer: null, second: 0, calls: 0, pending: 0, gesture: 0, gestureAt: 0, usedGesture: 0, preferences: '', nextActionsAt: now + 30000,releaseRPC:()=>undefined };
      this.active = current;
      try {
        current.releaseRPC=routes.register(view.webContents,{request:(event,nonce,raw,gesture)=>this.request(event,nonce,raw,gesture),gesture:this.gesture,escape:this.escape,fault:this.fault});
        const files = packet.files.filter(file => file.path.startsWith('runtime/gui/')).map(file => {
          const path = file.path.slice('runtime/gui/'.length), fact = packet.descriptor.files.find(value => value.path === file.path)!;
          return { path, mime: mime(path), bytes: Buffer.from(file.content, 'base64'), sha256: fact.sha256 };
        });
        current.lease = this.ports.gateway.issueDock({ definitionId: definition.definitionId, generationId: definition.generationId, artifactDigest: packet.descriptor.digests.contentDigest, files, operations: source.manifest.operations, isValid: () => this.live(current) }, view.webContents.id);
        view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
        view.webContents.on('will-navigate', event => {
          if (!this.document(current, event.url)) {
            event.preventDefault();
          }
        });
        view.webContents.on('will-redirect', event => event.preventDefault());
        view.webContents.on('will-attach-webview', event => event.preventDefault());
        view.webContents.on('render-process-gone', () => {
          if (this.active === current) {
            this.retire(current, true);
          }
        });
        view.webContents.on('destroyed', () => {
          if (this.active === current) {
            this.retire(current, true);
          }
        });
        panel.contentView.addChildView(view);
        this.place(current);
        current.timer = setInterval(() => this.tick(current), 250);
        current.timer.unref?.();
        void view.webContents.loadURL(current.lease.url).catch(() => {
          if (this.active === current) {
            this.retire(current, true);
          }
        });
      }
      catch (error) {
        this.retire(current, true);
        throw error;
      }
    })().catch(() => {
      if (admitted()) {
        this.rememberFault(key);
        this.ports.changed();
      }
    }).finally(() => {
      if (this.admission === task) {
        this.admission = null;
        this.admittingKey = null;
        this.ports.changed();
        this.reconcile();
      }
    });
    this.admission = task;
  }
  private document(current: NativeSession, value: string) {
    try {
      const url = new URL(value);
      url.hash = '';
      return url.href === current.lease?.url;
    }
    catch {
      return false;
    }
  }
  private sender(event: IpcMainEvent | IpcMainInvokeEvent, nonce: unknown) {
    const current = this.active;
    if (!current || nonce !== current.nonce || event.sender !== current.view.webContents || event.senderFrame !== current.view.webContents.mainFrame || !this.live(current) || !this.document(current, event.senderFrame.url)) {
      return null;
    }
    return current;
  }
  private request(event: IpcMainInvokeEvent, nonce: unknown, raw: unknown, gesture: unknown) {
    const current = this.sender(event, nonce);
    if (!current) {
      return Promise.reject(new Error('DOCK_SESSION_UNAVAILABLE'));
    }
    const tick = Math.floor(Date.now() / 1000);
    if (tick !== current.second) {
      current.second = tick;
      current.calls = 0;
    }
    if (++current.calls > DOCK_RPC_BUDGET.requestsPerSecond || current.pending >= DOCK_RPC_BUDGET.pending) {
      return Promise.reject(new Error('DOCK_RPC_CAPACITY'));
    }
    let input: DockRpcRequest;
    try {
      input = parseDockRpcRequest(raw as string);
    }
    catch {
      return Promise.reject(new Error('DOCK_RPC_INVALID'));
    }
    if (!current.source.manifest.operations.includes(input.operation)) {
      return Promise.reject(new Error('DOCK_OPERATION_DENIED'));
    }
    current.pending++;
    let abort: (() => void) | undefined;
    const cancelled = new Promise<never>((_resolve, reject) => {
      abort = () => reject(new Error('DOCK_SESSION_UNAVAILABLE'));
      current.controller.signal.addEventListener('abort', abort, { once: true });
    });
    const run = (async () => {
      await this.ports.gateway.validateDock(current.lease!.id, current.view.webContents.id);
      if (!this.live(current)) {
        throw new Error('DOCK_SESSION_UNAVAILABLE');
      }
      const value = await this.dispatch(current, input, gesture);
      if (input.operation !== 'dock.close' && !this.live(current)) {
        throw new Error('DOCK_SESSION_UNAVAILABLE');
      }
      if (Buffer.byteLength(JSON.stringify(value ?? null)) > DOCK_RPC_BUDGET.outputBytes) {
        throw new Error('DOCK_RPC_OUTPUT_BUDGET');
      }
      return value;
    })();
    const pending = Promise.race([run, cancelled]).catch(error => {
      const message = error instanceof Error && /^DOCK_[A-Z_]+$/.test(error.message) ? error.message : 'DOCK_REQUEST_FAILED';
      throw new Error(message);
    }).finally(() => {
      if (abort) {
        current.controller.signal.removeEventListener('abort', abort);
      }
      current.pending--;
      this.requests.delete(pending);
    });
    this.requests.add(pending);
    return pending;
  }
  private async dispatch(current: NativeSession, input: DockRpcRequest, gesture: unknown) {
    const source = this.current()!;
    if (input.operation === 'dock.open') {
      const account = canonicalJson(source.accepted.scope);
      if (account !== this.account) {
        this.account = account;
        this.accountEpoch++;
      }
      return dockClientSessionSchema.parse({ sessionId: current.id, scope: { kind: this.ports.contextKind??'dock-detail', definitionId: source.manifest.id, generationId: source.accepted.widget.definition.generationId, ownerKind: this.ports.contextKind==='authoring-preview'?'authoring-draft':'instance', ownerId: source.item.id, accountEpoch: this.accountEpoch, revision: source.accepted.revision }, name: source.item.label ?? source.manifest.name, settings: source.accepted.widget.settings, locale: this.ports.locale(), theme: this.ports.theme(), operations: source.manifest.operations });
    }
    if (input.operation === 'dock.heartbeat') {
      current.lastHeartbeat = Date.now();
      if (input.payload.ready && !current.ready) {
        current.ready = true;
        this.ports.changed();
      }
      return {};
    }
    if (input.operation === 'dock.data.read') {
      return validateDockDataSnapshot({ readings: this.ports.read(source.item.id, input.payload.sources), actions: source.manifest.operations.includes('dock.action') ? this.actions(current) : [] });
    }
    if (input.operation === 'dock.action') {
      if (gesture !== current.gesture || current.gesture <= current.usedGesture || Date.now() - current.gestureAt > 5000) {
        throw new Error('DOCK_ACTION_UNAVAILABLE');
      }
      current.usedGesture = current.gesture;
      await this.ports.invokeAction('native:'+current.id,source.item.id,input.payload.ref,()=>this.live(current));
      return {};
    }
    current.closeTimer = setTimeout(() => {
      current.closeTimer = null;
      if (this.active === current) {
        this.ports.closePanel();
      }
    }, 0);
    return {};
  }
  private actions(current: NativeSession) {
    return this.ports.actions('native:'+current.id,current.source.item.id);
  }
  private tick(current: NativeSession) {
    if (!this.live(current)) {
      this.retire(current, Boolean(current.lease && current.lease.expiresAt <= Date.now()));
      return;
    }
    const now = Date.now();
    if (now - (current.ready ? current.lastHeartbeat : current.createdAt) >= DOCK_SESSION_TIMING.timeoutMs) {
      this.retire(current, true);
      return;
    }
    const preferences = canonicalJson([this.ports.locale(), this.ports.theme()]);
    if (preferences !== current.preferences) {
      current.preferences = preferences;
      this.notify(current, { kind: 'preferences', locale: this.ports.locale(), theme: this.ports.theme() });
    }
    if (now >= current.nextActionsAt) {
      current.nextActionsAt = now + 30000;
      this.notify(current, { kind: 'data' });
    }
  }
  private notify(current: NativeSession, value: DockDetailChange) {
    if (this.live(current)) {
      current.view.webContents.send(CHANNEL.changed, value);
    }
  }
  private place(current: NativeSession) {
    const slot = this.slot;
    if (!slot || slot.key !== current.key || current.panel.isDestroyed()) {
      return;
    }
    const bounds = current.panel.getContentBounds(), x = Math.max(0, Math.min(Math.round(slot.bounds.x), bounds.width - 1)), y = Math.max(44, Math.min(Math.round(slot.bounds.y), bounds.height - 45));
    const width = Math.max(1, Math.min(Math.round(slot.bounds.width), bounds.width - x)), height = Math.max(1, Math.min(Math.round(slot.bounds.height), bounds.height - 44 - y));
    current.view.setBounds({ x, y, width, height });
  }
  private rememberFault(key: string) {
    while (this.faults.size >= 100) {
      this.faults.delete(this.faults.values().next().value!);
    }
    this.faults.add(key);
  }
  private retire(current: NativeSession, failed: boolean) {
    if (this.active !== current) {
      return;
    }
    this.active = null;
    current.releaseRPC();
    current.controller.abort();
    if (current.timer) {
      clearInterval(current.timer);
    }
    current.timer = null;
    if (current.closeTimer) {
      clearTimeout(current.closeTimer);
    }
    current.closeTimer = null;
    this.ports.releaseActions('native:'+current.id);
    if (current.lease) {
      this.ports.gateway.release(current.lease.id, current.view.webContents.id);
    }
    if (failed) {
      this.rememberFault(current.key);
    }
    try {
      if (!current.panel.isDestroyed()) {
        current.panel.contentView.removeChildView(current.view);
      }
    }
    catch { /* The parent can disappear first. */
    }
    const contents = current.view.webContents;
    if (!contents.isDestroyed()) {
      if (failed && !contents.isCrashed()) {
        contents.forcefullyCrashRenderer();
      }
      contents.close({ waitForBeforeUnload: false });
    }
    this.ports.changed();
  }
  async close() {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.epoch++;
    this.unwatchPanel?.();
    this.unwatchPanel = null;
    if (this.active) {
      this.retire(this.active, false);
    }
    this.panel = null;
    this.slot = null;
    this.itemId = null;
    await this.admission;
    await Promise.allSettled([...this.requests]);
    if (this.partition) {
      this.partition.removeListener('will-download', this.denyDownload);
      this.partition.webRequest.onBeforeRequest(null);
      this.partition = null;
    }
    this.faults.clear();
  }
}
