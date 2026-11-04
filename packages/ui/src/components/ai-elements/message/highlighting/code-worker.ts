/**
 * [INPUT]: Depends on the patched Streamdown highlighter and the serializable highlighting protocol
 * [OUTPUT]: Posts supported languages and highlighted results without non-cloneable grammar state
 * [POS]: The only browser owner of Shiki initialization, grammar conversion and tokenization
 */
import { createCodePlugin } from "@streamdown/code";
import type { HighlightRequest, HighlightResponse } from "./protocol";

const scope = self as unknown as {
  postMessage(message: HighlightResponse): void;
  onmessage: ((event: MessageEvent<HighlightRequest>) => void) | null;
};
// The main thread owns the bounded token cache; this worker retains only grammar state.
const highlighter = createCodePlugin({ cacheSize: 0 });
scope.onmessage = ({ data: { id, options } }) => {
  try {
    const send = (result: NonNullable<ReturnType<typeof highlighter.highlight>>) => {
      const { tokens, fg, bg, themeName, rootStyle } = result;
      scope.postMessage({ type: "result", id, result: { tokens, fg, bg, themeName, rootStyle } });
    };
    const result = highlighter.highlight(options, send);
    if (result) send(result);
  } catch (error) {
    scope.postMessage({ type: "failure", id, message: error instanceof Error ? error.message : String(error) });
  }
};
scope.postMessage({ type: "ready", languages: highlighter.getSupportedLanguages() });
