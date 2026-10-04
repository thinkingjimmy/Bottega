/**
 * [INPUT]: Depends on base-mutation-error's isLeaseRefusal and a host renewal port.
 * [OUTPUT]: Provides createSurfaceLease — one lease handle (current id + retry) every write of an App tab's workbench goes through, the record dialog included.
 * [POS]: ui/state lease policy for row-write surfaces; the workbench and the record dialog share one instance.
 */
import { isLeaseRefusal } from "./base-mutation-error";

export type SurfaceLease = {
  current(): string | undefined;
  /** Runs a write; a lease refusal renews the lease (shared by writes refused together) and retries that write once. */
  retry<T>(operation: () => Promise<T>): Promise<T>;
};

/* A revoked lease is never honoured again, so retrying with it is pointless; the refused attempt wrote nothing, so one
   retry with a renewed lease cannot duplicate. Writes refused at the same time share one renewal, and a retried write
   that is refused again surfaces its refusal: there is no second retry and no loop. */
export function createSurfaceLease(initial: string | undefined, renew?: () => Promise<string>): SurfaceLease & { adopt(id: string | undefined): void } {
  let id = initial;
  let renewal: Promise<string> | null = null;
  return {
    current: () => id,
    adopt(next) { id = next; },
    async retry(operation) {
      const attempted = id;
      try {
        return await operation();
      } catch (cause) {
        if (!renew || !isLeaseRefusal(cause)) throw cause;
        // A write refused with a lease another write already replaced just uses the new one.
        if (id === attempted) {
          renewal ??= renew().finally(() => { renewal = null; });
          id = await renewal;
        }
        return operation();
      }
    },
  };
}
