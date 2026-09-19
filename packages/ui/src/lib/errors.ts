/**
 * [INPUT]: No external dependence
 * [OUTPUT]: Provides errorMessage (user-readable text with the IPC envelope, the machine-code prefix, and a bare all-caps code stripped), failureCode (the stable code for localized classification), and reportedFailure/isReportedFailure
 * [POS]: Shared error normalization in packages/ui/src/lib.
 */

const MACHINE_CODE = /^[A-Z][A-Z0-9_]{3,}:\s*/;

const BARE_MACHINE_CODE = /^[A-Z][A-Z0-9_]{3,}$/;

export const failureCode = (cause: unknown) => {
  const message = (cause instanceof Error ? cause.message : String(cause))
    .replace(IPC_ENVELOPE, "")
    .trim();
  if (BARE_MACHINE_CODE.test(message)) return message;
  return MACHINE_CODE.exec(message)?.[0].replace(/:\s*$/, "") ?? "";
};

const IPC_ENVELOPE = /^Error invoking remote method '[^']*':\s*(?:\w*Error:\s*)?/;

export const errorMessage = (cause: unknown, fallback?: string) => {
  const envelopeFree = (cause instanceof Error ? cause.message : fallback ?? String(cause))
    .replace(IPC_ENVELOPE, "")
    .trim();
  const stripped = (
    BARE_MACHINE_CODE.test(envelopeFree)
      ? ""
      : envelopeFree.replace(MACHINE_CODE, "")
  ).trim();

  return stripped || fallback || "";
};

const REPORTED = Symbol("failure-reported");

export const reportedFailure = (cause: unknown) =>
  Object.assign(cause instanceof Error ? cause : new Error(String(cause)), {
    [REPORTED]: true,
  });

export const isReportedFailure = (cause: unknown) =>
  typeof cause === "object" && cause !== null && REPORTED in cause;
