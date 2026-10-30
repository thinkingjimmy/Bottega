/**
 * [INPUT]: Depends on authenticated immutable Cloud reviews, bounded precompiled archive custody, desired layout and the existing local application mapping queue.
 * [OUTPUT]: Provides verified metadata/defaults, explicit zero-instance/package installation and corrupt-cache repair, original-operation recovery, independent adoption, retention roots and durable local uninstall without a compiler or writable source.
 * [POS]: Main-only receiver installation owner; package approval never copies source or peer data permissions and never changes synchronized desired state.
 */
import {WidgetLocalUninstall} from "./uninstall";
import {installedWidgetDefinitions,savedInstalledWidget} from "./installed";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { z } from "zod";
import {
  canonicalJson,
  hashCanonical,
} from "@bottega/contracts/core/canonical-json";
import {
  validateWidgetPackageDescriptor,
  WIDGET_PACKAGE_BUDGET as BUDGET,
} from "@bottega/contracts/plugins/dock/packages";
import type { DockContribution } from "@bottega/contracts/plugins/dock/manifest";
import type { CustomDockWidget } from "../../../../../shared/system-dock/widgets/instance";
import type {
  WidgetInstallReview,
  WidgetInstallResult,
  WidgetInstallProgress,
} from "../../../../../shared/system-dock/widgets/install/types";
import {
  widgetInstallConfirmSchema,
  widgetUninstallSchema,
} from "../../../../../shared/system-dock/widgets/install/commands";
import { DurableJson } from "../../../persistence/durable-json";
import type {
  WidgetCloudPort,
  WidgetCloudReview,
  FrozenWidgetPacket,
} from "../../../cloud/widgets/ports";
import { verifyPackage } from "../../../plugins/surface-runtime/packages/codec";
import type { WidgetPackageStore } from "../../../plugins/surface-runtime/packages/store";
import type { DockConfigStore } from "../../store/config-store";
import type { DockWidgetApplications } from "../../store/custom/applications";
import {
  customWidgetItemSchema,
  type LocalWidgetScope,
  type CustomWidgetItem,
} from "../../store/custom/model";
import { installLedgerSchema, type InstallOperation } from "./model";

type Subject = z.infer<typeof widgetUninstallSchema>;
type Review = {
  contractDigest:string;
  scope: LocalWidgetScope;
  value: WidgetInstallReview;
  targets: InstallOperation["targets"];
  expiresAt: number;
};
type Ports = {
  userData: string;
  config: DockConfigStore;
  packages: WidgetPackageStore;
  applications: DockWidgetApplications;
  scope(): LocalWidgetScope;
  cloud(): WidgetCloudPort | null;
  validate(dock: DockContribution, widget: CustomDockWidget): Promise<void>;
  changed(): void;
  revoked?(subject:Subject):boolean;
};
const key = (value: unknown) => canonicalJson(value);
export class WidgetInstallations {
  private readonly file: DurableJson<z.infer<typeof installLedgerSchema>>;
  private readonly uninstallOwner:WidgetLocalUninstall;
  private readonly reviews = new Map<string, Review>();
  private readonly uninstalling = new Set<string>();
  private active: {
    operationId: string;
    controller: AbortController;
    promise: Promise<WidgetInstallResult>;
  } | null = null;
  private currentProgress: WidgetInstallProgress | null = null;
  private tail: Promise<unknown> = Promise.resolve();
  private closed = true;
  constructor(private readonly ports: Ports) {
    this.file = new DurableJson(
      join(ports.userData, "dock-widget-installations.json"),
      installLedgerSchema,
      () => ({ version: 1, confirmations: [], operations: [],uninstalls:[] }),
    );
    this.uninstallOwner=new WidgetLocalUninstall({file:this.file,config:ports.config,applications:ports.applications,scope:()=>this.scope(),changed:ports.changed,
      cancel:async subject=>{const active=this.active,record=active&&this.file.read(state=>state.operations.find(value=>value.operationId===active.operationId));if(record&&key(record.subject)===key(subject)&&key(record.scope)===key(this.scope())){active!.controller.abort(new Error('WIDGET_UNINSTALL_PENDING'));await active!.promise;}},
      fenced:async subject=>{if(subject.sourceInstallationId===this.scope().installationId)await ports.applications.retirePendingDefinition(subject.definitionId);},
    });
  }
  async initialize() {
    await this.file.initialize();
    this.closed = false;
    const scope=this.scope();for(const reference of new Set(this.file.read(state=>state.confirmations.filter(value=>key(value.scope)===key(scope)).map(value=>value.reference)))){try{await this.ports.packages.readFrozen(reference);}catch{/* A damaged cache needs explicit repair; it never restores a confirmation. */}this.assertScope(scope);}
  }
  async reviewDefinition(subject:Subject,reference:string):Promise<WidgetInstallReview>{
    const scope=this.scope();this.assertAvailable(subject);const checked=await this.cloud().review({subject,reference});this.assertScope(scope);
    if(checked.delivery.accountId!==scope.accountId||key(checked.delivery.subject)!==key(subject)||checked.delivery.reference!==reference||checked.manifest.id!==subject.definitionId)throw new Error('WIDGET_PACKAGE_SOURCE_CHANGED');
    const value:WidgetInstallReview={reviewId:randomUUID().replaceAll('-',''),name:checked.manifest.name,reference,generationId:checked.descriptor.source.generationId,...subject,dock:checked.manifest.dock,cached:Boolean(this.ports.packages.descriptor(reference)),instances:[]};
    for(const [id,review]of this.reviews)if(review.expiresAt<=Date.now())this.reviews.delete(id);while(this.reviews.size>=16)this.reviews.delete(this.reviews.keys().next().value!);
    this.reviews.set(value.reviewId,{scope,value,contractDigest:checked.descriptor.contractDigest,targets:[],expiresAt:Date.now()+600000});return structuredClone(value);
  }
  async review(itemId: string): Promise<WidgetInstallReview> {
    const scope = this.scope(),
      item = this.item(itemId),
      definition = item.widget.definition,
      subject = this.subject(item.widget);
    this.assertAvailable(subject);
    const targets = this.items(subject, definition.packageRef).map((item) => ({
      item,
      expectedRevision:
        this.ports.applications.accepted(item)?.revision ?? null,
    }));
    const checked = await this.cloud().review({
      subject,
      reference: definition.packageRef,
    });
    this.assertScope(scope);
    this.validateReview(checked, item.widget);
    if (
      targets.some(
        (target) =>
          key(
            this.ports.config
              .layout()
              .items.find((value) => value.id === target.item.id) ?? null,
          ) !== key(target.item) ||
          (this.ports.applications.accepted(target.item)?.revision ?? null) !==
            target.expectedRevision,
      )
    )
      throw new Error("DOCK_INSTANCE_CONFLICT");
    for (const [id, value] of this.reviews)
      if (value.expiresAt <= Date.now()) this.reviews.delete(id);
    while (this.reviews.size >= 16)
      this.reviews.delete(this.reviews.keys().next().value!);
    const value: WidgetInstallReview = {
      reviewId: randomUUID().replaceAll("-", ""),
      name: checked.manifest.name,
      reference: definition.packageRef,
      generationId: definition.generationId,
      sourceInstallationId: subject.sourceInstallationId,
      definitionId: subject.definitionId,
      dock: checked.manifest.dock,
      cached: this.ports.packages.available(definition.packageRef),
      repair:this.requiresRepair(item.widget),
      instances: targets.map(({ item }) => ({
        id: item.id,
        name: item.label,
        updating: Boolean(this.ports.applications.accepted(item)),
      })),
    };
    this.reviews.set(value.reviewId, {
      contractDigest:checked.descriptor.contractDigest,
      scope,
      value,
      targets,
      expiresAt: Date.now() + 600000,
    });
    return structuredClone(value);
  }
  async confirm(
    raw: z.infer<typeof widgetInstallConfirmSchema>,
  ): Promise<WidgetInstallResult> {
    const input = widgetInstallConfirmSchema.parse(raw),
      operation = await this.serial(async () => {
        const scope = this.scope(),
          existing = this.file
            .snapshot()
            .operations.find(
              (value) => value.operationId === input.operationId,
            );
        if (existing) {
          if (
            key(existing.scope) !== key(scope) ||
            existing.reviewId !== input.reviewId
          )
            throw new Error("DOCK_OPERATION_CONFLICT");
          return existing;
        }
        if (this.active) throw new Error("WIDGET_INSTALL_CAPACITY");
        const review = this.reviews.get(input.reviewId);
        if (
          !review ||
          review.expiresAt <= Date.now() ||
          key(review.scope) !== key(scope)
        )
          throw new Error("DOCK_PREVIEW_EXPIRED");
        const subject = {
          definitionId: review.value.definitionId,
          sourceInstallationId: review.value.sourceInstallationId,
        };
        this.assertAvailable(subject);
        const value: InstallOperation = {
          scope,
          operationId: input.operationId,
          reviewId: input.reviewId,
          subject,
          reference: review.value.reference,
          generationId: review.value.generationId,
          contractDigest:review.contractDigest,
          targets: review.targets,
          phase: "confirmed",
          itemIds: [],
          needsSetup: [],
        };
        await this.file.mutate((state) => {
          if (
            state.operations.length >= 256 ||
            state.operations.filter(
              (value) =>
                value.phase === "confirmed" || value.phase === "committing",
            ).length >= 8
          )
            throw new Error("WIDGET_INSTALL_CAPACITY");
          state.operations.push(value);
        });
        this.changed();
        return value;
      });
    return this.start(operation);
  }
  requiresRepair(widget:Pick<CustomDockWidget,'definition'>){
    if(this.closed)return false;const scope=this.scope(),definition=widget.definition,subject={definitionId:definition.definitionId,sourceInstallationId:definition.sourceInstallationId};return!this.blocked(subject)&&!this.ports.packages.available(definition.packageRef)&&this.file.read(state=>state.confirmations.some(value=>key(value.scope)===key(scope)&&key(value.subject)===key(subject)&&value.reference===definition.packageRef));
  }
  confirmed(widget: CustomDockWidget) {
    if (this.closed) return false;
    if(this.blocked(widget)||!this.ports.packages.available(widget.definition.packageRef))return false;
    const scope = this.ports.scope(),
      definition = widget.definition;
    return this.file
      .snapshot()
      .confirmations.some(
        (value) =>
          key(value.scope) === key(scope) &&
          key(value.subject) === key(this.subject(widget)) &&
          value.reference === definition.packageRef &&
          value.generationId === definition.generationId &&
          value.contractDigest === definition.contractDigest,
      );
  }
  operation(operationId: string): WidgetInstallResult | null {
    const scope = this.scope(),
      operation = this.file
        .snapshot()
        .operations.find(
          (value) =>
            value.operationId === operationId &&
            key(value.scope) === key(scope),
        );
    return operation ? this.result(operation) : null;
  }
  installedDefinitions(){const scope=this.scope();return installedWidgetDefinitions(this.file.read(state=>state.confirmations),scope,this.ports.config.layout().items.filter((item):item is CustomWidgetItem=>item.kind==='widget'&&item.widget.type==='custom').map(item=>customWidgetItemSchema.parse(item))).map(value=>{const source=this.ports.packages.origin(value.reference);return{...value,...(source?{sourceChatId:source.chatId}:{})};});}
  savedDefinition(subject:Subject){const scope=this.scope();this.assertAvailable(subject);return savedInstalledWidget(this.file.read(state=>state.confirmations),scope,subject,this.ports.packages,()=>this.assertScope(scope));}
  progress() {
    return this.currentProgress ? structuredClone(this.currentProgress) : null;
  }
  async retry(operationId: string) {
    const scope = this.scope(),
      operation = this.file
        .snapshot()
        .operations.find(
          (value) =>
            value.operationId === operationId &&
            key(value.scope) === key(scope),
        );
    if (!operation) throw new Error("WIDGET_INSTALL_NOT_FOUND");
    if (operation.phase === "cancelled" || operation.phase === "conflict")
      return this.result(operation);
    if (operation.phase === "failed") {
      await this.update(operationId, (value) => {
        value.phase = "confirmed";
      });
      return this.start({ ...operation, phase: "confirmed" });
    }
    return this.start(operation);
  }
  async recover() {
    await this.uninstallOwner.recover();
    if (this.active || !this.ports.cloud()?.available()) return;
    const scope = this.scope(),
      pending = this.file
        .snapshot()
        .operations.find(
          (value) =>
            key(value.scope) === key(scope) &&
            (value.phase === "confirmed" || value.phase === "committing")&&!this.blocked(value.subject),
        );
    if (pending) await this.start(pending);
  }
  async cancel(operationId: string) {
    const operation = await this.serial(async () => {
      const scope = this.scope(),
        value = this.file
          .snapshot()
          .operations.find(
            (value) =>
              value.operationId === operationId &&
              key(value.scope) === key(scope),
          );
      if (!value) throw new Error("WIDGET_INSTALL_NOT_FOUND");
      if (value.phase === "confirmed" || value.phase === "failed")
        return this.update(operationId, (value) => {
          value.phase = "cancelled";
        });
      return value;
    });
    if (
      operation.phase === "cancelled" &&
      this.active?.operationId === operationId
    )
      this.active.controller.abort(new Error("WIDGET_INSTALL_CANCELLED"));
    if (
      operation.phase === "committing" &&
      this.active?.operationId === operationId
    )
      return this.active.promise;
    return this.result(operation);
  }
  uninstallReview(subject:Subject){return this.uninstallOwner.review(widgetUninstallSchema.parse(subject));}
  confirmUninstall(input:{operationId:string;reviewId:string}){return this.uninstallOwner.confirm(input);}
  uninstallOperation(id:string){return this.uninstallOwner.operation(id);}
  retryUninstall(id:string){return this.uninstallOwner.retry(id);}
  blocked(value:CustomDockWidget|Subject){const subject='definition'in value?this.subject(value):value;return this.closed||Boolean(this.ports.revoked?.(subject))||this.uninstallOwner.blocked(subject);}
  wasUninstalled(widget:CustomDockWidget){return this.uninstallOwner.wasUninstalled(this.subject(widget));}
  async retireDefinition(subject:Subject,operationId:string){
    const known=this.uninstallOwner.operation(operationId);if(known){const result=await this.uninstallOwner.retry(operationId);if(result.state!=='removed')throw new Error('WIDGET_UNINSTALL_PENDING');return;}
    const scope=this.scope(),present=this.file.read(state=>state.confirmations.some(value=>key(value.scope)===key(scope)&&key(value.subject)===key(subject)))||this.ports.config.layout().items.some(item=>item.kind==='widget'&&item.widget.type==='custom'&&key(this.subject(item.widget))===key(subject));
    if(!present)return;const review=this.uninstallOwner.review(subject),result=review.pendingOperationId?await this.uninstallOwner.retry(review.pendingOperationId):await this.uninstallOwner.confirm({operationId,reviewId:review.reviewId});if(result.state!=='removed')throw new Error('WIDGET_UNINSTALL_PENDING');
  }
  async uninstall(subject:Subject){const review=this.uninstallReview(subject);return this.confirmUninstall({operationId:randomUUID(),reviewId:review.reviewId});}
  private start(operation: InstallOperation): Promise<WidgetInstallResult> {
    if (["installed", "cancelled", "conflict"].includes(operation.phase))
      return Promise.resolve(this.result(operation));
    if (this.active) {
      if (this.active.operationId !== operation.operationId)
        return Promise.reject(new Error("WIDGET_INSTALL_CAPACITY"));
      return this.active.promise;
    }
    const controller = new AbortController(),
      active = {
        operationId: operation.operationId,
        controller,
        promise: Promise.resolve(null as never) as Promise<WidgetInstallResult>,
      };
    const task = Promise.resolve()
      .then(() => this.run(operation, controller.signal))
      .finally(() => {
        if (this.active === active) {
          this.active = null;
          this.currentProgress = null;
          this.changed();
        }
      });
    active.promise = task;
    this.active = active;
    return task;
  }
  private async run(
    original: InstallOperation,
    signal: AbortSignal,
  ): Promise<WidgetInstallResult> {
    const current = () => {
      this.assertScope(original.scope);
      if(this.blocked(original.subject))throw new Error("WIDGET_UNINSTALL_PENDING");
      signal.throwIfAborted();
      const value = this.record(original.operationId);
      if (value.phase === "cancelled")
        throw new Error("WIDGET_INSTALL_CANCELLED");
    };
    const progress = (
      phase: WidgetInstallProgress["phase"],
      completedBytes: number | null = null,
      totalBytes: number | null = null,
    ) => {
      current();
      this.currentProgress = {
        operationId: original.operationId,
        reference: original.reference,
        phase,
        completedBytes,
        totalBytes,
      };
      this.changed();
    };
    try {
      current();
      this.assertAvailable(original.subject);
      if (original.targets.length&&!this.validTargets(original).length)
        throw new Error("DOCK_INSTANCE_CONFLICT");
      progress("downloading");
      const cloud = this.cloud(),
        checked = await cloud.review(
          { subject: original.subject, reference: original.reference },
          signal,
        );
      current();
      this.validateReview(checked,{definition:{...original.subject,generationId:original.generationId,packageRef:original.reference,contractDigest:original.contractDigest}});
      let frozen: FrozenWidgetPacket | null = await this.ports.packages
        .readFrozen(original.reference)
        .catch((error: unknown) => {
          if (
            error instanceof Error &&
            (error.message === "WIDGET_PACKAGE_NOT_AVAILABLE"||!this.ports.packages.available(original.reference))
          )
            return null;
          throw error;
        });
      current();
      if (!frozen) {
        const bytes = await cloud.download(checked.delivery, signal, (value) =>
          progress("downloading", value.bytes, value.total),
        );
        current();
        progress("verifying");
        const started = performance.now(),
          packet = verifyPackage(bytes, original.reference, {
            accountId: original.scope.accountId,
            installationId: original.subject.sourceInstallationId,
            definitionId: original.subject.definitionId,
            generationId: original.generationId,
          });
        if (
          performance.now() - started >= BUDGET.verifyMs ||
          key(packet.descriptor) !== key(checked.descriptor)
        )
          throw new Error("WIDGET_PACKAGE_SOURCE_CHANGED");
        frozen = {
          reference: original.reference,
          descriptor: packet.descriptor,
          bytes,
          ...(checked.sourceChat?{sourceChat:checked.sourceChat}:{}),
        };
        await this.ports.packages.install(frozen, original.operationId);
        current();
      }
      if (key(frozen.descriptor) !== key(checked.descriptor))
        throw new Error("WIDGET_PACKAGE_SOURCE_CHANGED");
      progress("registering");
      return await this.ports.applications.localMutation(async (owner) => {
        current();
        const targets = this.validTargets(original);
        if (original.targets.length&&!targets.length) throw new Error("DOCK_INSTANCE_CONFLICT");
        await this.serial(async () => {
          current();
          await this.update(original.operationId, (value) => {
            value.phase = "committing";
          });
        });
        const started = performance.now();
        await this.file.mutate((state) => {
          current();
          const existing = state.confirmations.find(
            (value) =>
              key(value.scope) === key(original.scope) &&
              value.reference === original.reference &&
              key(value.subject) === key(original.subject),
          );
          if (!existing) {
            if (state.confirmations.length >= 32)
              throw new Error("WIDGET_INSTALL_CAPACITY");
            state.confirmations.push({
              scope: original.scope,
              subject: original.subject,
              reference: original.reference,
              generationId: original.generationId,
              contractDigest: original.contractDigest,
              operationId: original.operationId,
              name:checked.manifest.name,
              confirmedAt: Date.now(),
            });
          }
        });
        const itemIds: string[] = [],
          needsSetup: string[] = [];
        for (const target of targets) {
          current();
          if (performance.now() - started >= BUDGET.registerMs)
            throw new Error("WIDGET_INSTALL_REGISTER_TIMEOUT");
          const previous = this.ports.applications.accepted(target.item);
          if (previous?.lastOperationId === "install:" + original.operationId) {
            itemIds.push(target.item.id);
            continue;
          }
          try {
            await this.ports.validate(
              checked.manifest.dock,
              target.item.widget,
            );
          } catch {
            needsSetup.push(target.item.id);
            continue;
          }
          current();
          if (
            !this.validTargets(original).some(
              (value) => value.item.id === target.item.id,
            )
          )
            continue;
          await owner.put({
            scope: original.scope,
            itemId: target.item.id,
            widget: target.item.widget,
            paused: previous?.paused ?? false,
            revision: (previous?.revision ?? 0) + 1,
            lastOperationId: "install:" + original.operationId,
            baseAccess:previous&&key(previous.widget)===key(target.item.widget)?previous.baseAccess:"unconfirmed",
            baseGrant:previous&&key(previous.widget)===key(target.item.widget)?previous.baseGrant:null,
          });
          itemIds.push(target.item.id);
        }
        current();
        const done = await this.update(original.operationId, (value) => {
          value.phase = "installed";
          value.itemIds = itemIds;
          value.needsSetup = needsSetup;
        });
        this.changed();
        return this.result(done);
      });
    } catch (error) {
      const latest = this.record(original.operationId);
      if (latest.phase === "cancelled") return this.result(latest);
      if (this.closed) return this.result(latest);
      if (latest.phase === "committing") return this.result(latest);
      const conflict =
          error instanceof Error &&
          /CONFLICT|SCOPE_CHANGED/.test(error.message),
        failed = await this.update(original.operationId, (value) => {
          value.phase = conflict ? "conflict" : "failed";
        });
      this.changed();
      return this.result(failed);
    }
  }
  private validTargets(operation: InstallOperation) {
    return operation.targets.filter((target) => {
      const item = this.ports.config
        .layout()
        .items.find((value) => value.id === target.item.id);
      if (key(item ?? null) !== key(target.item)) return false;
      const mapping = this.ports.applications.accepted(target.item);
      return (
        mapping?.lastOperationId === "install:" + operation.operationId ||
        (mapping?.revision ?? null) === target.expectedRevision
      );
    });
  }
  private validateReview(checked: WidgetCloudReview, widget: Pick<CustomDockWidget,'definition'>) {
    const source = validateWidgetPackageDescriptor(checked.descriptor).source,
      definition = widget.definition;
    if (
      source.accountId !== this.scope().accountId ||
      source.installationId !== definition.sourceInstallationId ||
      source.definitionId !== definition.definitionId ||
      source.generationId !== definition.generationId ||
      checked.delivery.accountId !== source.accountId ||
      checked.delivery.reference !== definition.packageRef ||
      checked.descriptor.contractDigest !== definition.contractDigest ||
      checked.manifest.id !== source.definitionId ||
      `sha256:${hashCanonical({ dock: checked.manifest.dock, operations: checked.manifest.operations })}` !==
        definition.contractDigest
    )
      throw new Error("WIDGET_PACKAGE_SOURCE_CHANGED");
  }
  private subject(widget: CustomDockWidget): Subject {
    return {
      definitionId: widget.definition.definitionId,
      sourceInstallationId: widget.definition.sourceInstallationId,
    };
  }
  private items(subject: Subject, reference?: string) {
    return this.ports.config
      .layout()
      .items.filter(
        (item): item is CustomWidgetItem =>
          item.kind === "widget" &&
          item.widget.type === "custom" &&
          key(this.subject(item.widget)) === key(subject) &&
          (!reference || item.widget.definition.packageRef === reference),
      )
      .map((item) => customWidgetItemSchema.parse(item));
  }
  private item(id: string) {
    const item = this.ports.config
      .layout()
      .items.find((value) => value.id === id);
    if (item?.kind !== "widget" || item.widget.type !== "custom")
      throw new Error("DOCK_WIDGET_NOT_FOUND");
    return customWidgetItemSchema.parse(item);
  }
  private record(id: string) {
    const value = this.file
      .snapshot()
      .operations.find((value) => value.operationId === id);
    if (!value) throw new Error("WIDGET_INSTALL_NOT_FOUND");
    return value;
  }
  private update(id: string, change: (value: InstallOperation) => void) {
    return this.file.mutate((state) => {
      const value = state.operations.find((value) => value.operationId === id);
      if (!value) throw new Error("WIDGET_INSTALL_NOT_FOUND");
      change(value);
      return structuredClone(value);
    });
  }
  private result(value: InstallOperation): WidgetInstallResult {
    return {
      operationId: value.operationId,
      reference: value.reference,
      state:
        value.phase === "confirmed" || value.phase === "committing"
          ? "pending"
          : value.phase,
      itemIds: [...value.itemIds],
      needsSetup: [...value.needsSetup],
    };
  }
  private scope() {
    if (this.closed) throw new Error("WIDGET_INSTALL_CLOSED");
    return this.ports.scope();
  }
  private assertScope(scope: LocalWidgetScope) {
    if (key(this.scope()) !== key(scope))
      throw new Error("WIDGET_INSTALL_SCOPE_CHANGED");
  }
  private assertAvailable(subject: Subject) {
    if(this.blocked(subject))throw new Error("WIDGET_UNINSTALL_PENDING");
    if (this.uninstalling.has(key([this.scope(), subject])))
      throw new Error("WIDGET_UNINSTALL_PENDING");
  }
  private cloud() {
    const cloud = this.ports.cloud();
    if (!cloud?.available()) throw new Error("WIDGET_CLOUD_UNAVAILABLE");
    return cloud;
  }
  private serial<T>(run: () => Promise<T>) {
    const next = this.tail.then(run);
    this.tail = next.catch(() => {});
    return next;
  }
  private changed() {
    try {
      this.ports.changed();
    } catch (error) {
      console.warn("[widgets] installation observer failed", error);
    }
  }
  retainedReferences() {
    return this.file.read((state) => [
      ...state.confirmations.map((value) => value.reference),
      ...state.operations.flatMap((value) =>
        value.phase === "confirmed" || value.phase === "committing"
          ? [value.reference]
          : [],
      ),
    ]);
  }
  async clearAccount(accountId: string) {
    this.uninstallOwner.clearReviews(accountId);
    for (const [id, review] of this.reviews)
      if (review.scope.accountId === accountId) this.reviews.delete(id);
    const active = this.active,
      record =
        active &&
        this.file
          .snapshot()
          .operations.find((value) => value.operationId === active.operationId);
    if (record?.scope.accountId === accountId) {
      active!.controller.abort(new Error("WIDGET_INSTALL_ACCOUNT_CLEANUP"));
      await active!.promise;
    }
    await this.serial(async () => {
      await this.file.mutate((state) => {
        state.confirmations = state.confirmations.filter(
          (value) => value.scope.accountId !== accountId,
        );
        state.operations = state.operations.filter(
          (value) => value.scope.accountId !== accountId,
        );state.uninstalls=state.uninstalls.filter(value=>value.scope.accountId!==accountId);
      });
    });
    this.changed();
  }
  async close() {
    if (this.closed) return;
    this.closed = true;
    this.reviews.clear();
    this.active?.controller.abort(new Error("WIDGET_INSTALL_CLOSED"));
    await this.active?.promise;
    await this.tail;await this.uninstallOwner.close();
    await this.file.closeAndFlush();
  }
}
