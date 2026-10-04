/**
 * [INPUT]: Depends on esbuild and the package's installed public SDK.
 * [OUTPUT]: Builds the browser entry and its self-contained HTML document in dist.
 * [POS]: Standalone package build; no repository paths or workspace resolution.
 */
import { build } from "esbuild";
import { writeFile } from "node:fs/promises";
await build({ entryPoints: ["src/index.ts"], bundle: true, platform: "browser", format: "esm", target: "es2022", outfile: "dist/index.js", minify: true, legalComments: "none" });
await writeFile("dist/index.css", `:root{font:16px system-ui;color-scheme:light dark}body{margin:0;padding:24px;max-width:680px}h1{font-size:24px}pre{max-height:180px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;font:13px ui-monospace;background:Canvas;border:1px solid GrayText;border-radius:8px;padding:12px}textarea{box-sizing:border-box;width:100%;min-height:120px;font:inherit;padding:12px;border-radius:8px}button{font:inherit;min-height:44px;padding:0 16px;cursor:pointer;margin-top:12px}label{display:block;margin:16px 0 8px}p{line-height:1.5}`);
await writeFile("dist/index.html", `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Record review</title><link rel="stylesheet" href="./index.css"><main><h1>Review record</h1><p id="status" role="status">Opening record…</p><pre id="record"></pre><label for="report">Your review</label><textarea id="report" maxlength="1000"></textarea><button id="save" disabled>Save result</button></main><script type="module" src="./index.js"></script></html>`);
