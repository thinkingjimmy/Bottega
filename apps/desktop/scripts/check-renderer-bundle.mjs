/**
 * [INPUT]: Depends on the closed output-root parser, the shared LAZY_LANES table, Node fs/path/zlib, the selected assembly's renderer HTML and eager JS, and the temporary Rollup module report.
 * [OUTPUT]: Enforces eager raw/gzip budgets and independent dynamic boundaries for charts, native/composer locales, Konva, and React-Konva, including negative self-tests.
 * [POS]: Last segment of the desktop build script; the renderer first-load boundary is enforced mechanically here and the module report is deleted after checking so it never ships
 */

import { readFileSync, rmSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import console from "node:console";
import process from "node:process";
import { gzipSync } from "node:zlib";
import { resolveOutputRoot } from "./assembly/output-root.mjs";
import { LAZY_LANES } from "./assembly/lazy-lanes.mjs";

const MAX_RAW_BYTES = 3_520_000;
/* 2026-09-12: 741,599 → 744,886 (stable, CI) / 745,112 (staging, the default local `pnpm build` output, which carries
   ~220 B more cloud config) for sidebar drag reordering: row wiring, optimistic provider path and five-language copy stay eager;
   the reorder runtime is a lazy chunk, @dnd-kit/core itself was already eager through the composer queue. Raised by the measured
   delta, as on 2026-08-15, not by a round number, and sized against the heavier flavour so both builds pass the same gate. */
// Main integration measures 746,514 (stable) and 747,068 (staging) gzip bytes.
// Cover both assemblies at the measured maximum; raw and lazy-lane gates stay unchanged.
/* 2026-09-13: 747,068 → 748,817 (staging) for startup loading states: sidebar/transcript/Apps-list
   skeletons, the SidebarMenuSkeleton primitive, the cached Skills onboarding snapshot and the
   renderer startup marks all sit on the first-paint path by design. Raised by the measured delta. */
/* 2026-09-13 (phase 2): 748,817 → 749,473 (staging) for the startup snapshot decoder (gate opens
   on the first render without IPC), the idle prefetch helper and the draft-page transcript
   placeholder. Raised by the measured delta. */
/* 2026-09-13 (memory): 749,473 → 761,296 (staging) for zod 4.4.3 → 4.6.4. The whole delta is zod
   itself (+47,169 raw in the client chunk, the eager raw total's entire movement); no product code
   entered the first load. It buys back 25 MB of main-isolate heap and 6.5 MB of renderer heap,
   because 4.5 stopped binding methods per instance and 4.6 moved eight metadata members off the
   instance — a resident schema tree drops roughly four fifths. 47 KB of extra parse against
   31 MB of resident heap is not a close trade, and this binary is not downloaded per visit.
   Raised by the measured delta, as before. */
/* 2026-09-13 (browser tab sleep): 761,296 -> 761,315 (staging) for the sleeping browser tab in the
   side-panel strip: one dim class, one tooltip and the five-language `chat.sidePanel.sleepingTab`
   copy. The sleep/wake machinery itself is main-process only. Raised by the measured delta, as before. */
/* 2026-09-17 (ledger): ac637c77 still rebuilds to 761,296, byte for byte the number in its own note, so this
   gate is reproducible on any machine. 6d1a444d declared 761,315 but rebuilds to 761,910 — it was never run on
   that commit, and its +19 accounted only for the browser tab sleep, not the usage-limits reader shipped beside it.
   The 09-15/16 Cloud Web ↔ desktop sharing work is net −187 B: it moved code between packages, it did not add. */
/* 2026-09-17 (i18n reclaim): 761,723 → 670,609 (staging) / 761,589 → 670,463 (stable). This is a structural
   reclaim, not an addition: sixteen feature catalogs that packed all five languages into one module were split
   into per-language directories, so the four non-English leaves finally sit behind the lazy boundary the locale
   entries always claimed, and the Confetti icon stopped importing the Phosphor barrel. Lowered to the measured
   maximum of the two flavours, sized against the heavier staging one, as every entry above is. A budget only
   moves up against a proven first-paint need; after a reclaim it must move down, or it is just a longer rope. */
/* 2026-09-17 (cloud review): 607,422 staging / 607,260 stable after G3–G7 and shared UI catalogs.
   Queue drag, canvas, model menu and App/Base dialogs now cross independent lazy boundaries. Base owner
   keys and version scalars no longer pull validation/compute into eager consumers. The heavier measured
   assembly sets the ceiling; retain Sonner's single instance rather than adding a second toast runtime. */
/* 2026-09-17 (phone control): 608,043 staging / 607,888 stable after keeping completion UI lazy and
   the interaction reducer schema-free. The 621-byte staging increase is the live winning-device
   projection and its attach/IPC state, coarse Enter policy and protocol v6 presence/reason fields;
   completion labels and the remote composer catalog stay outside first paint. */
/* Connection recovery adds the server epoch and conditional heartbeat predecessor to protocol v6.
   Measured staging is 608,048 bytes: five additional gzip bytes, with all lazy boundaries retained. */
/* Protocol v7 and the unified ChatPage add first-paint queue/target facts, capabilities and shared
   controls. After retaining lazy remote draft execution and both model menus, staging measures
   617,004 bytes. The 8,956-byte increase is measured feature cost; raw and all lazy gates remain. */
/* 2026-09-18 (remote-control review): 617,004 → 618,019 (staging), measured in two parts on this machine.
   +334 is the shared remote conversation alone, with the desktop renderer reverted: the executor-change
   notice and the withdrawal custody it needs. +681 is the desktop composer's account gate — it now asks the
   account, not the injected `window.cloudRemote` (handed to every main window, signed in or not), whether an
   account-owned draft adapter could do anything at all, warms that chunk at idle, and names the executor on
   the branch control a remote draft cannot use. The adapter itself stays behind its lazy boundary at 21,577
   raw / 5,730 gzip, which is why only the gate is in this number. Raised by the measured delta, as above. */
/* 2026-09-18 (seamless executor switch): 618,019 → 618,411 (staging) / 618,239 (stable). Moving one
   conversation to another computer used to remount the page behind a Suspense boundary: the columns
   blanked for a tick and the transcript reopened on the newest row. The +392 is the timeline's
   cross-mount anchor memory (the row the reader was on and its pixel offset, plus the restore that
   puts it back), the page's composer-focus restore, and the two resolved-chunk latches that replace
   the suspending boundaries on both halves of the cloud port — the chunks themselves stay lazy and
   every lane above still holds. Raised by the measured delta, sized against the heavier staging
   assembly, as every entry above is. */
/* 2026-09-18 (Agent connections, Settings › Lab): 618,411 → 619,427 (staging). The +1,016 is the
   warm-intent client and its two hooks — the chat page's 800 ms dwell and the composer's focus
   path — plus the Lab section's navigation entry, overlay routing, the settings key and the
   switch's English copy. The Lab view itself is a lazy chunk like every other settings view, and
   nothing else moved into the eager set. Raised by the measured delta, sized against the heavier
   staging assembly, as every entry above is. */
/* 2026-09-18 (read-only chats and the model reconciliation): 619,427 → 619,595 (staging). The +168 is the
   stricter reconciliation guard, the quiet write path that keeps an automatic reconciliation from
   surfacing as a failed manual save, and the CHAT_NOT_WRITABLE → read-only/archived copy mapping.
   Raised by the measured delta, sized against the heavier staging assembly, as every entry above is. */
/* 2026-09-22 (0.1.6, per-computer sidebar): 619,595 → 626,192. Measured by bisect over 439773d67..a8a52273e,
   one renderer build per commit; the base rebuilds to 618,606, the figure b0d recorded on 09-20. Staging and
   production now emit the same two eager files, byte for byte, so one number covers both and the "heavier
   assembly" clause above has nothing left to choose between.
   The feature set moved 25,590 bytes, of which 18,004 were given back before this number was set. The two
   commits that carried 91 % of the growth had each added one eager edge into an always-lazy subtree, and Rollup
   hoisted the subtree:
     −13,332  five-language shared remote copy (chat-ui/i18n/remote.ts + i18n/copy.ts + remote/composer/status.ts,
              35,904 raw) left the first load: app-sidebar.tsx now reads useViewedComputerBlock, which imports
              creation-target.ts dynamically. The sentence is null while the sidebar is local, and the sidebar is
              local until the account's computer list arrives — so nothing that could be painted is deferred.
      −3,925  the account Settings rows (settings/controls.tsx + settings/content.tsx + account/device-list.tsx,
              19,302 raw) left with them: relativeMoment is its own leaf, so the strip reads a moment instead of
              a settings page.
        −747  the pin picker is its own lazy chunk, like every other sidebar dialog.
   What remains, +7,586 over b0d, is first paint by construction: the per-profile computer preference store,
   useComputerScope, the pinned rows and the two-item `+`, the computer switcher strip and its shared tablist
   (1,291 — measured behind a lazy boundary and deliberately left eager: it is the sidebar's top chrome), the
   remote Project row and its origin badge, the account facade and the machine-key protocol, and +158 of eager
   English catalogs (zh-cn/ja/fr/es stayed behind the 非 en 语言目录 lane). Raised by the measured residual, after
   the reclaim, as the rule above requires. */
const MAX_GZIP_BYTES = 626_192;
const outputRoot = resolveOutputRoot(process.argv.slice(2), process.env, ["--self-test"]);
const rendererRoot = resolve(import.meta.dirname, "..", outputRoot, "renderer");
const indexPath = resolve(rendererRoot, "index.html");
const reportPath = resolve(rendererRoot, ".chart-module-report.json");

function attribute(tag, name) {
  const match = tag.match(
    new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, "i")
  );
  return match?.[1];
}

function eagerReferences(html) {
  const references = new Set();
  for (const tag of html.match(/<(?:script|link)\b[^>]*>/gi) ?? []) {
    const script = /^<script\b/i.test(tag) && attribute(tag, "type") === "module";
    const preload =
      /^<link\b/i.test(tag) && attribute(tag, "rel") === "modulepreload";
    const reference = attribute(tag, script ? "src" : "href");
    if ((script || preload) && reference?.match(/\.js(?:[?#]|$)/)) {
      references.add(reference);
    }
  }
  return [...references];
}

function resolveReference(reference) {
  if (/^[a-z][a-z\d+.-]*:/i.test(reference) || reference.startsWith("//")) {
    throw new Error(`eager JS 不是本地产物: ${reference}`);
  }
  const pathname = decodeURIComponent(reference.split(/[?#]/, 1)[0]);
  const filePath = resolve(rendererRoot, pathname.replace(/^\.?\//, ""));
  const localPath = relative(rendererRoot, filePath);
  if (localPath.startsWith(`..${sep}`) || isAbsolute(localPath)) {
    throw new Error(`eager JS 越过 renderer 输出目录: ${reference}`);
  }
  return { filePath, localPath };
}

function measureReference(reference) {
  const { filePath, localPath } = resolveReference(reference);
  const source = readFileSync(filePath);
  if (!source.byteLength) throw new Error(`eager JS 为空: ${reference}`);
  return {
    filePath,
    path: localPath,
    raw: source.byteLength,
    gzip: gzipSync(source, { level: 9 }).byteLength,
  };
}

function format(bytes) {
  return bytes.toLocaleString("en-US");
}

function checkBundle() {
  const html = readFileSync(indexPath, "utf8");
  const references = eagerReferences(html);
  if (!references.length) throw new Error("index.html 未声明 eager module JS");

  const measured = references.map(measureReference);
  const chunks = [
    ...new Map(measured.map((chunk) => [chunk.filePath, chunk])).values(),
  ];
  const raw = chunks.reduce((total, chunk) => total + chunk.raw, 0);
  const gzip = chunks.reduce((total, chunk) => total + chunk.gzip, 0);

  for (const chunk of chunks) {
    console.log(
      `[bundle-budget] ${chunk.path}: ${format(chunk.raw)} raw / ${format(chunk.gzip)} gzip`
    );
  }
  console.log(
    `[bundle-budget] eager total: ${format(raw)} / ${format(MAX_RAW_BYTES)} raw, ${format(gzip)} / ${format(MAX_GZIP_BYTES)} gzip`
  );
  if (raw > MAX_RAW_BYTES || gzip > MAX_GZIP_BYTES) {
    throw new Error("renderer eager JS 超过体积预算");
  }
}

function validateModuleReport(report) {
  if (!Array.isArray(report?.chunks) || !report.chunks.length) {
    throw new Error("renderer 模块报告为空");
  }
  const chunks = new Map(
    report.chunks.map((chunk) => [chunk.fileName, chunk])
  );
  const entries = report.chunks.filter((chunk) => chunk.isEntry);
  if (!entries.length) throw new Error("renderer 模块报告没有 entry");
  const laneChunks = LAZY_LANES.map((lane) => {
    const hits = report.chunks.filter((chunk) =>
      chunk.moduleIds.some((id) => lane.pattern.test(id))
    );
    if (!hits.length) {
      throw new Error(`renderer 模块报告未命中任何${lane.name}模块`);
    }
    return { lane, hits };
  });

  const staticVisited = new Set();
  const visitStatic = (name) => {
    if (staticVisited.has(name)) return;
    staticVisited.add(name);
    const chunk = chunks.get(name);
    if (!chunk) throw new Error(`renderer 模块报告缺少 import chunk: ${name}`);
    for (const lane of LAZY_LANES) {
      if (chunk.moduleIds.some((id) => lane.pattern.test(id))) {
        throw new Error(`${lane.name}进入 renderer entry 静态闭包: ${name}`);
      }
    }
    chunk.imports.forEach(visitStatic);
  };
  entries.forEach((entry) => visitStatic(entry.fileName));

  const dynamicallyReachable = new Set();
  const queue = entries.map((entry) => [entry.fileName, false]);
  const visited = new Set();
  while (queue.length) {
    const [name, crossedDynamic] = queue.shift();
    const key = `${name}:${crossedDynamic}`;
    if (visited.has(key)) continue;
    visited.add(key);
    const chunk = chunks.get(name);
    if (!chunk) continue;
    if (crossedDynamic) dynamicallyReachable.add(name);
    chunk.imports.forEach((next) => queue.push([next, crossedDynamic]));
    chunk.dynamicImports.forEach((next) => queue.push([next, true]));
  }
  for (const { lane, hits } of laneChunks) {
    for (const chunk of hits) {
      if (!dynamicallyReachable.has(chunk.fileName)) {
        throw new Error(
          `${lane.name} chunk 未经 dynamic import 边界到达: ${chunk.fileName}`
        );
      }
    }
  }
}

/**
 * 每条懒边界都必须有自己的负向对照：没有「摘掉就会红」的证据，一条断言
 * 与一行注释没有区别。故 fixture 逐条生成——加边界即自动带上它的反例。
 */
function selfTest() {
  const lazyChunks = LAZY_LANES.map((lane, index) => ({
    fileName: `lazy-${index}.js`,
    isEntry: false,
    imports: [],
    dynamicImports: [],
    moduleIds: [lane.sample],
  }));
  const entry = {
    fileName: "entry.js",
    isEntry: true,
    imports: [],
    dynamicImports: lazyChunks.map((chunk) => chunk.fileName),
    moduleIds: ["src/main.tsx"],
  };
  validateModuleReport({ chunks: [entry, ...lazyChunks] });

  for (const [index, lane] of LAZY_LANES.entries()) {
    const hoisted = lazyChunks[index].fileName;
    let failed = false;
    try {
      validateModuleReport({
        chunks: [
          {
            ...entry,
            imports: [hoisted],
            dynamicImports: entry.dynamicImports.filter(
              (name) => name !== hoisted
            ),
          },
          ...lazyChunks,
        ],
      });
    } catch {
      failed = true;
    }
    if (!failed) {
      throw new Error(`bundle guard 的${lane.name}失败 fixture 未变红`);
    }
  }
}

try {
  if (process.argv.includes("--self-test")) selfTest();
  checkBundle();
  const report = JSON.parse(readFileSync(reportPath, "utf8"));
  validateModuleReport(report);
  rmSync(reportPath, { force: true });
} catch (cause) {
  console.error(
    `[bundle-budget] ${cause instanceof Error ? cause.message : String(cause)}`
  );
  process.exitCode = 1;
}
