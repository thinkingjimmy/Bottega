/**
 * [INPUT]: Depends on strict appManifestSchema, white list inspectPackage, base snapshot/App data migration schema, skill frontmatter parser, config requirement, and templates are ranked
 * [OUTPUT]: Provides validate AppPackage ((dir): Structured errors/warnings, proof of GUI capability/fixed input/external scripts and skill description Budget
 * [POS]: The app's self-check check-point is installed, shared with Agent, and is self-check-backed using the same set of checks, and that's not the second truth
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AppManifest } from "../../../../shared/apps-ipc";
import { baseSnapshotFileSchema } from "../../../../shared/base-snapshot";
import { appBaseDataMigrationFileSchema } from "../../../../shared/app-data-migration";
import { errorMessage } from "../../errors";
import {
  SKILL_FRONTMATTER_PATTERN,
  parseSkillFrontmatter,
} from "../../skills-catalog";
import { appManifestSchema } from "../install/manifest-schema";
import { validateConfigRequirements } from "../share/app-config-store";
import { inspectPackage } from "../share/package/package-contract";
import { APP_SKILL_PLACEHOLDER, README_SKELETON_HINT } from "./templates";

export type AppFinding = { file: string; reason: string };
export type AppValidation = {
  errors: AppFinding[];
  warnings: AppFinding[];
};

const FINDING_LIMIT = 100;
const SKILL_DESCRIPTION_LIMIT = 1_024;
/** 内联 `<script>` 被 `script-src 'self'` 静默拦截——页面白屏且无任何用户可见错误。 */
const INLINE_SCRIPT = /<script(?![^>]*\bsrc=)[^>]*>/i;

export async function validateAppPackage(dir: string): Promise<AppValidation> {
  const report = new Report();

  /* 包契约先行：树本身不可信（symlink/超限/逃逸）时，后续逐文件读取都没有意义。 */
  const inspection = await inspectPackage(dir).catch((cause) => {
    report.error(".", errorMessage(cause));
    return null;
  });
  if (!inspection) return report.result();

  const files = new Set(inspection.files.map((file) => file.path));
  for (const path of inspection.ignored) {
    report.warn(path, "不在包白名单内，分享时会被剥离（本地仍可用）");
  }

  const manifest = await checkManifest(dir, files, report);
  await checkConventions(dir, files, report);
  await checkSkills(dir, files, report);
  await checkSeed(dir, files, report);
  await checkDataMigrations(dir, files, report);
  await checkGui(dir, inspection.files, manifest, report);
  return report.result();
}

async function checkDataMigrations(
  dir: string,
  files: ReadonlySet<string>,
  report: Report
) {
  const path = "migrations/base.json";
  if (!files.has(path)) return;
  const parsed = await readJson(dir, path).catch((cause) => {
    report.error(path, `不是合法 JSON：${errorMessage(cause)}`);
    return undefined;
  });
  if (parsed === undefined) return;
  const migration = appBaseDataMigrationFileSchema.safeParse(parsed);
  if (!migration.success) {
    report.error(path, `不符合 App Base migration 契约：${migration.error.message}`);
  }
}

async function checkManifest(
  dir: string,
  files: ReadonlySet<string>,
  report: Report
) {
  if (!files.has("app.json")) {
    report.error("app.json", "缺失：App 包必须有 manifest");
    return null;
  }
  const parsed = await readJson(dir, "app.json").catch((cause) => {
    report.error("app.json", `不是合法 JSON：${errorMessage(cause)}`);
    return undefined;
  });
  if (parsed === undefined) return null;
  const manifest = appManifestSchema.safeParse(parsed);
  if (!manifest.success) {
    report.error("app.json", `不符合 manifest 契约：${manifest.error.message}`);
    return null;
  }
  if (manifest.data.kind !== "base") {
    report.error("app.json", `kind 必须是 base，实际是 ${manifest.data.kind}`);
    return null;
  }
  try {
    validateConfigRequirements(manifest.data.requirements?.tools ?? []);
  } catch (cause) {
    report.error("app.json", `requirements 不可用：${errorMessage(cause)}`);
  }
  return manifest.data;
}

async function checkConventions(
  dir: string,
  files: ReadonlySet<string>,
  report: Report
) {
  if (!files.has("AGENTS.md")) {
    report.error("AGENTS.md", "缺失：恒加载协议是 skill 生效的前提");
  } else if ((await readText(dir, "AGENTS.md")).includes(APP_SKILL_PLACEHOLDER)) {
    report.warn("AGENTS.md", "仍是 create-app-skill 占位，协议尚未写出");
  }

  /* CLAUDE.md 的唯一合法内容就是这一行 import：多写一个字，三家 CLI 的约定就分叉。 */
  if (!files.has("CLAUDE.md")) {
    report.error("CLAUDE.md", "缺失：Claude 侧靠它 import AGENTS.md");
  } else {
    const content = (await readText(dir, "CLAUDE.md")).trim();
    if (content !== "@AGENTS.md") {
      report.error("CLAUDE.md", "内容必须恰为 @AGENTS.md，不要另写正文");
    }
  }

  if (!files.has("README.md")) {
    report.warn("README.md", "缺失：安装前介绍与使用引导为空");
    return;
  }
  const readme = await readText(dir, "README.md");
  if (!readme.trim() || readme.includes(README_SKELETON_HINT)) {
    report.warn("README.md", "仍是骨架占位，分享前需要补完用途与使用步骤");
  }
}

async function checkSkills(
  dir: string,
  files: ReadonlySet<string>,
  report: Report
) {
  // slug 只能是目录：深度 ≥4 才有 <slug>/ 层；skills 根下的散文件单独指名，
  // 不然会拼出「notes.md/SKILL.md 缺少」这种不存在的路径
  const slugs = new Set<string>();
  for (const path of files) {
    if (!path.startsWith(".agents/skills/")) continue;
    const segments = path.split("/");
    if (segments.length >= 4) slugs.add(segments[2]!);
    else {
      report.warn(path, "散落在 skills 根下的文件不属于任何 skill，不会被加载");
    }
  }
  if (slugs.size === 0) {
    report.warn(
      ".agents/skills/",
      "还没有任何 skill：详细协议应放在这里，AGENTS.md 只留指路"
    );
    return;
  }
  for (const slug of [...slugs].sort()) {
    const path = `.agents/skills/${slug}/SKILL.md`;
    if (!files.has(path)) {
      report.error(path, "skill 目录缺少 SKILL.md，不会被任何 CLI 加载");
      continue;
    }
    const content = await readText(dir, path);
    const block = SKILL_FRONTMATTER_PATTERN.exec(content)?.[1];
    if (!block) {
      report.error(path, "缺少 --- frontmatter 块");
      continue;
    }
    for (const field of ["name", "description"] as const) {
      if (!new RegExp(`^${field}:\\s*\\S`, "m").test(block)) {
        report.error(path, `frontmatter 缺少 ${field}`);
      }
    }
    const description = parseSkillFrontmatter(content, slug).description;
    if (description.length > SKILL_DESCRIPTION_LIMIT) {
      report.warn(
        path,
        `frontmatter description 超过 Codex 单 skill ${SKILL_DESCRIPTION_LIMIT} 字符上限，可能被截短`
      );
    }
  }
}

async function checkSeed(
  dir: string,
  files: ReadonlySet<string>,
  report: Report
) {
  /* 运行目录本就没有 data/：它只是安装种子，灌进 Base 后即被删除。因此
     「缺 data/」在这里从来不是错误——种子必须存在这条由安装准入把守。 */
  if (!files.has("data/base.json")) return;
  report.warn(
    "data/base.json",
    "只是安装种子，运行时不读取；改列改数据请直接操作 live Base，分享时产品会重新导出"
  );
  const parsed = await readJson(dir, "data/base.json").catch((cause) => {
    report.error("data/base.json", `不是合法 JSON：${errorMessage(cause)}`);
    return undefined;
  });
  if (parsed === undefined) return;
  const snapshot = baseSnapshotFileSchema.safeParse(parsed);
  if (!snapshot.success) {
    report.error(
      "data/base.json",
      `不符合 Base 快照契约：${snapshot.error.message}`
    );
    return;
  }
}

async function checkGui(
  dir: string,
  files: ReadonlyArray<{ path: string }>,
  manifest: AppManifest | null | undefined,
  report: Report
) {
  const html = files.filter(
    (file) => file.path.startsWith("gui/") && file.path.endsWith(".html")
  );
  if (
    manifest?.kind === "base" &&
    Boolean(manifest.gui?.capabilities.length) &&
    !html.some((file) => file.path === "gui/index.html")
  ) {
    report.error(
      "gui/index.html",
      "manifest 申请 Base GUI capabilities 时必须提供合法的 gui/index.html"
    );
  }
  if (html.length && !html.some((file) => file.path === "gui/index.html")) {
    report.error(
      "gui/index.html",
      "GUI Surface 入口固定为 gui/index.html；其它 HTML 只能由 index.html 内部导航"
    );
  }
  for (const file of html) {
    if (INLINE_SCRIPT.test(await readText(dir, file.path))) {
      report.error(
        file.path,
        "内联 <script> 会被 script-src 'self' 拦截，页面白屏且无可见报错；JS 必须外置"
      );
    }
  }
}

async function readText(dir: string, path: string) {
  return readFile(join(dir, path), "utf8");
}

async function readJson(dir: string, path: string): Promise<unknown> {
  return JSON.parse(await readText(dir, path));
}

class Report {
  private readonly errors: AppFinding[] = [];
  private readonly warnings: AppFinding[] = [];

  error(file: string, reason: string) {
    if (this.errors.length < FINDING_LIMIT) this.errors.push({ file, reason });
  }

  warn(file: string, reason: string) {
    if (this.warnings.length < FINDING_LIMIT) {
      this.warnings.push({ file, reason });
    }
  }

  result(): AppValidation {
    return { errors: this.errors, warnings: this.warnings };
  }
}
