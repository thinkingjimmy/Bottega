/**
 * [INPUT]: Depends on the original durable retirement journal, Main-held current impact, existing local cleanup owners and current-account Cloud delivery.
 * [OUTPUT]: Provides WidgetDefinitionLifecycle with terminal account/source fences, original deletion review/results, offline/restart recovery and received revocation cleanup.
 * [POS]: Deferred account definition lifecycle owner; it never deletes source Projects/Chats or grants execution and data access.
 */
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import {
  canonicalJson,
  hashCanonical,
} from "@bottega/contracts/core/canonical-json";
import type { WidgetPackageSubject } from "@ai-chat/cloud-protocol/widgets/model";
import { widgetDefinitionReceiptSchema } from "@ai-chat/cloud-protocol/widgets/model";
import type { WidgetCatalogEntry } from "@ai-chat/cloud-protocol/widgets/catalog";
import type {
  WidgetRetirementReview,
  WidgetRetirementResult,
} from "../../../../../shared/system-dock/widgets/install/lifecycle";
import type { LocalWidgetScope } from "../../store/custom/model";
import type { WidgetCloudPort } from "../../../cloud/widgets/ports";
import { DurableJson } from "../../../persistence/durable-json";
import { widgetDefinitionLedgerSchema, type WidgetRetirement } from "./model";
type Subject = WidgetPackageSubject;
type Ports = {
  userData: string;
  scope(): LocalWidgetScope;
  name(subject: Subject): string;
  impact(subject: Subject): {
    instances: readonly { id: string; name: string }[];
    identity: unknown;
  };
  retireLocal(
    subject: Subject,
    operationId: string,
    scope: LocalWidgetScope,
  ): Promise<void>;
  cloud(): Pick<WidgetCloudPort, "available" | "retire"> | null;
  changed(): void;
};
const key = (value: unknown) => canonicalJson(value);
export class WidgetDefinitionLifecycle {
  private readonly file: DurableJson<
    ReturnType<typeof widgetDefinitionLedgerSchema.parse>
  >;
  private records: readonly WidgetRetirement[] = [];
  private closed = true;
  private readonly reviews = new Map<
    string,
    {
      scope: LocalWidgetScope;
      subject: Subject;
      identity: string;
      value: WidgetRetirementReview;
      expiresAt: number;
    }
  >();
  private tail: Promise<unknown> = Promise.resolve();
  private readonly flights = new Map<string, Promise<WidgetRetirementResult>>();
  private readonly attempted = new Set<string>();
  constructor(private readonly ports: Ports) {
    this.file = new DurableJson(
      join(ports.userData, "dock-widget-definitions.json"),
      widgetDefinitionLedgerSchema,
      () => ({ version: 1, retirements: [] }),
    );
  }
  async initialize() {
    await this.file.initialize();
    this.closed = false;
    this.records = this.file.read((state) => state.retirements);
  }
  blocked(subject: Subject) {
    if (this.closed) return true;
    const account = this.ports.scope().accountId;
    return this.records.some(
      (value) =>
        value.scope.accountId === account &&
        key(value.subject) ===
          key({
            definitionId: subject.definitionId,
            sourceInstallationId: subject.sourceInstallationId,
          }),
    );
  }
  review(subject: Subject): WidgetRetirementReview {
    this.assertOpen();
    if (this.blocked(subject)) throw new Error("WIDGET_DEFINITION_REVOKED");
    const scope = this.ports.scope(),
      impact = this.ports.impact(subject);
    for (const [id, value] of this.reviews)
      if (value.expiresAt <= Date.now()) this.reviews.delete(id);
    while (this.reviews.size >= 16)
      this.reviews.delete(this.reviews.keys().next().value!);
    const value = {
      reviewId: randomUUID().replaceAll("-", ""),
      name: this.ports.name(subject),
      ...subject,
      instances: impact.instances,
    };
    this.reviews.set(value.reviewId, {
      scope,
      subject,
      identity: key(impact.identity),
      value,
      expiresAt: Date.now() + 600000,
    });
    return structuredClone(value);
  }
  async confirm(input: { operationId: string; reviewId: string }) {
    const operation = await this.serial(async () => {
      this.assertOpen();
      const scope = this.ports.scope(),
        existing = this.records.find(
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
      const review = this.reviews.get(input.reviewId);
      if (
        !review ||
        review.expiresAt <= Date.now() ||
        key(review.scope) !== key(scope)
      )
        throw new Error("DOCK_PREVIEW_EXPIRED");
      if (
        this.blocked(review.subject) ||
        key(this.ports.impact(review.subject).identity) !== review.identity
      )
        throw new Error("DOCK_INSTANCE_CONFLICT");
      const operation: WidgetRetirement = {
        scope,
        subject: review.subject,
        operationId: input.operationId,
        reviewId: input.reviewId,
        name: review.value.name,
        phase: "prepared",
        origin: "local",
      };
      await this.add(operation);
      return operation;
    });
    return this.start(operation);
  }
  operation(id: string) {
    this.assertOpen();
    const value = this.records.find(
      (value) =>
        value.operationId === id &&
        key(value.scope) === key(this.ports.scope()),
    );
    return value ? this.result(value) : null;
  }
  retry(id: string) {
    this.assertOpen();
    const value = this.records.find(
      (value) =>
        value.operationId === id &&
        key(value.scope) === key(this.ports.scope()),
    );
    if (!value)
      return Promise.reject(new Error("WIDGET_DEFINITION_OPERATION_NOT_FOUND"));
    this.attempted.delete(id);
    return this.start(value);
  }
  pending() {
    this.assertOpen();
    const scope = this.ports.scope();
    return this.records
      .filter(
        (value) =>
          value.phase !== "published" && key(value.scope) === key(scope),
      )
      .map((value) => ({ ...this.result(value), name: value.name }));
  }
  async receive(entry: WidgetCatalogEntry) {
    this.assertOpen();
    if (
      entry.state !== "revoked" ||
      entry.accountId !== this.ports.scope().accountId
    )
      throw new Error("WIDGET_CATALOG_ACCOUNT_CHANGED");
    const scope = this.ports.scope(),
      known = this.records.find(
        (value) =>
          key(value.scope) === key(scope) &&
          key(value.subject) === key(entry.subject),
      );
    if (known) {
      if (known.phase !== "published") await this.start(known);
      return;
    }
    const operation: WidgetRetirement = {
      scope,
      subject: entry.subject,
      operationId: hashCanonical(["widget-revocation", scope, entry.subject]),
      reviewId: hashCanonical(entry.subject).slice(0, 32),
      name: this.ports.name(entry.subject),
      phase: "prepared",
      origin: "remote",
    };
    await this.serial(async () => {
      if (
        !this.records.some(
          (value) => value.operationId === operation.operationId,
        )
      )
        await this.add(operation);
    });
    await this.start(operation);
  }
  reconnect() {
    this.attempted.clear();
    this.wake();
  }
  wake() {
    if (this.closed) return;
    const scope = this.ports.scope();
    for (const value of this.records)
      if (
        value.phase !== "published" &&
        key(value.scope) === key(scope) &&
        !this.attempted.has(value.operationId)
      )
        void this.start(value);
  }
  private start(operation: WidgetRetirement): Promise<WidgetRetirementResult> {
    if (operation.phase === "published")
      return Promise.resolve(this.result(operation));
    const known = this.flights.get(operation.operationId);
    if (known) return known;
    this.attempted.add(operation.operationId);
    const task = Promise.resolve()
      .then(() => this.finish(operation))
      .finally(() => {
        if (this.flights.get(operation.operationId) === task)
          this.flights.delete(operation.operationId);
      });
    this.flights.set(operation.operationId, task);
    return task;
  }
  private async finish(original: WidgetRetirement) {
    let operation = original;
    const current = () => {
      this.assertOpen();
      if (key(this.ports.scope()) !== key(operation.scope))
        throw new Error("WIDGET_DEFINITION_SCOPE_CHANGED");
    };
    try {
      current();
      if (operation.phase === "prepared") {
        await this.ports.retireLocal(
          operation.subject,
          operation.operationId,
          operation.scope,
        );
        current();
        operation = await this.change(operation.operationId, "local");
      }
      if (operation.origin === "local") {
        const cloud = this.ports.cloud();
        if (!cloud?.available()) return this.result(operation);
        const receipt = widgetDefinitionReceiptSchema.parse(
          await cloud.retire(operation.subject, operation.operationId),
        );
        current();
        if (
          receipt.accountId !== operation.scope.accountId ||
          key(receipt.subject) !== key(operation.subject)
        )
          throw new Error("WIDGET_DEFINITION_SCOPE_CHANGED");
      }
      operation = await this.change(operation.operationId, "published");
      return this.result(operation);
    } catch {
      return this.result(
        this.records.find(
          (value) => value.operationId === operation.operationId,
        ) ?? operation,
      );
    }
  }
  private async add(value: WidgetRetirement) {
    await this.file.mutate((state) => {
      if (state.retirements.length >= 256)
        throw new Error("WIDGET_DEFINITION_CAPACITY");
      state.retirements.push(value);
    });
    this.publish();
  }
  private async change(id: string, phase: WidgetRetirement["phase"]) {
    let result: WidgetRetirement | undefined;
    await this.file.mutate((state) => {
      const value = state.retirements.find((value) => value.operationId === id);
      if (!value) throw new Error("WIDGET_DEFINITION_OPERATION_NOT_FOUND");
      value.phase = phase;
      result = structuredClone(value);
    });
    this.publish();
    return result!;
  }
  private publish() {
    this.records = this.file.read((state) => state.retirements);
    this.ports.changed();
  }
  private result(value: WidgetRetirement): WidgetRetirementResult {
    return {
      operationId: value.operationId,
      ...value.subject,
      state: value.phase === "published" ? "removed" : "pending",
      localComplete: value.phase !== "prepared",
    };
  }
  clearAccount(accountId: string) {
    return this.serial(async () => {
      for (const [id, value] of this.reviews)
        if (value.scope.accountId === accountId) this.reviews.delete(id);
      await this.file.mutate((state) => {
        state.retirements = state.retirements.filter(
          (value) => value.scope.accountId !== accountId,
        );
      });
      this.publish();
    });
  }
  private assertOpen() {
    if (this.closed) throw new Error("WIDGET_DEFINITIONS_CLOSED");
  }
  private serial<T>(run: () => Promise<T>) {
    const next = this.tail.then(run);
    this.tail = next.catch(() => {});
    return next;
  }
  async close() {
    this.closed = true;
    this.reviews.clear();
    await Promise.allSettled([...this.flights.values()]);
    await this.tail;
    await this.file.closeAndFlush();
  }
}
