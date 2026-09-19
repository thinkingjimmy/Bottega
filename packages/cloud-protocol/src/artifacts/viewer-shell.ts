/**
 * [INPUT]: Immutable HTML, exact leased origin, host theme and vendored visualization assets.
 * [OUTPUT]: Two CSP policies and a compatible isolated visualization/document shell that reports readiness before its content loads.
 * [POS]: Shared desktop/Web shell generator; output executes exclusively in untrusted frames.
 */
import { stylesA } from "./vendor/styles-a";
import { stylesB } from "./vendor/styles-b";
import { visualizationRuntime } from "./vendor/runtime";
import { floatingRuntime } from "./vendor/floating";
const ARTIFACT_CDN = "https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://esm.sh https://fonts.bunny.net https://fonts.googleapis.com https://fonts.gstatic.com https://unpkg.com";
export const ARTIFACT_FRAGMENT_CSP = `default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob: data: ${ARTIFACT_CDN}; style-src 'unsafe-inline' blob: data: ${ARTIFACT_CDN}; img-src blob: data: ${ARTIFACT_CDN}; font-src blob: data: ${ARTIFACT_CDN}; media-src blob: data:; worker-src blob:; connect-src blob: data:; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`;
export function artifactDirectoryCsp(origin: string) {
  const url = new URL(origin);
  if (url.origin !== origin || !["http:", "https:"].includes(url.protocol)) throw new Error("artifact-origin-invalid");
  return `default-src ${origin}; script-src ${origin} 'unsafe-inline' ${ARTIFACT_CDN}; style-src ${origin} 'unsafe-inline' ${ARTIFACT_CDN}; img-src ${origin} data: blob: ${ARTIFACT_CDN}; font-src ${origin} data: ${ARTIFACT_CDN}; connect-src ${origin} blob: data:; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`;
}
import { ARTIFACT_THEME_TOKENS } from "./theme";
export { ARTIFACT_THEME_TOKENS, type ArtifactTheme } from "./theme";
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
export function artifactHostRuntime(): string {
  return `(() => {
    const send = value => parent.postMessage(value, '*');
    window.openai = Object.freeze({ sendFollowUpMessage: payload => { send({ type: 'bottega:artifact:follow-up', payload }); return Promise.resolve(); },
      callTool: () => Promise.reject(new Error('Tool calls are unavailable in visualizations')) });
    const noop = new Proxy({}, { get: (_target, key) => key === 'supported' ? false : key === 'then' ? undefined : () => noop });
    window.Tweak = new Proxy(class { constructor() { return noop; } }, { get: (_target, key) => key === 'supported' ? false : () => noop });
    const tokens = ${JSON.stringify(ARTIFACT_THEME_TOKENS)};
    addEventListener('message', event => {
      if (event.source !== parent || event.data?.type !== 'bottega:artifact:theme') return;
      const theme = event.data.theme;
      if (!theme || !['light', 'dark'].includes(theme.mode)) return;
      document.documentElement.style.colorScheme = theme.mode;
      document.documentElement.classList.toggle('dark', theme.mode === 'dark');
      for (const token of tokens) { const value = theme.tokens?.[token]; if (typeof value === 'string' && value.length < 512) document.documentElement.style.setProperty('--' + token, value); }
    });
    addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); send({ type: 'bottega:artifact:escape' }); } });
    addEventListener('click', event => { if (event.target?.closest?.('a[href]')) event.preventDefault(); }, true);
    addEventListener('submit', event => event.preventDefault(), true);
    window.open = () => null;
    // Announced before parsing finishes: a blocked CDN <script src> must not look like a dead artifact.
    send({ type: 'bottega:artifact:ready' });
    const observe = () => {
      let timer;
      const report = () => { clearTimeout(timer); timer = setTimeout(() => { const body = document.body;
        if (body) send({ type: 'bottega:artifact:size', height: Math.ceil(Math.max(body.scrollHeight, document.documentElement.scrollHeight, body.getBoundingClientRect().height)) }); }, 60); };
      new ResizeObserver(report).observe(document.body);
      new MutationObserver(report).observe(document.body, { subtree: true, childList: true, attributes: true });
      addEventListener('load', report); report();
    };
    if (document.readyState === 'loading') addEventListener('DOMContentLoaded', observe, { once: true }); else observe();
  })();`;
}
export function artifactViewerShell(input: { html: string; title: string; directoryOrigin?: string; document?: boolean; theme?: "light" | "dark" }) {
  const csp = input.directoryOrigin ? artifactDirectoryCsp(input.directoryOrigin) : ARTIFACT_FRAGMENT_CSP;
  const head = `<meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="${escapeHtml(csp)}"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${stylesA + stylesB}\nhtml{color-scheme:${input.theme ?? "light"};overflow:${input.document ? "auto" : "hidden"}}body{margin:0;min-height:0;height:auto}*{box-sizing:border-box}@media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}</style><script>${artifactHostRuntime()}</script>`;
  const runtime = `<script>${floatingRuntime}</script>${visualizationRuntime}`;
  if (input.document) {
    let html = input.html;
    if (/<head\b[^>]*>/i.test(html)) html = html.replace(/<head\b[^>]*>/i, value => value + head);
    else html = head + html;
    return html.replace(/<\/body\s*>/i, runtime + "</body>") + (!/<\/body\s*>/i.test(html) ? runtime : "");
  }
  return `<!doctype html><html><head><title>${escapeHtml(input.title)}</title>${head}</head><body>${input.html}${runtime}</body></html>`;
}
