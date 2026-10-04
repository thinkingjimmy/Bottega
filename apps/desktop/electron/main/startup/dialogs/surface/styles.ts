/**
 * [INPUT]: System light/dark preference and native system fonts.
 * [OUTPUT]: Bundled dialog CSS with shared hierarchy, wrapping paths and visible keyboard interaction.
 * [POS]: Styles for the pre-renderer desktop surface; no network or application renderer dependency.
 */
export const dialogStyles = `
:root { color-scheme: light dark; --bg:#fff; --fg:#222221; --muted:#696966; --line:#e8e8e6; --hover:#f2f2f0; --button:#222221; --on-button:#fff; }
@media (prefers-color-scheme:dark) { :root { --bg:#202020; --fg:#eee; --muted:#aaa; --line:#393939; --hover:#303030; --button:#eee; --on-button:#202020; } }
* { box-sizing:border-box; }
body { margin:0; background:var(--bg); color:var(--fg); font:14px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif; }
main { padding:28px 24px 20px; }
.heading { display:flex; align-items:center; gap:6px; }
h1 { margin:0; font-size:21px; line-height:1.4; letter-spacing:-.02em; font-weight:650; overflow-wrap:anywhere; }
.message { margin:8px 0 0; color:var(--muted); white-space:pre-line; overflow-wrap:anywhere; }
button { appearance:none; font:inherit; font-weight:500; border:0; border-radius:8px; background:transparent; color:var(--fg); min-height:44px; padding:8px 14px; cursor:pointer; flex-shrink:0; }
button:hover:not(:disabled) { background:var(--hover); }
button:active:not(:disabled) { filter:brightness(.9); }
button:focus-visible,input:focus-visible { outline:2px solid var(--fg); outline-offset:3px; }
button:disabled { color:var(--muted); cursor:default; }
button.primary { background:var(--button); color:var(--on-button); min-width:84px; }
button.primary:hover:not(:disabled) { background:var(--button); opacity:.88; }
button.primary:disabled { background:var(--hover); color:var(--muted); }
button.quiet { color:var(--muted); }
button.copy { min-width:var(--copy-width, 11em); }
.retry { position:relative; flex-shrink:0; }
.icon { width:44px; padding:10px; color:var(--muted); display:grid; place-items:center; }
.icon svg { width:20px; height:20px; }
.tooltip { display:none; position:absolute; top:100%; left:50%; transform:translateX(-50%); background:var(--fg); color:var(--bg); white-space:nowrap; padding:4px 8px; border-radius:5px; font-size:12px; z-index:2; pointer-events:none; }
.retry:not(.dismissed):has(button:is(:hover,:focus-visible)) .tooltip { display:block; }
.candidates { margin-top:24px; display:grid; gap:4px; }
.candidate { display:flex; align-items:flex-start; gap:12px; padding:14px 12px; border-radius:8px; cursor:pointer; }
.candidate + .candidate { border-top:1px solid var(--line); }
.candidate:has(input:checked) { background:var(--hover); }
.candidate:has(input:focus-visible) { outline:2px solid var(--fg); outline-offset:2px; }
.candidate input { margin:4px 0 0; width:17px; height:17px; accent-color:var(--fg); flex-shrink:0; }
.candidate-info { min-width:0; flex:1; }
.path { overflow-wrap:anywhere; user-select:text; }
.candidate small { display:block; margin-top:4px; font-size:13px; color:var(--muted); }
.candidate .icon { margin:-9px -8px 0 0; }
.previous { border-top:1px solid var(--line); margin-top:24px; padding-top:16px; color:var(--muted); font-size:13px; }
.previous .path { margin-top:4px; }
footer { margin-top:28px; display:flex; align-items:center; justify-content:flex-end; gap:12px; flex-wrap:wrap; }
.support,.actions { display:flex; align-items:center; gap:4px; flex-wrap:wrap; justify-content:flex-end; }
footer.split .support { margin-right:auto; justify-content:flex-start; }
@media (max-width:520px) { main { padding:24px 20px 16px; } footer.split .support { width:100%; } .actions { margin-left:auto; } }
`;
