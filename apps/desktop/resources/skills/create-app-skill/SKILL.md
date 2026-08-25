---

<!--
- [INPUT]: Depends on the current App workspace, Project Base schema and user explicitly requested GUI input
- [OUTPUT]: GUIde Agents to create App contracts, data skills, and independent GUI Surface that is read-only/express-only by default
- [POS]: Base App author input for resources/skills; Only describe public contracts, not reveal main implementation
-->
name: create-app-skill
description: Turn the current app-building conversation and Project Base schema into durable workspace instructions. Use after Save as App asks you to replace the AGENTS.md placeholder and create the app-specific Base data-entry skill.
requires: "builtin-tools: mutate"
---

# Create App Skill

Work only in the current App workspace. Treat the current conversation and its
Project Base as the source of truth.

1. Read the existing `README.md`, `AGENTS.md`, `CLAUDE.md`, conversation context,
   and Project Base schema. Infer rules only when the evidence is clear.
2. Replace `AGENTS.md` with a short always-loaded contract:
   - say what the App does;
   - summarize the Base columns and invariants;
   - tell the Agent exactly when to read
     `.agents/skills/<app-slug>/SKILL.md`.
3. Create `.agents/skills/<app-slug>/SKILL.md` with `name`, `description`, and
   `requires: "builtin-tools: mutate"` in YAML frontmatter, then document:
   - keep `description` to one sentence: Codex places all visible skill metadata
     inside a 2% context budget, so long descriptions crowd out other skills;
   - the canonical column mapping;
   - validation and normalization rules;
   - common natural-language input shapes;
   - duplicate/conflict behavior;
   - a few synthetic examples.
4. Keep `CLAUDE.md` exactly `@AGENTS.md` followed by one newline.
5. Complete `README.md` for future users before sharing:
   - one plain-language purpose paragraph;
   - numbered usage steps and one synthetic input example;
   - declared CLI/MCP/config requirements, without any configuration value;
   - no real row, secret, local path, account, or private repository detail.
6. Remove the `create-app-skill:pending` marker. Never copy real secrets or
   sensitive row values into README or either instruction file.
7. Re-read all three files and compare them with the actual Base schema. Keep
   `AGENTS.md` concise; put detailed procedure only in the app skill.

## Custom GUI (only when the user asks for one)

An App can ship an independent static Surface in `gui/`. The product serves it
from the App's own gateway origin and exposes it as “应用” beside “数据”. It is
not a Base View: do not call `base_set_view`. Do this only on request — Apps
without `gui/` behave exactly as before.

Rules that are not style preferences; break one and the page silently fails:

1. **Write plain static files into `gui/`.** No build step, no dev server, no
   `node_modules`. HTML/CSS/JS/SVG only. Sub-directories are fine.
2. **Never write inline `<script>`.** The GUI is served with
   `script-src 'self'`, so inline script is blocked and the page renders blank
   with no error the user can see. Put JS in a separate file and reference it:
   `<script src="./app.js"></script>`. Inline `<style>` is allowed.
3. **Only same-origin subresources.** No CDN links, remote fonts, remote
   images, WebRTC, workers, or alternate data channel. Data URIs are allowed
   for images.
4. **Consume the fragment token once.** Read `baseToken` from `location.hash`,
   keep it only in memory, then immediately remove the fragment with
   `history.replaceState`. Never log, render, persist, or put it in a query.
5. **Read the Base through the same-origin API:**
   - `GET /_api/base/meta` → `{ name, columns, views, revision, rowCount,
     baseInstanceId, capabilities: { rowInsert } }`
   - `GET /_api/base/rows?limit=&cursor=` → `{ rows, nextCursor, revision, columns }`
   Both require `Authorization: Bearer <token>`. Read every page until
   `nextCursor` is absent, then re-read meta and require the same
   `baseInstanceId + revision`; never infer EOF from a short page. `_api` is a
   reserved prefix, so `gui/_api/...` files are unreachable.
6. **Default to read-only.** New Base Apps must omit `gui.capabilities`. Only
   request the exact needed subset of `row-insert`, `row-patch`, `row-delete`,
   and `attachment-read`. The immutable generation still needs per-capability
   user consent; runtime behavior follows `meta.capabilities`, never manifest
   wishes.
7. **Use the product SDK.** Load `<script defer src="/_sdk/base-api.js"></script>`
   and call `window.BottegaBase`. Direct HTTP remains available for debugging,
   but never copy a private SDK into each App. Meta mutation, import, and
   attachment upload remain unavailable. The Host chooses the App's Base; no
   body may contain ownerKey, projectId, appId, or a path.
8. **Use CAS and stable ids.** POST one strict batch:

   ```json
   {
     "expectedBaseInstanceId": "<meta.baseInstanceId>",
     "expectedRevision": 12,
     "rows": [{ "id": "<stable-random-id>", "values": { "name": "Example" } }]
   }
   ```

   Freeze ids and values before the first POST. A retry or reconciliation must
   reuse that exact batch. Only `expectedRevision` may be rebased after a full
   consistent refresh; `expectedBaseInstanceId` never rebases. Editing creates
   a new frozen batch with new ids.
9. **Treat outcome, not status text, as authority.** A 200 response (including
   `replayed=true`) is durable, so refresh but never POST again if refresh
   fails. `revision_conflict` requires full refresh/reconcile; `row_id_conflict`
   and `base_instance_changed` are hard conflicts. Respect 429 `Retry-After`
   with a bounded retry. A disconnect or `outcome=unknown` freezes the batch
   until all stable ids are reconciled. `outcome=not-committed` may return to an
   editable error. Focus the first bounded `issues` entry without displaying
   raw internal details.
10. **Refresh by polling meta at most every few seconds.** Re-fetch all rows
    only when instance/revision changed, abort hidden or superseded reads, and
    stop polling when the Surface unloads.

Minimal `gui/app.js` shape:

```js
const params = new URLSearchParams(location.hash.slice(1));
const token = params.get("baseToken");
history.replaceState(null, "", location.pathname + location.search);
const api = (path) =>
  fetch(path, { headers: { Authorization: `Bearer ${token}` } }).then((r) => {
    if (!r.ok) throw new Error(`${path} ${r.status}`);
    return r.json();
  });

let seen = -1;
async function tick() {
  const meta = await api("/_api/base/meta");
  if (meta.revision === seen) return;
  seen = meta.revision;
  const rows = [];
  let cursor = "";
  do {
    const page = await api(`/_api/base/rows?limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
    rows.push(...page.rows);
    cursor = page.nextCursor ?? "";
  } while (cursor);
  render(meta, rows);
}
tick();
setInterval(() => tick().catch(console.error), 3000);
```

Use `gui/index.html` as the fixed entry. Internal pages and assets stay under
`gui/`, and `index.html` owns any internal navigation. Without an explicit
row-insert request, keep the example and generated manifest read-only.
