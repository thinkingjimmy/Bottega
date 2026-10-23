/**
 * [INPUT]: Portable Artifact rejection codes and filesystem errno values.
 * [OUTPUT]: Typed stage failures and bounded, path-free retry diagnostics.
 * [POS]: Shared capture classification for admission, retention and publication.
 */
import type { ArtifactRejection } from "@ai-chat/cloud-protocol/turns/text/artifact-reference";
export class ArtifactFailure extends Error {
  constructor(readonly code: ArtifactRejection, readonly stage: string, readonly errno?: string) {
    super(code); this.name = "ArtifactFailure";
  }
  get retryable() { return ["missing", "changed", "storage", "publish", "unavailable"].includes(this.code); }
}
export function artifactFailure(cause: unknown, stage: string): ArtifactFailure {
  if (cause instanceof ArtifactFailure) return cause;
  const raw = (cause as NodeJS.ErrnoException | null)?.code;
  const errno = typeof raw === "string" && /^[A-Z0-9_]{1,40}$/.test(raw) ? raw : undefined;
  const code: ArtifactRejection = errno === "ENOENT" ? "missing" : errno === "ELOOP" ? "symlink" :
    ["EACCES", "EPERM"].includes(errno ?? "") ? "unreadable" :
    ["ENOSPC", "EDQUOT"].includes(errno ?? "") ? "budget" : stage === "retain" ? "storage" : ["enqueue", "publish", "release"].includes(stage) ? "publish" : "unavailable";
  return new ArtifactFailure(code, stage, errno);
}
