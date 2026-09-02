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

A GUI-only App has no App-owned runtime, process, job, scheduler, database, or
network authority. It may still use consented Base reads/mutations, attachment
reads, scoped workspace preview, preferences, and individually declared Host
Actions. It is an independent “App” Surface, never a Base View.

Choose exactly one authoring profile:

### Compiled profile — default for new product UI

Start from the closest production Starter (CRUD, Dashboard, Kanban, Gallery, or
Editor), then compose `@bottega/app-blocks` and local Base UI primitives. Do not
copy transport, token, polling, CAS, retry, or unknown-outcome state machines.

```text
app.json
gui/
├── components.json
├── component-origins.json
└── src/
    ├── main.tsx
    └── styles.css
```

Minimal manifest fragment:

```json
{
  "kind": "base",
  "packageSchemaVersion": 2,
  "gui": {
    "capabilities": [],
    "build": {
      "preset": "bottega-react-v1",
      "entry": "src/main.tsx",
      "stylesheet": "src/styles.css",
      "iconLibrary": "lucide"
    }
  }
}
```

`bottega-react-v1` means React, TypeScript, Tailwind v4, shadcn Base UI source,
and a Bottega-owned fixed compiler. App-controlled build commands, config,
plugins, CLI execution, dev servers, package manifests, and `node_modules` are
forbidden. Source owns `gui/src/main.tsx`; Bottega generates runtime
`gui/index.html`, external scripts, CSS, transport, and receipt.

- Import Base/environment/preferences through `@bottega/app-react`; never read
  the fragment, raw globals, `/_sdk`, or `/_api`.
- Prefer Bottega UI Blocks for loading, empty, error, permission, conflict,
  unknown-outcome, forms, detail, attachment, export, and virtual tables.
- Large data uses bounded Query V1 plus virtualization; never fetch, sort,
  aggregate, or render the entire Base in the iframe.
- Tailwind scans only `gui/src`. Use complete static class names. Put dynamic
  values in CSS variables. `@plugin`, `@config`, `@source`, external URLs, and
  executable config are rejected.
- shadcn components are local, origin-attested source from the product snapshot
  and use Base UI. Never run a component CLI inside the App. Portals remain in
  the iframe and must preserve focus, Escape, keyboard order, and the root
  stacking context.
- Choose `lucide` or `phosphor`, import named icons statically, and give every
  icon-only control an accessible name and a 44 px target.
- The compiler runs a fixed strict semantic typecheck before emit. Treat its
  stable finding code and relative source location as the repair contract.

### Static profile — legacy/simple pages

Static source supplies `gui/index.html` and uses only product-supported local
resource MIME types. The Gateway MIME allowlist is the single transport truth;
`validate_app` reports unsupported files. MIME support does not grant CSP use:
WASM has a MIME type but dynamic code remains forbidden, and CSS external URLs,
remote fonts/images/scripts, `blob:` images, workers, WebRTC, popups, downloads,
and alternate channels remain blocked.

- Scripts are external files under `gui/`; inline scripts fail validation.
- Use the immutable product `/_sdk/base-api.js`. Consume neither the fragment
  nor a copied/private SDK. The legacy SDK owns token cleanup and transport.
- `gui/index.html` is the fixed entry. History Router fallback is not provided;
  arbitrary SPA paths are blocked unless a fixed legal document exists.
- Preserve stable row ids, Base instance/revision CAS, bounded retry, unknown
  outcome reconciliation, and visibility-aware polling. Never infer pagination
  completion from a short page.
- External CSS URLs are rejected by validation and CSP. Same-origin assets are
  still constrained by the product MIME and CSP policies.

### Capabilities, state, and desktop actions

Default to no privileged capability. Request only the exact subset of
`row-insert`, `row-patch`, `row-delete`, `attachment-read`, or scoped
`workspace-read`; effective runtime grants, never manifest wishes, are truth.

Preferences store only low-risk UI state such as density, column widths,
filters, recent view, collapsed panels, and dismissed onboarding. Define the
strict manifest-owned schema/default digests, use SDK revision CAS, and stay
under 64 KiB. Base rows, attachments, business state, pending writes, tokens,
secrets, paths, and capability decisions belong elsewhere.

`open-data` and `open-data-view` are built-in navigation. `compose-text` and
`file.export` require their exact manifest Host Action and user consent. Native
export receives bytes, MIME, digest, and a suggested basename; the Host chooses
the path. Clipboard, external URL, print, notification, and attachment upload
are not available in this preset. Never emulate them with popup, browser
download, hidden file input, custom scheme, or direct IPC.

If the request needs background sync, timers/jobs, OAuth or arbitrary external
API access, a long-running database, heavy backend compute, or arbitrary file
system access, report that GUI-only cannot provide it. Do not silently generate
a `server` App or invent `backend`, `runtime`, `jobs`, or `scheduler` manifest
fields.

Before handing off, run `validate_app`, then use App Workbench across light and
dark themes, locale/time zone, narrow viewport, reduced motion, keyboard-only,
permission denied, loading, empty, 10,000-row, revision-conflict, and
unknown-outcome fixtures. Errors must be zero; do not claim axe, visual, CSP,
performance, or real-Electron evidence unless that check actually ran.
