/**
 * [INPUT]: Depends on the fake host and the probe package.
 * [OUTPUT]: Provides T1_CASES (case id → async function returning { outcome, triggered, evidence }) for what the host protocol can prove without a desktop, and runCases.
 * [POS]: The synthetic T1 cases of @bottega/testing; the private conformance runner classifies their results against its catalog and refuses a pass whose behaviour never fired.
 */
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { issueRef, startFakeHost, type FakeHost, type FakeHostOptions } from "./fake-host";

export type CaseResult = { outcome: boolean; triggered: boolean; evidence: Record<string, unknown> };
/* Located by package self-reference: the build may place this module in a shared chunk. */
const probe = fileURLToPath(import.meta.resolve("@bottega/testing/probe"));
const withHost = async <T>(options: Omit<FakeHostOptions, "entry">, body: (host: FakeHost) => Promise<T>) => {
  const host = await startFakeHost({ entry: probe, ...options });
  try { return await body(host); } finally { await host.stop(); }
};

export const T1_CASES: Record<string, () => Promise<CaseResult>> = {
  /* C03 (host layer): a reply delivered twice, or late, settles the package's call once. */
  async C03() {
    return withHost({ operations: { "conformance.value": (input) => ({ echoed: input }) },
      faults: { duplicateReply: ["conformance.value"], lateReplyMs: { "conformance.value": 150 } } }, async (host) => {
      await host.ready;
      const ref = issueRef("execution");
      const answer = await host.invoke("settleOnce", { operation: "conformance.value", input: { n: 1 }, quietMs: 300 }, [ref]);
      const triggered = host.fired.get("duplicate:conformance.value") === 1 && host.fired.get("late:conformance.value") === 1;
      const result = answer.result as { settled: number; value?: { echoed?: { n?: number } } } | undefined;
      const settled = answer.ok ? result?.settled ?? null : null;
      return { outcome: answer.ok && settled === 1 && result?.value?.echoed?.n === 1, triggered,
        evidence: { settled, duplicateFired: host.fired.get("duplicate:conformance.value") ?? 0, lateFired: host.fired.get("late:conformance.value") ?? 0 } };
    });
  },
  /* C04: the call id and nonce the host recorded are the ones the package's report cites. */
  async C04() {
    const recorded: { receiptId: string; nonce: string; principalRef: string }[] = [];
    return withHost({ operations: { "conformance.tool": (input, refs) => {
      const receipt = { receiptId: `rcpt_${randomUUID()}`, nonce: String(input.nonce), principalRef: refs[0]! };
      recorded.push(receipt); return receipt;
    } } }, async (host) => {
      await host.ready;
      const ref = issueRef("execution"), nonce = randomUUID();
      const answer = await host.invoke("cite", { operation: "conformance.tool", nonce }, [ref]);
      const rpc = host.transcript.filter((entry) => entry.dir === "from-utility" && entry.message.t === "rpc").map((entry) => entry.message.request!);
      const cited = answer.ok ? (answer.result as { receipt: { receiptId: string; nonce: string } }).receipt : null;
      const match = recorded.find((receipt) => receipt.receiptId === cited?.receiptId);
      return { outcome: Boolean(match) && match!.nonce === nonce && cited?.nonce === nonce && rpc.length === 1 && rpc[0]!.refs?.[0] === ref,
        triggered: recorded.length === 1,
        evidence: { rpcIds: rpc.map((request) => request.id), recorded: recorded.length, citedMatchesRecord: Boolean(match), principalRefCarried: rpc[0]?.refs?.[0] === ref } };
    });
  },
  /* C30 (host layer): a utility speaking another grammar is refused at hello, and one launched under another contract refuses before
     importing anything, naming its own frozen contract; nothing either says afterwards is admitted. */
  async C30() {
    const grammar = await withHost({ grammar: 2, helloTimeoutMs: 3_000 }, async (host) => {
      const refused = await host.ready.then(() => false, () => true);
      const hello = host.rejected.find((message) => (message as { t?: string })?.t === "hello") as { grammar?: number } | undefined;
      return { refused, hello, admitted: host.transcript.some((entry) => entry.dir === "from-utility" && entry.valid && entry.message.t === "hello") };
    });
    const contract = await withHost({ contract: "0-draft", helloTimeoutMs: 3_000 }, async (host) => {
      const reason = await host.ready.then(() => null, (cause: Error) => cause.message);
      return { reason, admitted: host.transcript.some((entry) => entry.dir === "from-utility" && entry.valid && entry.message.t === "hello") };
    });
    return { outcome: grammar.refused && Boolean(grammar.hello) && !grammar.admitted && /^fake-host-refused: contract \S+$/.test(contract.reason ?? "") && !contract.admitted,
      triggered: Boolean(grammar.hello) && contract.reason !== null,
      evidence: { refused: grammar.refused, rejectedHelloGrammar: grammar.hello?.grammar ?? null, contractRefusal: contract.reason } };
  },
};

/** Runs the named cases (all by default) one after another; a thrown case is reported, never rethrown. */
export async function runCases(ids: string[] = Object.keys(T1_CASES)) {
  const results: { id: string; result?: CaseResult; error?: string; ms: number }[] = [];
  for (const id of ids) {
    const run = T1_CASES[id];
    if (!run) throw new Error(`unknown case ${id}`);
    const started = Date.now();
    try { results.push({ id, result: await run(), ms: Date.now() - started }); }
    catch (cause) { results.push({ id, error: String((cause as Error)?.stack ?? cause), ms: Date.now() - started }); }
  }
  return results;
}
