/**
 * [INPUT]: Depends on the HostApi a host hands to activate().
 * [OUTPUT]: A package entry whose methods exercise the host protocol: one call whose settlements are counted, and a call that cites the host's receipt.
 * [POS]: Package side of the T1 cases; it holds no logic of its own beyond what a case asks it to observe.
 */
import type { HostApi } from "@bottega/contracts/host/api";

export async function activate(api: HostApi) {
  return {
    /* Settlements of one call are counted after a quiet period, so a second (duplicate or late) reply would show. */
    async settleOnce(params: unknown, refs: string[]) {
      const { operation, input, quietMs } = params as { operation: string; input: unknown; quietMs: number };
      let settled = 0, value: unknown = null;
      await api.call(operation, input, refs).then((result) => { settled++; value = result; }, () => { settled++; });
      await new Promise((resolve) => setTimeout(resolve, quietMs));
      return { settled, value };
    },
    /* The package reports what it did by quoting the host's receipt, never by claiming success itself. */
    async cite(params: unknown, refs: string[]) {
      const { operation, nonce } = params as { operation: string; nonce: string };
      const receipt = await api.call(operation, { nonce }, refs);
      return { nonce, receipt };
    },
  };
}
