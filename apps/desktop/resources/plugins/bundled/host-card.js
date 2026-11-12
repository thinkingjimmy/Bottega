/**
 * [INPUT]: The browser document.
 * [OUTPUT]: Shared entry for bundled Widget packages with native host presentation.
 * [POS]: First-party Widget surface declaration.
 */
/* global document */
export default function Widget() {
  return document.createElement("main");
}
