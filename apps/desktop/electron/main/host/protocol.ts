/**
 * [INPUT]: Depends on the public host protocol (@bottega/contracts/host/protocol).
 * [OUTPUT]: Re-exports the host wire vocabulary: HOST_LAUNCH_CONTRACT, HOST_GRAMMAR, HostKind, HostLaunchPlan, HostToBridge and bridgeMessageSchema.
 * [POS]: The desktop path for the wire vocabulary between main and a utility host; the definition is public since TASK-14 S3 and unchanged (the frozen launch contract v1).
 */
export * from "@bottega/contracts/host/protocol";
