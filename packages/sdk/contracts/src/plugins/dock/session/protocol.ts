/**
 * [INPUT]: None; fixed versioned Dock transport vocabulary.
 * [OUTPUT]: Provides DOCK_OPERATIONS, DockOperation, DOCK_SESSION_TIMING and DOCK_RPC_BUDGET without validators.
 * [POS]: Schema-free session leaf shared by the signed browser SDK, preload and host validation.
 */
export const DOCK_OPERATIONS=['dock.open','dock.heartbeat','dock.data.read','dock.action','dock.close']as const;
export type DockOperation=typeof DOCK_OPERATIONS[number];
export const DOCK_SESSION_TIMING=Object.freeze({heartbeatMs:3000,timeoutMs:10_000,leaseMs:30*60_000});
export const DOCK_RPC_BUDGET=Object.freeze({inputBytes:8192,outputBytes:65536,pending:8,requestsPerSecond:32});
