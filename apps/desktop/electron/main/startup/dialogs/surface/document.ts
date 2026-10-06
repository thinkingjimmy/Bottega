/**
 * [INPUT]: Escaped presentation models, a window-specific action token and nonce, and bundled styles.
 * [OUTPUT]: Offline dialog HTML and model markup with explicit keyboard/pointer focus modality; candidate paths remain plain text.
 * [POS]: Sandboxed presentation leaf; the minimal preload carries only allowlisted intents to its owning main window.
 */
import type { DesktopDialogButton, DesktopDialogModel } from "./types";
import { dialogStyles } from "./styles";

const escape = (value: string) => value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
const refreshIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M20 4v6h-6M4 20v-6h6M20 10a8 8 0 0 0-14-5M4 14a8 8 0 0 0 14 5"/></svg>';

export function dialogMarkup(model: DesktopDialogModel, revision: number) {
  const button = (item: DesktopDialogButton) => `<button type="button" data-action="${escape(item.id)}" ${item.requiresSelection ? 'data-requires-selection="true"' : ""}
    class="${item.primary ? "primary" : ""} ${item.quiet ? "quiet" : ""} ${item.id === "copy" ? "copy" : ""}"
    ${model.busy || item.disabled || (item.requiresSelection && !model.selection) ? "disabled" : ""} ${item.id === "copy" ? 'aria-live="polite"' : ""}>${escape(item.label)}</button>`;
  return `<main data-screen="${escape(model.screen)}" data-revision="${revision}" aria-busy="${Boolean(model.busy)}">
    <div class="heading"><h1 tabindex="-1">${escape(model.title)}</h1>${model.retry ? `<span class="retry"><button type="button" class="icon" data-action="search" aria-label="${escape(model.retry)}" aria-describedby="retry-tip" ${model.busy ? "disabled" : ""}>${refreshIcon}</button><span class="tooltip" id="retry-tip" role="tooltip">${escape(model.retry)}</span></span>` : ""}</div>
    <p class="message">${escape(model.message)}</p>
    ${model.candidates?.length ? `<div class="candidates" role="radiogroup" aria-label="${escape(model.title)}">${model.candidates.map(item => `<label class="candidate">
      <input type="radio" name="candidate" value="${escape(item.id)}" data-path="${escape(item.path)}" ${model.selection === item.id ? "checked" : ""} ${model.busy ? "disabled" : ""}>
      <span class="candidate-info"><span class="path">${escape(item.path)}</span><small>${escape(item.detail)}</small></span>
      ${item.isNew && model.cancelNew ? `<button type="button" class="icon" data-action="cancel-new" aria-label="${escape(model.cancelNew)}" ${model.busy ? "disabled" : ""}>×</button>` : ""}</label>`).join("")}</div>` : ""}
    ${model.previous ? `<div class="previous"><div>${escape(model.previous.label)}</div><div class="path">${escape(model.previous.path)}</div></div>` : ""}
    <footer class="${model.support?.length && model.actions.length ? "split" : ""}">
      ${model.support?.length ? `<div class="support">${model.support.map(button).join("")}</div>` : ""}
      ${model.actions.length ? `<div class="actions">${model.actions.map(button).join("")}</div>` : ""}
    </footer></main>`;
}

export function dialogDocument(input: { locale: string; name: string; nonce: string; token: string; model: DesktopDialogModel }) {
  return `<!doctype html><html lang="${escape(input.locale)}"><head><meta charset="utf-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${input.nonce}'; style-src 'nonce-${input.nonce}'; base-uri 'none'; form-action 'none'; frame-src 'none'">
    <title>${escape(input.name)}</title><style nonce="${input.nonce}">${dialogStyles}</style></head><body data-desktop-dialog>
    ${dialogMarkup(input.model, 0)}<script nonce="${input.nonce}">
    (() => {
      const send = (action, selection) => {
        window.desktopDialog.send({ token:${JSON.stringify(input.token)}, revision:Number(document.querySelector('main').dataset.revision), action, selection });
      };
      // A new native window has no input history, so Chromium treats its default focus as keyboard focus.
      document.addEventListener('pointerdown', () => { delete document.body.dataset.keyboardNavigation; });
      document.addEventListener('click', event => {
        const button = event.target.closest('button[data-action]');
        if (!button || button.disabled) return;
        event.preventDefault();
        send(button.dataset.action, document.querySelector('input:checked')?.value);
      });
      document.addEventListener('change', event => {
        if (!event.target.matches('input[type=radio]')) return;
        send('select', event.target.value);
      });
      document.addEventListener('keydown', event => {
        if (!event.altKey && !event.ctrlKey && !event.metaKey) document.body.dataset.keyboardNavigation = 'true';
        if (event.key !== 'Escape') return;
        const retry = document.querySelector('.retry');
        if (retry && getComputedStyle(retry.querySelector('.tooltip')).display !== 'none') { retry.classList.add('dismissed'); return; }
        document.querySelector('[data-action="cancel"], [data-action="return"]')?.click();
      });
      document.addEventListener('focusin', event => { if (event.target.closest('.retry')) event.target.closest('.retry').classList.remove('dismissed'); });
      document.addEventListener('pointerover', event => { if (event.target.closest('.retry')) event.target.closest('.retry').classList.remove('dismissed'); });
    })();</script></body></html>`;
}
