/**
 * [INPUT]: The browser document and native host Widget detail renderer.
 * [OUTPUT]: A side-effect-free readiness surface.
 * [POS]: Official weather uses host summaries and native details without a resident iframe.
 */
/* global document */
export default function Weather(){return document.createElement('main');}
