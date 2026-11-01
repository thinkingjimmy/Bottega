/**
 * [INPUT]: Existing third-column title and header-action slots.
 * [OUTPUT]: Stable title/action portal targets for the active Artifact without a second content header.
 * [POS]: Artifact presentation adapter; shared tab shell classes and dimensions stay unchanged.
 */
import { useMemo, useState } from "react";
export function useArtifactTabChrome() {
  const [title, setTitle] = useState<HTMLSpanElement | null>(null), [actions, setActions] = useState<HTMLSpanElement | null>(null);
  return { value: useMemo(() => ({ title, actions }), [title, actions]),
    title: <span ref={setTitle} data-artifact-tab-title="" className="contents" />,
    actions: <span ref={setActions} data-artifact-tab-actions="" className="contents" /> };
}
