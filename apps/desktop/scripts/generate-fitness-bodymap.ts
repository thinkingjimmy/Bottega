/**
 * [INPUT]: Depends on the exact local react-native-body-highlighter checkout Git HEAD, assets/body{, Female}{Front, Back}.ts, components/Svg{Male, Female}Wrapper.tsx and LICENSE; and read the same directory exercises.json reverse-call zone closed
 * [OUTPUT]: Definition generates two sets of anatomical levels on the back of the body-map.json geometry, five languages muscle-regions.json, upstream MIT full text and provenance; All claims before staged renaming failed to cover existing products
 * [POS]: The second entry in the offline supply chain for the development of scripts; Only move the vector path, disconnect, or copy upstream scans or React when running
 */

import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const SOURCE_REPO = "https://github.com/HichamELBSI/react-native-body-highlighter";
export const SOURCE_COMMIT = "15df9e2dbc621450001960bed5a30e6a75357faa";
export const GENERATOR_VERSION = 2;

export const LOCALES = ["zh-CN", "en", "ja", "fr", "es"] as const;
type Locale = typeof LOCALES[number];

/* 17 个 canonical zone 的五语言标签。id 集合不在这里定义——它由 exercises.json
   的 canonical_zones 并集反推，两边不一致就当场炸，杜绝图与数据分叉。 */
const ZONE_LABELS: Record<string, Record<Locale, string>> = {
  chest: { "zh-CN": "胸部", en: "Chest", ja: "胸", fr: "Pectoraux", es: "Pecho" },
  upper_back_traps: { "zh-CN": "斜方肌与上背", en: "Traps & upper back", ja: "僧帽筋・上背部", fr: "Trapèzes et haut du dos", es: "Trapecios y espalda alta" },
  lats: { "zh-CN": "背阔肌", en: "Lats", ja: "広背筋", fr: "Grand dorsal", es: "Dorsal ancho" },
  lower_back: { "zh-CN": "下背", en: "Lower back", ja: "腰部", fr: "Bas du dos", es: "Zona lumbar" },
  anterior_lateral_deltoids: { "zh-CN": "三角肌前束与中束", en: "Front & side delts", ja: "三角筋前部・中部", fr: "Deltoïdes antérieurs et latéraux", es: "Deltoides anterior y lateral" },
  posterior_deltoids: { "zh-CN": "三角肌后束", en: "Rear delts", ja: "三角筋後部", fr: "Deltoïdes postérieurs", es: "Deltoides posterior" },
  biceps: { "zh-CN": "肱二头肌", en: "Biceps", ja: "上腕二頭筋", fr: "Biceps", es: "Bíceps" },
  triceps: { "zh-CN": "肱三头肌", en: "Triceps", ja: "上腕三頭筋", fr: "Triceps", es: "Tríceps" },
  forearms: { "zh-CN": "前臂", en: "Forearms", ja: "前腕", fr: "Avant-bras", es: "Antebrazos" },
  abs: { "zh-CN": "腹直肌", en: "Abs", ja: "腹直筋", fr: "Abdominaux", es: "Abdominales" },
  obliques: { "zh-CN": "腹斜肌", en: "Obliques", ja: "腹斜筋", fr: "Obliques", es: "Oblicuos" },
  glutes: { "zh-CN": "臀肌", en: "Glutes", ja: "臀筋", fr: "Fessiers", es: "Glúteos" },
  quadriceps: { "zh-CN": "股四头肌", en: "Quadriceps", ja: "大腿四頭筋", fr: "Quadriceps", es: "Cuádriceps" },
  hamstrings: { "zh-CN": "腘绳肌", en: "Hamstrings", ja: "ハムストリング", fr: "Ischio-jambiers", es: "Isquiotibiales" },
  calves: { "zh-CN": "小腿", en: "Calves", ja: "ふくらはぎ", fr: "Mollets", es: "Pantorrillas" },
  adductors_hip_flexors: { "zh-CN": "内收肌与髋屈肌", en: "Adductors & hip flexors", ja: "内転筋・腸腰筋", fr: "Adducteurs et fléchisseurs de hanche", es: "Aductores y flexores de cadera" },
  neck: { "zh-CN": "颈部", en: "Neck", ja: "首", fr: "Cou", es: "Cuello" },
};

/* 上游 slug → canonical zone。"figure" 是纯装饰件：头发、手、足、膝、踝
   只参与人形轮廓，永不接收热度也永不可聚焦。女性资产的 slug 是男性的子集
   （背面没有 ankles/head），少画不炸、多画才炸。 */
const FRONT_SLUGS: Record<string, string> = {
  chest: "chest", obliques: "obliques", abs: "abs", biceps: "biceps", triceps: "triceps",
  neck: "neck", trapezius: "upper_back_traps", deltoids: "anterior_lateral_deltoids",
  adductors: "adductors_hip_flexors", quadriceps: "quadriceps", calves: "calves",
  tibialis: "calves", forearm: "forearms",
  knees: "figure", hands: "figure", ankles: "figure", feet: "figure", head: "figure", hair: "figure",
};

const BACK_SLUGS: Record<string, string> = {
  neck: "neck", trapezius: "upper_back_traps", deltoids: "posterior_deltoids",
  "upper-back": "upper_back_traps", triceps: "triceps", "lower-back": "lower_back",
  forearm: "forearms", gluteal: "glutes", adductors: "adductors_hip_flexors",
  hamstring: "hamstrings", calves: "calves",
  ankles: "figure", feet: "figure", hands: "figure", head: "figure", hair: "figure",
};

/* 上游没有独立的 lats slug——背阔肌那对大翅膀藏在 upper-back 的子路径里，
   同侧其余是菱形肌/大圆肌，且男女的切法不同（男 3 片、女 2 片）。索引在
   SOURCE_COMMIT 上人工核对过，assertLatsSplit 再用几何特征复核。 */
export const GENDERS = {
  male: {
    front: "bodyFront.ts", back: "bodyBack.ts", wrapper: "SvgMaleWrapper.tsx",
    lats: { left: 1, right: 2 }, latsSubpaths: 3,
  },
  female: {
    front: "bodyFemaleFront.ts", back: "bodyFemaleBack.ts", wrapper: "SvgFemaleWrapper.tsx",
    lats: { left: 1, right: 1 }, latsSubpaths: 2,
  },
} as const;
type Gender = keyof typeof GENDERS;
type LatsConfig = { lats: Record<string, number>; latsSubpaths: number };

type SidePaths = { side: string; paths: string[] };
type Part = { slug: string; sides: SidePaths[] };
type View = { outline: string; figure: string[]; zones: { id: string; paths: string[] }[] };

export function parseBodyAssets(source: string): Part[] {
  const heads = [...source.matchAll(/slug:\s*"([^"]+)"/g)];
  if (!heads.length) throw new Error("上游 asset 未找到任何 slug");
  return heads.map((head, index) => {
    const start = head.index!;
    const end = index + 1 < heads.length ? heads[index + 1].index! : source.length;
    return { slug: head[1], sides: parseSides(source.slice(start, end), head[1]) };
  });
}

function parseSides(chunk: string, slug: string): SidePaths[] {
  const sides = [...chunk.matchAll(/\b(left|right|common):\s*\[([^\]]*)\]/g)].map((match) => ({
    side: match[1],
    paths: [...match[2].matchAll(/"([^"]+)"/g)].map((entry) => entry[1]),
  }));
  if (!sides.length) throw new Error(`slug ${slug} 未解析出任何 side`);
  for (const side of sides) {
    if (!side.paths.length) throw new Error(`slug ${slug} 的 ${side.side} 为空数组`);
    for (const path of side.paths) assertPathData(`${slug}/${side.side}`, path);
  }
  return sides;
}

export function parseOutlines(wrapper: string): string[] {
  const outlines = [...wrapper.matchAll(/\sd="([Mm][^"]+)"/g)].map((match) => match[1]);
  if (outlines.length !== 2) throw new Error(`人形轮廓应为正背面各一条，实得 ${outlines.length}`);
  outlines.forEach((path, index) => assertPathData(`outline[${index}]`, path));
  return outlines;
}

export function parseViewBoxes(wrapper: string): { front: string; back: string } {
  const declaration = wrapper.match(
    /viewBox\s*=[^;\n]*?"([-\d. ]+)"\s*:\s*"([-\d. ]+)"/
  );
  if (!declaration) throw new Error("wrapper 未声明正背面 viewBox 三元");
  return unifyViewBoxes(declaration[1], declaration[2]);
}

/* 女性资产正背面的取景框大小不同（734×1538 / 774×1448），直接用会让两张图
   的人体不同比例并排。取并集尺寸再各自居中，两面就回到同一个尺度。 */
export function unifyViewBoxes(front: string, back: string) {
  const read = (box: string) => box.trim().split(/\s+/).map(Number);
  const [frontX, frontY, frontW, frontH] = read(front);
  const [backX, backY, backW, backH] = read(back);
  const width = Math.max(frontW, backW);
  const height = Math.max(frontH, backH);
  const centre = (x: number, y: number, w: number, h: number) =>
    [round(x - (width - w) / 2), round(y - (height - h) / 2), width, height].join(" ");
  return { front: centre(frontX, frontY, frontW, frontH), back: centre(backX, backY, backW, backH) };
}

function round(value: number) { return Math.round(value * 100) / 100; }

function assertPathData(name: string, path: string) {
  if (!/^[Mm][\s\d.-]/.test(path)) throw new Error(`${name} 不是以 moveto 起头的路径`);
  if (/[<>]/.test(path)) throw new Error(`${name} 含标记字符`);
}

function buildView(parts: Part[], slugs: Record<string, string>, outline: string, view: string, lats: Record<string, number>): View {
  const figure: string[] = [];
  const zones = new Map<string, string[]>();
  const unknown = parts.map((part) => part.slug).filter((slug) => !(slug in slugs));
  if (unknown.length) throw new Error(`${view} slug 映射未闭合: ${unknown.sort().join(", ")}`);
  for (const part of parts) {
    const zone = slugs[part.slug];
    for (const side of part.sides) {
      side.paths.forEach((path, index) => {
        const target = part.slug === "upper-back" && lats[side.side] === index ? "lats" : zone;
        if (target === "figure") figure.push(path);
        else zones.set(target, [...(zones.get(target) ?? []), path]);
      });
    }
  }
  if (!figure.length) throw new Error(`${view} 缺少装饰件`);
  return { outline, figure, zones: [...zones].map(([id, paths]) => ({ id, paths })) };
}

/* 背阔肌是背面最长的一块肌肉：竖向跨度必须压过同一 upper-back 的其余子路径。
   只认索引会在上游重排数组时静默指向菱形肌，几何复核才是真的守门人。 */
export function assertLatsSplit(parts: Part[], config: LatsConfig) {
  const upperBack = parts.find((part) => part.slug === "upper-back");
  if (!upperBack) throw new Error("背面缺少 upper-back");
  for (const side of upperBack.sides) {
    const index = config.lats[side.side];
    if (index === undefined) throw new Error(`upper-back 出现未知 side ${side.side}`);
    if (side.paths.length !== config.latsSubpaths) {
      throw new Error(`upper-back/${side.side} 子路径应为 ${config.latsSubpaths} 条，实得 ${side.paths.length}`);
    }
    const spans = side.paths.map(verticalSpan);
    const widest = spans.indexOf(Math.max(...spans));
    if (widest !== index) throw new Error(`upper-back/${side.side} 最长子路径是 ${widest}，与钉死的背阔肌索引 ${index} 不符`);
  }
}

/* 只取 moveto/lineto/曲线终点即可判断跨度，无需完整 path 求解。 */
function verticalSpan(path: string) {
  const values = (path.match(/-?\d*\.?\d+/g) ?? []).map(Number).filter(Number.isFinite);
  if (values.length < 4) throw new Error("路径坐标过少");
  const ys = values.filter((_, index) => index % 2 === 1);
  return Math.max(...ys) - Math.min(...ys);
}

export function assertZoneClosure(views: View[], catalogZones: readonly string[]) {
  const drawn = new Set(views.flatMap((view) => view.zones.map((zone) => zone.id)));
  const labelled = new Set(Object.keys(ZONE_LABELS));
  const catalog = new Set(catalogZones);
  for (const [name, left, right] of [
    ["图形/标签", drawn, labelled],
    ["图形/目录", drawn, catalog],
  ] as const) {
    const missing = [...right].filter((id) => !left.has(id)).sort();
    const extra = [...left].filter((id) => !right.has(id)).sort();
    if (missing.length || extra.length) {
      throw new Error(`${name} zone 不闭合: 缺 ${missing.join(",") || "无"} / 多 ${extra.join(",") || "无"}`);
    }
  }
}

export function assertLabelsComplete() {
  for (const [id, labels] of Object.entries(ZONE_LABELS)) {
    const missing = LOCALES.filter((locale) => !labels[locale]?.trim());
    if (missing.length) throw new Error(`zone ${id} 缺少 ${missing.join(",")} 标签`);
  }
}

export async function generateFitnessBodymap() {
  const [checkoutArg, expectedCommit = SOURCE_COMMIT, outputArg] = process.argv.slice(2);
  if (!checkoutArg || !outputArg) {
    throw new Error("用法: tsx generate-fitness-bodymap.ts <checkout> <expected-commit> <output-dir>");
  }
  const checkout = resolve(checkoutArg);
  const output = resolve(outputArg);
  assertCommit(checkout, expectedCommit);
  assertLabelsComplete();
  const [license, catalog] = await Promise.all([
    readFile(join(checkout, "LICENSE")),
    readFile(join(output, "exercises.json"), "utf8"),
  ]);
  const catalogZones = [
    ...new Set((JSON.parse(catalog) as { canonical_zones: string[] }[]).flatMap((item) => item.canonical_zones)),
  ];

  const genders: Record<string, unknown> = {};
  const fingerprints: string[] = [];
  for (const gender of Object.keys(GENDERS) as Gender[]) {
    const config = GENDERS[gender];
    const [frontSource, backSource, wrapper] = await Promise.all([
      readFile(join(checkout, "assets", config.front), "utf8"),
      readFile(join(checkout, "assets", config.back), "utf8"),
      readFile(join(checkout, "components", config.wrapper), "utf8"),
    ]);
    fingerprints.push(frontSource, backSource, wrapper);
    const backParts = parseBodyAssets(backSource);
    assertLatsSplit(backParts, config);
    const [frontOutline, backOutline] = parseOutlines(wrapper);
    const front = buildView(parseBodyAssets(frontSource), FRONT_SLUGS, frontOutline, `${gender}/front`, config.lats);
    const back = buildView(backParts, BACK_SLUGS, backOutline, `${gender}/back`, config.lats);
    assertZoneClosure([front, back], catalogZones);
    genders[gender] = { viewBox: parseViewBoxes(wrapper), views: { front, back } };
  }

  const mapBytes = stableJson({ genders });
  const regionsBytes = stableJson(
    Object.entries(ZONE_LABELS).map(([id, labels]) => ({ id, labels }))
  );
  const sourceBytes = stableJson({
    sourceRepo: SOURCE_REPO,
    sourceCommit: expectedCommit,
    sourceAssetsSha256: hash(Buffer.from(fingerprints.join(""))),
    generatorVersion: GENERATOR_VERSION,
    generatedBodyMapSha256: hash(mapBytes),
    genders: Object.keys(GENDERS),
    locales: [...LOCALES],
    mediaIncluded: false,
    runtimeIncluded: false,
  });
  const artifacts = [
    { path: join(output, "body-map.json"), bytes: mapBytes },
    { path: join(output, "muscle-regions.json"), bytes: regionsBytes },
    { path: join(output, "body-highlighter.LICENSE.txt"), bytes: license },
    { path: join(output, "body-map.source.json"), bytes: sourceBytes },
  ];
  for (const artifact of artifacts) assertBudget(basename(artifact.path), artifact.bytes);
  await publishArtifacts(artifacts);
  process.stdout.write(
    `body-map: ${Object.keys(GENDERS).join("/")} × front/back, ${Object.keys(ZONE_LABELS).length} zones, ` +
      `${LOCALES.length} locales, ${Math.round(mapBytes.byteLength / 1024)}KB\n`
  );
}

function assertCommit(checkout: string, expected: string) {
  if (!/^[a-f0-9]{40}$/.test(expected)) throw new Error("expected commit 必须是 40 位 SHA");
  const actual = execFileSync("git", ["-C", checkout, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  if (actual !== expected) throw new Error(`upstream checkout HEAD 不匹配: ${actual} != ${expected}`);
}

function stableJson(value: unknown) { return Buffer.from(`${JSON.stringify(value, null, 2)}\n`); }
function hash(value: Uint8Array) { return createHash("sha256").update(value).digest("hex"); }
function assertBudget(name: string, value: Uint8Array) {
  if (value.byteLength >= 512 * 1024) throw new Error(`${name} 超过 512KB`);
}

async function publishArtifacts(artifacts: readonly { path: string; bytes: Uint8Array }[]) {
  const nonce = `${process.pid}-${randomUUID()}`;
  const staged = artifacts.map((artifact) => ({ ...artifact, stagingPath: `${artifact.path}.${nonce}.tmp` }));
  try {
    for (const artifact of staged) {
      await mkdir(dirname(artifact.path), { recursive: true });
      await writeFile(artifact.stagingPath, artifact.bytes);
    }
    for (const artifact of staged) await rename(artifact.stagingPath, artifact.path);
  } finally {
    await Promise.all(staged.map((artifact) => rm(artifact.stagingPath, { force: true })));
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  void generateFitnessBodymap().catch((cause) => {
    process.stderr.write(`${cause instanceof Error ? cause.message : String(cause)}\n`);
    process.exitCode = 1;
  });
}
