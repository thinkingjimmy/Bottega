/**
 * [INPUT]: Depends on the App build tracker's statuses, the account transport (apps/build:get and publish), the content cipher and the
 *          encrypted business header, and whether an App is in the cloud.
 * [OUTPUT]: Provides AppBuildStatusPublisher.publish(appId): seals and publishes the App's current build status when it changed, one write
 *           at a time per App, after the server's revision (read once) and past a conflicting one.
 * [POS]: Owner-desktop producer of U06-d's build-status projection, beside the GUI surface publisher; the tracker decides what the status
 *        is, this only carries it. An App outside the cloud has nothing to publish.
 */
import { canonicalJson } from "@ai-chat/cloud-protocol";
import { sealAppBuildStatus } from "@ai-chat/cloud-protocol/apps/build-status/encrypted";
import type { AppBuildStatus } from "@ai-chat/cloud-protocol/apps/build-status/model";
import type { FileCipherPort } from "@ai-chat/cloud-protocol/blobs/encrypted";
import type { EncryptedBusinessHeader } from "@ai-chat/cloud-protocol/spaces";
import type { AccountTransport } from "../../runtime/transport/transport";

type Input = Readonly<{
  source: { status(appId: string): AppBuildStatus | null };
  transport: Pick<AccountTransport, "query" | "mutate">;
  crypto(): FileCipherPort;
  header(): EncryptedBusinessHeader;
  deviceId: string;
  cloudManaged(appId: string): boolean;
}>;
export type BuildStatusPublication = "published" | "current" | "skipped";
/** The status without its clock: a status whose time alone moved is not a change. */
const body = (status: AppBuildStatus) => canonicalJson({ ...status, updatedAt: 0 });

export class AppBuildStatusPublisher {
  private readonly sent = new Map<string, { revision: number; body: string | null }>();
  private readonly chains = new Map<string, Promise<unknown>>();
  constructor(private readonly input: Input) {}

  publish(appId: string): Promise<BuildStatusPublication> {
    const run = (this.chains.get(appId) ?? Promise.resolve()).catch(() => {}).then(() => this.write(appId));
    this.chains.set(appId, run);
    void run.finally(() => { if (this.chains.get(appId) === run) this.chains.delete(appId); }).catch(() => {});
    return run;
  }

  private async write(appId: string): Promise<BuildStatusPublication> {
    const status = this.input.source.status(appId);
    if (!status || !this.input.cloudManaged(appId)) return "skipped";
    const next = body(status), known = this.sent.get(appId);
    if (known?.body === next) return "current";
    let revision = known?.revision ?? await this.serverRevision(appId);
    for (let attempt = 0; attempt < 2; attempt++) {
      const record = await sealAppBuildStatus({ ownerDeviceId: this.input.deviceId, revision: revision + 1, operationId: crypto.randomUUID(), status }, this.input.crypto());
      const receipt = await this.input.transport.mutate("apps/build:publish", { ...this.input.header(), record });
      if (receipt.status === "applied") { this.sent.set(appId, { revision: revision + 1, body: next }); return "published"; }
      // Another write of this desktop (an earlier run) got there first: continue after it.
      revision = receipt.current?.revision ?? revision + 1;
    }
    this.sent.set(appId, { revision, body: null });
    throw new Error("app-build-status-conflicted");
  }
  private async serverRevision(appId: string) {
    const stored = await this.input.transport.query("apps/build:get", { ...this.input.header(), appId });
    return stored?.revision ?? 0;
  }
}
