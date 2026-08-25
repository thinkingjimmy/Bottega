/**
 * [INPUT]: Depends on Node fs with the injected launchctl/lsof capture, provider label/name, and boundary waiting parameters
 * [OUTPUT]: Provides LaunchdIdentityController with a border readDiagnosticTail
 * [POS]: The boundaries of the identity and log diagnosis of macOS processes in main/memory/runtime/control; Installing the output or port PID of the unparalleled command
 */

import { open } from "node:fs/promises";
import type { RunCommandCaptured } from "../managed/install-steps";

const SERVICE_POLL_MS = 100;
const SERVICE_STOP_TIMEOUT_MS = 15_000;

export class LaunchdIdentityController {
  constructor(private readonly input: {
    displayName: string;
    launchLabel: string;
    uid: number;
    runCaptured: RunCommandCaptured;
    startTimeoutMs: number;
    startPollMs: number;
  }) {}

  async assertOwnedOrAbsent(baseUrl: string) {
    const identity = await this.captureIdentity(baseUrl);
    if (identity.listenerPid === null || identity.jobPid === identity.listenerPid) return;
    throw new Error(
      `${this.input.displayName} 端口 ${servicePort(baseUrl)} 被非自有进程占用，拒绝修改运行时`
    );
  }

  async isOwnedServiceLive(baseUrl: string) {
    const identity = await this.captureIdentity(baseUrl);
    return identity.jobPid !== null && identity.listenerPid === identity.jobPid;
  }

  async assertServiceIdentity(baseUrl: string) {
    const deadline = Date.now() + this.input.startTimeoutMs;
    while (Date.now() < deadline) {
      const identity = await this.captureIdentity(baseUrl);
      if (identity.jobPid !== null && identity.listenerPid === identity.jobPid) return;
      await delay(this.input.startPollMs);
    }
    throw new Error(`${this.input.displayName} 启动后身份校验超时`);
  }

  async bootout(baseUrl: string) {
    const result = await this.capture("launchctl", [
      "bootout",
      `gui/${this.input.uid}/${this.input.launchLabel}`,
    ]);
    if (result.code !== 0 && !launchctlJobMissing(result)) {
      throw new Error(`${this.input.displayName} 停止服务失败`);
    }
    const deadline = Date.now() + SERVICE_STOP_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const identity = await this.captureIdentity(baseUrl);
      if (!identity.jobExists && identity.listenerPid === null) return;
      await delay(SERVICE_POLL_MS);
    }
    throw new Error(`${this.input.displayName} 停止服务超时`);
  }

  private async captureIdentity(baseUrl: string) {
    const job = await this.capture("launchctl", [
      "print",
      `gui/${this.input.uid}/${this.input.launchLabel}`,
    ]);
    const listener = await this.capture("lsof", [
      "-nP",
      `-iTCP:${servicePort(baseUrl)}`,
      "-sTCP:LISTEN",
      "-Fp",
    ]);
    return {
      jobExists: job.code === 0,
      jobPid: job.code === 0 ? parseLaunchdPid(job.stdout) : null,
      listenerPid: listener.code === 0 ? parseLsofPid(listener.stdout) : null,
    };
  }

  private capture(command: string, args: string[]) {
    return this.input.runCaptured(command, args, {
      timeoutMs: 15_000,
      byteLimit: 64 * 1024,
    });
  }
}

const parseLaunchdPid = (output: string) => {
  const match = output.match(/(?:^|\n)\s*pid\s*=\s*(\d+)\b/);
  return match ? Number(match[1]) : null;
};

const parseLsofPid = (output: string) => {
  const match = output.match(/(?:^|\n)p(\d+)\b/);
  return match ? Number(match[1]) : null;
};

const launchctlJobMissing = (result: { stdout: string; stderr: string }) => {
  const detail = `${result.stdout}\n${result.stderr}`.toLowerCase();
  return detail.includes("no such process") ||
    detail.includes("could not find service") ||
    detail.includes("service not found");
};

const servicePort = (baseUrl: string) => {
  const url = new URL(baseUrl);
  return Number(url.port || (url.protocol === "https:" ? "443" : "80"));
};

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function readDiagnosticTail(path: string, byteLimit: number) {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(path, "r");
    const info = await handle.stat();
    const length = Math.min(info.size, byteLimit);
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, Math.max(0, info.size - length));
    return buffer.toString("utf8");
  } catch {
    return "";
  } finally {
    await handle?.close().catch(() => undefined);
  }
}
