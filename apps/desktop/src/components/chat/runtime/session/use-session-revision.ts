/**
 * [INPUT]: Depends on React state/callback, createSessionRevisionSubmit and the factories that read the latest SessionSubmitInput by call
 * [OUTPUT]: Provides useSessionRevision, closing revision of submissions, successful disclosure and regular submission disclosure
 * [POS]: Modified interaction status of chat/runtime/session; use-chat-session only combines access blocks with controllers, without modifying transaction details
 */

import { useCallback, useState } from "react";
import {
  createSessionRevisionSubmit,
  type SessionSubmitInput,
} from "./create-session-submit";

export function useSessionRevision(
  buildSubmissionInput: () => SessionSubmitInput
) {
  const [revisionDisclosure, setRevisionDisclosure] = useState(false);
  const submitRevision = useCallback(
    async (messageId: string, content: string) => {
      await createSessionRevisionSubmit(buildSubmissionInput())(
        messageId,
        content
      );
      setRevisionDisclosure(true);
    },
    [buildSubmissionInput]
  );
  const clearRevisionDisclosure = useCallback(
    () => setRevisionDisclosure(false),
    []
  );
  return { clearRevisionDisclosure, revisionDisclosure, submitRevision };
}
