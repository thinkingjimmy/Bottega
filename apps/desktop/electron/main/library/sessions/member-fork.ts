/**
 * [INPUT]: Main-owned persistent member registry and exact source Chat/session facts.
 * [OUTPUT]: NativeMemberFork, sealed source identity and a main-only fork resolver registration.
 * [POS]: Generic session optimization authority; renderer payloads and ordinary Chat options cannot issue it.
 */
export type NativeMemberForkSource = Readonly<{
  backend: "codex" | "claude";
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
