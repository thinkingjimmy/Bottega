/**
 * [INPUT]: Depends on ./contract, ./codec and ./client.
 * [OUTPUT]: Provides the page-facing entry: getShell, the ShellBridge types, the shared limits and ShellError.
 * [POS]: Main export of @ai-chat/shell-bridge; the native shell imports ./host.
 */
export * from "./contract";
export { createShellClient, getShell, readDescriptor, resetShellForTesting, type ShellClient } from "./client";
export { decodePageMessage, decodeShellMessage, encodeMessage } from "./codec";
