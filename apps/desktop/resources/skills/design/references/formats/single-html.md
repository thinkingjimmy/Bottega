<!--
  [INPUT]: A user-authorized single HTML task and design_render_check
  [OUTPUT]: Complete offline HTML and source-bound screenshots
  [POS]: M0 ordinary file baseline without old App registration
-->
# Single HTML task

For an explicit single-file request, write complete UTF-8 HTML at `design/<Name>.html`.
Inline CSS, JavaScript, SVG and data-URI images. System fonts only. The screenshot sandbox has
no network, browser storage, popups, forms or workers. Keep state in JavaScript variables.
No React/Babel/framework global is injected. Wait for every writer completion receipt, then render:

```json
{"file":"design/Pricing.html","viewport":"desktop"}
```

The sourceDigest identifies the captured bytes. View the JPEG; responsive pages also need mobile.
The tool creates no document/version. Use document.md for saved multi-file designs.
User-specified old files remain ordinary files; no conversion or inherited App history is implied.
Executable task examples are in `examples/`; read only the relevant example.
