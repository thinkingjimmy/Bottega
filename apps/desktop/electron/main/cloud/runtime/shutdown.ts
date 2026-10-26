/**
 * [INPUT]: Cloud offline reporting, connection cancellation and local observer-drain ports.
 * [OUTPUT]: Provides closeCloudConnection with a best-effort two-second offline report, immediate disconnect and subsequent local observer drainage.
 * [POS]: Cloud runtime terminal shutdown boundary; the application saves drafts and stops tasks before entering it.
 */

type CloudShutdownPorts = {
  reportOffline(): Promise<unknown>;
  disconnect(): void;
  drain(): Promise<void>;
};

export async function closeCloudConnection(ports: CloudShutdownPorts): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.resolve().then(() => ports.reportOffline()).catch(() => undefined),
      new Promise<void>(resolve => { timer = setTimeout(resolve, 2_000); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
  // Consumers can finish their local writes only after stalled network calls settle.
  ports.disconnect();
  await ports.drain();
}
