/**
 * [INPUT]: Main-owned persistent member registry, canonical public Provider identity types and exact source Chat/session facts.
 * [OUTPUT]: NativeMemberFork, sealed source identity and a main-only fork resolver registration.
 * [POS]: Generic session optimization authority; renderer payloads and ordinary Chat options cannot issue it.
 */
import type { BUILTIN_PROVIDER_IDS } from "@bottega/contracts/model/provider-capabilities";

export type NativeMemberForkSource = Readonly<{
  backend: typeof BUILTIN_PROVIDER_IDS.codex | typeof BUILTIN_PROVIDER_IDS.claude;
  sourceChatId: string;
  sourceIncarnation: string;
  sourceMessageRevision: number;
  sourceSessionId: string;
}>;
export type NativeMemberFork = NativeMemberForkSource & {
  complete(outcome: "forked" | "replayed"): Promise<void>;
};
type Resolver = (input: { chatId: string; incarnationId?: string; backend: string }) => NativeMemberFork | undefined;
let resolver: Resolver | null = null;
export function installNativeMemberForkResolver(next: Resolver | null) { resolver = next; }
export function nativeMemberForkFor(input: Parameters<Resolver>[0]) { return resolver?.(input); }
