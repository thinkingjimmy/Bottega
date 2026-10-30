/**
 * [INPUT]: Depends on the original installation ledger, host-held current-scope impact snapshots, existing mapping writer and cancellation of matching install jobs.
 * [OUTPUT]: Provides WidgetLocalUninstall with exact review/confirmation, immediate pending authority fence, local restart recovery and original-result replay that protects later installations.
 * [POS]: Local installation retirement within the original journal; desired layout and source Project/Chat stay with their existing owners.
 */
import { randomUUID } from "node:crypto";
import type { z } from "zod";
import { canonicalJson } from "@bottega/contracts/core/canonical-json";
import type {
  WidgetUninstallReview,
  WidgetUninstallResult,
} from "../../../../../shared/system-dock/widgets/install/lifecycle";
import type {
  LocalWidgetScope,
  CustomWidgetItem,
} from "../../store/custom/model";
import { customWidgetItemSchema } from "../../store/custom/model";
import type { DockWidgetApplications } from "../../store/custom/applications";
import type { DockConfigStore } from "../../store/config-store";
import type { DurableJson } from "../../../persistence/durable-json";
import type { installLedgerSchema, UninstallOperation } from "./model";
type Subject = { definitionId: string; sourceInstallationId: string };
type Snapshot = {
  confirmations: UninstallOperation["confirmations"];
  targets: UninstallOperation["targets"];
};
type Ports = {
  file: DurableJson<z.infer<typeof installLedgerSchema>>;
  config: DockConfigStore;
  applications: DockWidgetApplications;
  scope(): LocalWidgetScope;
  cancel(subject: Subject): Promise<void>;
  fenced(subject: Subject): void | Promise<void>;
  changed(): void;
};
const key = (value: unknown) => canonicalJson(value);
export class WidgetLocalUninstall {
  private closed = false;
  private readonly reviews = new Map<
    string,
    {
      scope: LocalWidgetScope;
      subject: Subject;
      snapshot: Snapshot;
      value: WidgetUninstallReview;
      expiresAt: number;
    }
  >();
  private tail: Promise<unknown> = Promise.resolve();
  private flight: {
    id: string;
    promise: Promise<WidgetUninstallResult>;
  } | null = null;
  constructor(private readonly ports: Ports) {}
  review(subject: Subject): WidgetUninstallReview {
    const scope = this.ports.scope();
    if (this.closed) throw new Error("WIDGET_UNINSTALL_CLOSED");
    const pending = this.ports.file.read((state) =>
      state.uninstalls.find(
        (value) =>
          value.phase === "prepared" &&
          key(value.scope) === key(scope) &&
          key(value.subject) === key(subject),
      ),
    );
    if (pending)
      return {
        reviewId: pending.reviewId,
        name: pending.targets[0]?.item.label ?? subject.definitionId,
        definitionId: subject.definitionId,
        sourceInstallationId: subject.sourceInstallationId,
        packages: pending.confirmations.length,
        instances: pending.targets.map((value) => ({
          id: value.item.id,
          name: value.item.label,
        })),
        pendingOperationId: pending.operationId,
      };
    const snapshot = this.snapshot(scope, subject),
      confirmed = this.ports.file.read((state) =>
        state.confirmations.find(
          (value) =>
            key(value.scope) === key(scope) &&
            key(value.subject) === key(subject),
        ),
      );
    if (!snapshot.targets.length && !confirmed)
      throw new Error("WIDGET_INSTALL_NOT_FOUND");
    for (const [id, value] of this.reviews)
      if (value.expiresAt <= Date.now()) this.reviews.delete(id);
    while (this.reviews.size >= 16)
      this.reviews.delete(this.reviews.keys().next().value!);
    const value: WidgetUninstallReview = {
      reviewId: randomUUID().replaceAll("-", ""),
      name: confirmed?.name ?? snapshot.targets[0]!.item.label,
      definitionId: subject.definitionId,
      sourceInstallationId: subject.sourceInstallationId,
      packages: snapshot.confirmations.length,
      instances: snapshot.targets.map((value) => ({
        id: value.item.id,
        name: value.item.label,
      })),
    };
    this.reviews.set(value.reviewId, {
      scope,
      subject,
      snapshot,
      value,
      expiresAt: Date.now() + 600000,
    });
    return structuredClone(value);
  }
  async confirm(input: { operationId: string; reviewId: string }) {
    const operation = await this.serial(async () => {
      const scope = this.ports.scope(),
        existing = this.ports.file.read((state) =>
          state.uninstalls.find(
            (value) => value.operationId === input.operationId,
          ),
        );
      if (existing) {
        if (
          key(existing.scope) !== key(scope) ||
          existing.reviewId !== input.reviewId
        )
          throw new Error("DOCK_OPERATION_CONFLICT");
        return existing;
      }
      const review = this.reviews.get(input.reviewId);
      if (
        !review ||
        review.expiresAt <= Date.now() ||
        key(review.scope) !== key(scope)
      )
        throw new Error("DOCK_PREVIEW_EXPIRED");
      if (key(this.snapshot(scope, review.subject)) !== key(review.snapshot))
        throw new Error("DOCK_INSTANCE_CONFLICT");
      const operation: UninstallOperation = {
        scope,
        subject: review.subject,
        operationId: input.operationId,
        reviewId: input.reviewId,
        phase: "prepared",
        ...review.snapshot,
      };
      await this.ports.file.mutate((state) => {
        if (
          state.uninstalls.length >= 256 ||
          state.uninstalls.filter((value) => value.phase === "prepared")
            .length >= 8
        )
          throw new Error("WIDGET_UNINSTALL_CAPACITY");
        state.uninstalls.push(operation);
      });
      await this.ports.fenced(review.subject);
      this.ports.changed();
      return operation;
    });
    return this.start(operation);
  }
  operation(id: string) {
    const scope = this.ports.scope(),
      value = this.ports.file.read((state) =>
        state.uninstalls.find(
          (value) =>
            value.operationId === id && key(value.scope) === key(scope),
        ),
      );
    return value ? this.result(value) : null;
  }
  retry(id: string) {
    const scope = this.ports.scope(),
      value = this.ports.file.read((state) =>
        state.uninstalls.find(
          (value) =>
            value.operationId === id && key(value.scope) === key(scope),
        ),
      );
    if (!value) return Promise.reject(new Error("WIDGET_UNINSTALL_NOT_FOUND"));
    return this.start(value);
  }
  blocked(subject: Subject) {
    if (this.closed) return true;
    const scope = this.ports.scope();
    return this.ports.file.read((state) =>
      state.uninstalls.some(
        (value) =>
          value.phase === "prepared" &&
          key(value.scope) === key(scope) &&
          key(value.subject) === key(subject),
      ),
    );
  }
  wasUninstalled(subject: Subject) {
    const scope = this.ports.scope();
    return this.ports.file.read((state) =>
      state.uninstalls.some(
        (value) =>
          value.phase === "completed" &&
          key(value.scope) === key(scope) &&
          key(value.subject) === key(subject),
      ),
    );
  }
  async recover() {
    if (this.closed || this.flight) return;
    const scope = this.ports.scope();
    for (const value of this.ports.file.read((state) =>
      state.uninstalls.filter(
        (value) =>
          value.phase === "prepared" && key(value.scope) === key(scope),
      ),
    )) {
      await this.start(value);
      if (this.closed) return;
    }
  }
  clearReviews(accountId: string) {
    for (const [id, value] of this.reviews)
      if (value.scope.accountId === accountId) this.reviews.delete(id);
  }
  private start(operation: UninstallOperation): Promise<WidgetUninstallResult> {
    if (operation.phase === "completed")
      return Promise.resolve(this.result(operation));
    if (this.closed)
      return Promise.reject(new Error("WIDGET_UNINSTALL_CLOSED"));
    if (this.flight)
      return this.flight.id === operation.operationId
        ? this.flight.promise
        : Promise.reject(new Error("WIDGET_UNINSTALL_CAPACITY"));
    const flight = {
      id: operation.operationId,
      promise: Promise.resolve(null as never) as Promise<WidgetUninstallResult>,
    };
    const task = Promise.resolve()
      .then(() => this.finish(operation))
      .finally(() => {
        if (this.flight === flight) this.flight = null;
      });
    flight.promise = task;
    this.flight = flight;
    return task;
  }
  private async finish(
    operation: UninstallOperation,
  ): Promise<WidgetUninstallResult> {
    const current = () => {
      if (this.closed || key(this.ports.scope()) !== key(operation.scope))
        throw new Error("WIDGET_UNINSTALL_SCOPE_CHANGED");
    };
    try {
      current();
      await this.ports.fenced(operation.subject);
      current();
      await this.ports.cancel(operation.subject);
      current();
      await this.ports.applications.localMutation(async (owner) => {
        current();
        await this.ports.file.mutate((state) => {
          const original = new Set(
            operation.confirmations.map((value) => key(value)),
          );
          state.confirmations = state.confirmations.filter(
            (value) =>
              key(value.scope) !== key(operation.scope) ||
              key(value.subject) !== key(operation.subject) ||
              !original.has(
                key({
                  reference: value.reference,
                  operationId: value.operationId,
                }),
              ),
          );
          for (const value of state.operations)
            if (
              key(value.scope) === key(operation.scope) &&
              key(value.subject) === key(operation.subject) &&
              (value.phase === "confirmed" ||
                value.phase === "committing" ||
                value.phase === "failed")
            )
              value.phase = "cancelled";
        });
        for (const target of operation.targets) {
          current();
          const item = this.ports.config
            .layout()
            .items.find((value) => value.id === target.item.id);
          if (
            item?.kind !== "widget" ||
            item.widget.type !== "custom" ||
            item.widget.definition.definitionId !==
              operation.subject.definitionId ||
            item.widget.definition.sourceInstallationId !==
              operation.subject.sourceInstallationId
          )
            continue;
          await owner.remove({ scope: operation.scope, itemId: item.id, keepApiCredentials: true });
        }
        current();
        await this.ports.file.mutate((state) => {
          const value = state.uninstalls.find(
            (value) => value.operationId === operation.operationId,
          );
          if (!value) throw new Error("WIDGET_UNINSTALL_NOT_FOUND");
          value.phase = "completed";
        });
        this.ports.changed();
      });
      return { ...this.result(operation), state: "removed" };
    } catch {
      return this.result(operation);
    }
  }
  private snapshot(scope: LocalWidgetScope, subject: Subject): Snapshot {
    const confirmations = this.ports.file
      .read((state) =>
        state.confirmations
          .filter(
            (value) =>
              key(value.scope) === key(scope) &&
              key(value.subject) === key(subject),
          )
          .map((value) => ({
            reference: value.reference,
            operationId: value.operationId,
          })),
      )
      .sort((a, b) => a.reference.localeCompare(b.reference));
    const targets = this.ports.config
      .layout()
      .items.filter(
        (value): value is CustomWidgetItem =>
          value.kind === "widget" &&
          value.widget.type === "custom" &&
          value.widget.definition.definitionId === subject.definitionId &&
          value.widget.definition.sourceInstallationId ===
            subject.sourceInstallationId,
      )
      .map((value) => {
        const item = customWidgetItemSchema.parse(value);
        return {
          item,
          mappingRevision:
            this.ports.applications.accepted(item)?.revision ?? null,
        };
      });
    return { confirmations, targets };
  }
  private result(value: UninstallOperation): WidgetUninstallResult {
    return {
      operationId: value.operationId,
      definitionId: value.subject.definitionId,
      sourceInstallationId: value.subject.sourceInstallationId,
      state: value.phase === "completed" ? "removed" : "pending",
    };
  }
  private serial<T>(run: () => Promise<T>) {
    const task = this.tail.then(run);
    this.tail = task.catch(() => {});
    return task;
  }
  async close() {
    this.closed = true;
    this.reviews.clear();
    await this.flight?.promise;
    await this.tail;
  }
}
