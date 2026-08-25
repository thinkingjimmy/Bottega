/**
 * [INPUT]: Depends on the exact local exercises-dataset checkout Git HEAD, data/exercises.json, LICENSE, NOTICE.md and 180×180 GIF under videos/; Parameters are checkout, expected commit, output directory
 * [OUTPUT]: Definition generates 72 non-media directories, provenance/license and general `migrations/base.json` The first is the "Mapping" aliasAll business claims prior to staged renaming failed to cover existing products.The zone registry belongs to generate-fitness-bodymap.ts All, this script only consumes ZONES to make a unified and covering claim
 * [POS]: The development period of the scripts is offline supply chain entry; The government is not connected to the internet, it is not following branchesGym visual media distributed independently licensed packages, and the 180×180 test was completed with the signature of the player
 */

import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const SOURCE_REPO = "https://github.com/hasaneyldrm/exercises-dataset";
export const SOURCE_COMMIT = "7455efae41b330c265e7cd4b78dfa848e7ce5ebd";
export const SOURCE_JSON_SHA256 = "656634224b8977b99a6d765470ee123260d4979715eaa4e7c0b7c8bb0d79f93d";
export const GENERATOR_VERSION = 2;

/* Gym visual 媒体不在上游 MIT 覆盖范围内：授权只到 180×180，且每次使用都必须
   带这条署名。两者都在发布前逐个文件校验——违反授权的产物不许存在于磁盘上。 */
export const MEDIA_ATTRIBUTION = "© Gym visual — https://gymvisual.com/";
export const MEDIA_EDGE = 180;
const MEDIA_TOTAL_BUDGET = 12 * 1024 * 1024;

const ZONES = [
  "chest", "upper_back_traps", "lats", "lower_back",
  "anterior_lateral_deltoids", "posterior_deltoids", "biceps", "triceps",
  "forearms", "abs", "obliques", "glutes", "quadriceps", "hamstrings",
  "calves", "adductors_hip_flexors", "neck",
] as const;
type Zone = typeof ZONES[number];

const PICKS = [
  ["0025", "杠铃卧推"], ["0047", "上斜杠铃卧推"], ["0289", "哑铃卧推"],
  ["0314", "上斜哑铃卧推"], ["0258", "时钟俯卧撑"], ["1262", "单臂绳索下斜飞鸟"],
  ["0027", "杠铃俯身划船"], ["3017", "潘德雷划船"], ["0180", "坐姿绳索划船"],
  ["0293", "哑铃俯身划船"], ["2330", "全程高位下拉"], ["3293", "射手引体向上"],
  ["0017", "辅助引体向上"], ["0489", "背部伸展"], ["0091", "杠铃坐姿推举"],
  ["0334", "哑铃侧平举"], ["0405", "哑铃坐姿推举"], ["0178", "绳索侧平举"],
  ["0075", "杠铃后束平举"], ["2292", "哑铃后束平举"], ["0095", "杠铃耸肩"],
  ["0406", "哑铃耸肩"], ["0285", "哑铃交替弯举"], ["0294", "哑铃弯举"],
  ["0313", "哑铃锤式弯举"], ["0416", "哑铃站姿弯举"], ["0241", "绳索三头下压"],
  ["0351", "哑铃仰卧臂屈伸"], ["0430", "哑铃站姿臂屈伸"], ["0283", "钻石俯卧撑"],
  ["0126", "杠铃腕弯举"], ["0082", "杠铃反向腕弯举"], ["0247", "绳索腕弯举"],
  ["0994", "弹力带反向腕弯举"], ["0001", "四分之三仰卧起坐"], ["0002", "四十五度侧屈"],
  ["0003", "空中自行车卷腹"], ["0006", "交替触踝"], ["0014", "药球俄罗斯转体"],
  ["0979", "弹力带帕洛夫推"], ["3544", "上斜侧平板支撑"], ["0507", "折刀仰卧起坐"],
  ["0222", "绳索侧屈"], ["0524", "壶铃侧向推举"], ["0043", "杠铃深蹲"],
  ["1760", "哑铃高脚杯深蹲"], ["0413", "哑铃深蹲"], ["0024", "杠铃前蹲"],
  ["1409", "杠铃臀桥"], ["0032", "杠铃硬拉"], ["0085", "杠铃罗马尼亚硬拉"],
  ["1459", "哑铃罗马尼亚硬拉"], ["0116", "杠铃直腿硬拉"], ["0534", "壶铃高脚杯深蹲"],
  ["0514", "跳深蹲"], ["0597", "器械坐姿髋外展"], ["0710", "侧卧髋外展"],
  ["0168", "绳索髋内收"], ["0598", "器械坐姿髋内收"], ["1775", "侧平板髋内收"],
  ["1373", "自重站姿提踵"], ["1372", "杠铃站姿提踵"], ["1375", "绳索站姿提踵"],
  ["0409", "哑铃单腿提踵"], ["0417", "哑铃站姿提踵"], ["1383", "哈克机提踵"],
  ["1403", "颈部侧向拉伸"], ["0716", "侧推颈部拉伸"], ["1008", "弹力带踏台阶"],
  ["3769", "交叉弓步蹲"], ["0020", "平衡板站立"], ["0471", "倒立俯卧撑"],
] as const;

const NORMALIZATION: Record<string, Zone | "ignored"> = {
  abdominals: "abs", abductors: "adductors_hip_flexors", abs: "abs",
  adductors: "adductors_hip_flexors", "ankle stabilizers": "calves", ankles: "calves",
  back: "upper_back_traps", biceps: "biceps", brachialis: "forearms", calves: "calves",
  "cardiovascular system": "ignored", chest: "chest", core: "abs", deltoids: "anterior_lateral_deltoids",
  delts: "anterior_lateral_deltoids", feet: "calves", forearms: "forearms", glutes: "glutes",
  "grip muscles": "forearms", groin: "adductors_hip_flexors", hamstrings: "hamstrings",
  hands: "forearms", "hip flexors": "adductors_hip_flexors", "inner thighs": "adductors_hip_flexors",
  "latissimus dorsi": "lats", lats: "lats", "levator scapulae": "neck", "lower abs": "abs",
  "lower back": "lower_back", obliques: "obliques", pectorals: "chest", quadriceps: "quadriceps",
  quads: "quadriceps", "rear deltoids": "posterior_deltoids", rhomboids: "upper_back_traps",
  "rotator cuff": "posterior_deltoids", "serratus anterior": "chest", shins: "calves",
  shoulders: "anterior_lateral_deltoids", soleus: "calves", spine: "lower_back",
  sternocleidomastoid: "neck", trapezius: "upper_back_traps", traps: "upper_back_traps",
  triceps: "triceps", "upper back": "upper_back_traps", "upper chest": "chest",
  "wrist extensors": "forearms", "wrist flexors": "forearms", wrists: "forearms",
};

const ZONE_OVERRIDES: Record<string, Zone[]> = {
  "0075": ["posterior_deltoids"],
  "2292": ["posterior_deltoids"],
  "0180": ["upper_back_traps", "posterior_deltoids"],
  "0293": ["upper_back_traps", "posterior_deltoids"],
};

type UpstreamExercise = {
  id: string; name: string; body_part: string; equipment: string;
  instructions: { en?: string; zh?: string }; target: string;
  muscle_group: string; secondary_muscles: string[];
  gif_url: string; attribution: string;
};

export async function generateFitnessCatalog() {
  const [checkoutArg, expectedCommit = SOURCE_COMMIT, outputArg] = process.argv.slice(2);
  if (!checkoutArg || !outputArg) {
    throw new Error("用法: tsx generate-fitness-catalog.ts <checkout> <expected-commit> <output-dir>");
  }
  const checkout = resolve(checkoutArg);
  const output = resolve(outputArg);
  assertCommit(checkout, expectedCommit);
  const raw = await readFile(join(checkout, "data/exercises.json"));
  assertEqual(hash(raw), SOURCE_JSON_SHA256, "原始 exercises.json SHA-256 漂移");
  const source = JSON.parse(raw.toString("utf8")) as UpstreamExercise[];
  assertSourceIdsUnique(source);
  assertSelectionAliases(PICKS);
  assertNormalizationClosed(source);
  const byId = new Map(source.map((exercise) => [exercise.id, exercise]));
  const exercises = PICKS.map(([id, alias]) => project(requireExercise(byId, id), alias));
  assertCatalog(exercises);
  const exercisesBytes = stableJson(exercises);
  const [licenseBytes, noticeBytes] = await Promise.all([
    readFile(join(checkout, "LICENSE")),
    readFile(join(checkout, "NOTICE.md")),
  ]);
  const mediaRoot = resolve(output, "..", "media");
  const media = await loadMedia(checkout, byId);
  const sourceBytes = stableJson({
    sourceRepo: SOURCE_REPO,
    sourceCommit: expectedCommit,
    sourceJsonSha256: SOURCE_JSON_SHA256,
    generatorVersion: GENERATOR_VERSION,
    generatedExercisesSha256: hash(exercisesBytes),
    mediaIncluded: true,
    mediaLicense: "gym-visual.NOTICE.md",
    mediaAttribution: MEDIA_ATTRIBUTION,
    mediaResolution: `${MEDIA_EDGE}x${MEDIA_EDGE}`,
    mediaCount: media.length,
    mediaBytes: media.reduce((sum, item) => sum + item.bytes.byteLength, 0),
    mediaSha256: hash(Buffer.concat(media.map((item) => Buffer.from(item.bytes)))),
  });
  const migrationRoot = resolve(output, "..", "..", "migrations");
  /* alias 唯一性是最后一项业务断言：必须在碰磁盘前完成，否则失败会留下
     新 catalog + 旧 migration 的撕裂包。 */
  const aliases = migrationAliases(exercises);
  const migrationBytes = stableJson({
    version: 1,
    migrations: [
      {
        id: "fitness-log-v2",
        addColumns: [
          { id: "exercise_id", name: "Exercise ID", type: "text" },
          {
            id: "status",
            name: "Status",
            type: "select",
            options: [
              { id: "planned", label: "Planned" },
              { id: "completed", label: "Completed" },
              { id: "unknown", label: "Unknown" },
            ],
          },
        ],
        defaultValues: { status: "unknown" },
        aliases: [
          {
            sourceColumnId: "exercise",
            targetColumnId: "exercise_id",
            aliases,
          },
        ],
      },
    ],
  });
  const artifacts = [
    { path: join(output, "exercises.json"), bytes: exercisesBytes },
    { path: join(output, "exercises-dataset.LICENSE.txt"), bytes: licenseBytes },
    { path: join(output, "gym-visual.NOTICE.md"), bytes: noticeBytes },
    { path: join(output, "source.json"), bytes: sourceBytes },
    { path: join(migrationRoot, "base.json"), bytes: migrationBytes },
    ...media.map((item) => ({ path: join(mediaRoot, item.name), bytes: item.bytes })),
  ];
  for (const artifact of artifacts) {
    assertBudget(basename(artifact.path), artifact.bytes);
  }
  await publishArtifacts(artifacts);
  process.stdout.write(
    `${basename(output)}: 72 exercises; ${media.length} GIF ` +
      `(${Math.round(media.reduce((sum, item) => sum + item.bytes.byteLength, 0) / 1024)}KB); ${coverage(exercises)}\n`
  );
}

/* ---------------------------------------------------------------------- media
   Gym visual 授权是「180×180 + 必须署名」。两条都在这里逐个文件验，任何一条
   不满足就整批不发布——磁盘上不允许出现一个越权的字节。 */
async function loadMedia(checkout: string, byId: Map<string, UpstreamExercise>) {
  const media = await Promise.all(
    PICKS.map(async ([id]) => {
      const source = requireExercise(byId, id).gif_url;
      if (!/^videos\/[\w-]+\.gif$/.test(source)) throw new Error(`${id} 的 gif_url 不是 videos/ 下的 GIF: ${source}`);
      const bytes = await readFile(join(checkout, source));
      assertGifShape(id, bytes);
      return { name: `${id}.gif`, bytes };
    })
  );
  const total = media.reduce((sum, item) => sum + item.bytes.byteLength, 0);
  if (total >= MEDIA_TOTAL_BUDGET) throw new Error(`媒体总量 ${total} 超过 ${MEDIA_TOTAL_BUDGET}`);
  return media;
}

/* GIF 逻辑屏尺寸就在头部第 7-10 字节，小端 u16 两个——读它比信任上游便宜得多。 */
export function assertGifShape(id: string, bytes: Uint8Array) {
  const header = Buffer.from(bytes.buffer, bytes.byteOffset, Math.min(bytes.byteLength, 10));
  if (header.byteLength < 10 || header.subarray(0, 3).toString("latin1") !== "GIF") {
    throw new Error(`${id} 不是 GIF`);
  }
  const width = header.readUInt16LE(6);
  const height = header.readUInt16LE(8);
  if (width !== MEDIA_EDGE || height !== MEDIA_EDGE) {
    throw new Error(`${id} 分辨率 ${width}x${height} 超出 Gym visual 授权的 ${MEDIA_EDGE}x${MEDIA_EDGE}`);
  }
}

export function assertAttribution(exercise: { id: string; attribution?: string }) {
  if (exercise.attribution?.trim() !== MEDIA_ATTRIBUTION) {
    throw new Error(`${exercise.id} 的 Gym visual 署名缺失或被改写: ${String(exercise.attribution)}`);
  }
  return MEDIA_ATTRIBUTION;
}

function project(exercise: UpstreamExercise, alias: string) {
  const zoneWeights = new Map<Zone, number>();
  addMuscle(zoneWeights, exercise.target, 1);
  addMuscle(zoneWeights, exercise.muscle_group, 0.65);
  exercise.secondary_muscles.forEach((muscle) => addMuscle(zoneWeights, muscle, 0.35));
  ZONE_OVERRIDES[exercise.id]?.forEach((zone) => addWeight(zoneWeights, zone, 0.65));
  const instructions = exercise.instructions ?? {};
  if (!instructions.en?.trim() || !instructions.zh?.trim()) {
    throw new Error(`${exercise.id} 缺少中英文说明`);
  }
  return {
    id: exercise.id,
    name: exercise.name,
    aliases: [alias],
    instructions: { en: instructions.en.trim(), zh: instructions.zh.trim() },
    body_part: exercise.body_part,
    equipment: exercise.equipment,
    target: exercise.target,
    muscle_group: exercise.muscle_group,
    secondary_muscles: [...exercise.secondary_muscles],
    media: { gif: `${exercise.id}.gif`, attribution: assertAttribution(exercise) },
    canonical_zones: [...zoneWeights.keys()].sort(),
    zone_weights: Object.fromEntries([...zoneWeights.entries()].sort(([left], [right]) => left.localeCompare(right))),
  };
}

function addMuscle(weights: Map<Zone, number>, muscle: string, weight: number) {
  const zone = NORMALIZATION[muscle];
  if (zone && zone !== "ignored") addWeight(weights, zone, weight);
}

function addWeight(weights: Map<Zone, number>, zone: Zone, weight: number) {
  weights.set(zone, Math.max(weights.get(zone) ?? 0, weight));
}

function assertCatalog(exercises: ReturnType<typeof project>[]) {
  assertEqual(exercises.length, 72, "精选目录必须恰好 72 项");
  assertEqual(new Set(exercises.map((item) => item.id)).size, 72, "精选目录 id 重复");
  const counts = new Map(ZONES.map((zone) => [zone, 0]));
  exercises.forEach((item) => item.canonical_zones.forEach((zone) => counts.set(zone, counts.get(zone)! + 1)));
  for (const zone of ZONES) {
    const minimum = zone === "neck" ? 1 : 2;
    if (counts.get(zone)! < minimum) throw new Error(`${zone} 覆盖不足 ${minimum}`);
  }
  const equipment = new Set(exercises.map((item) => item.equipment));
  ["body weight", "dumbbell", "barbell", "cable", "leverage machine"].forEach((value) => {
    if (!equipment.has(value)) throw new Error(`器械覆盖缺少 ${value}`);
  });
}

function assertNormalizationClosed(exercises: UpstreamExercise[]) {
  const names = new Set(exercises.flatMap((item) => [item.target, item.muscle_group, ...item.secondary_muscles]));
  const unknown = [...names].filter((name) => !(name in NORMALIZATION)).sort();
  if (unknown.length) throw new Error(`muscle normalization 未闭合: ${unknown.join(", ")}`);
}

export function assertSourceIdsUnique(exercises: readonly { id: string }[]) {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const exercise of exercises) {
    if (seen.has(exercise.id)) duplicates.add(exercise.id);
    seen.add(exercise.id);
  }
  if (duplicates.size) {
    throw new Error(`上游 source id 重复: ${[...duplicates].sort().join(", ")}`);
  }
}

export function assertSelectionAliases(
  picks: readonly (readonly [id: string, alias: string])[]
) {
  for (const [id, alias] of picks) {
    if (!alias.trim()) throw new Error(`allowlist ${id} alias 不能为空`);
    if (/\p{Cc}/u.test(alias)) {
      throw new Error(`allowlist ${id} alias 含控制字符`);
    }
  }
}

function requireExercise(byId: Map<string, UpstreamExercise>, id: string) {
  const exercise = byId.get(id);
  if (!exercise) throw new Error(`上游缺少 allowlist id ${id}`);
  return exercise;
}

function assertCommit(checkout: string, expected: string) {
  if (!/^[a-f0-9]{40}$/.test(expected)) throw new Error("expected commit 必须是 40 位 SHA");
  const actual = execFileSync("git", ["-C", checkout, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  assertEqual(actual, expected, "upstream checkout HEAD 不匹配");
}

function stableJson(value: unknown) { return Buffer.from(`${JSON.stringify(value, null, 2)}\n`); }
function hash(value: Uint8Array) { return createHash("sha256").update(value).digest("hex"); }
function assertBudget(name: string, value: Uint8Array) {
  if (value.byteLength >= 512 * 1024) throw new Error(`${name} 超过 512KB`);
}

async function publishArtifacts(
  artifacts: readonly { path: string; bytes: Uint8Array }[]
) {
  const nonce = `${process.pid}-${randomUUID()}`;
  const staged = artifacts.map((artifact) => ({
    ...artifact,
    stagingPath: `${artifact.path}.${nonce}.tmp`,
  }));
  try {
    for (const artifact of staged) {
      await mkdir(dirname(artifact.path), { recursive: true });
      await writeFile(artifact.stagingPath, artifact.bytes);
    }
    for (const artifact of staged) {
      await rename(artifact.stagingPath, artifact.path);
    }
  } finally {
    await Promise.all(
      staged.map((artifact) => rm(artifact.stagingPath, { force: true }))
    );
  }
}

function assertEqual(actual: unknown, expected: unknown, message: string): asserts actual {
  if (actual !== expected) throw new Error(`${message}: ${String(actual)} != ${String(expected)}`);
}
function coverage(exercises: ReturnType<typeof project>[]) {
  return ZONES.map((zone) => `${zone}=${exercises.filter((item) => item.canonical_zones.includes(zone)).length}`).join(" ");
}

function migrationAliases(exercises: ReturnType<typeof project>[]) {
  const aliases = new Map<string, string>();
  for (const exercise of exercises) {
    for (const value of [exercise.name, ...exercise.aliases]) {
      const key = value.trim().toLocaleLowerCase("en-US");
      const previous = aliases.get(key);
      if (previous && previous !== exercise.id) {
        throw new Error(`迁移 alias 不唯一：${key} → ${previous}/${exercise.id}`);
      }
      aliases.set(key, exercise.id);
    }
  }
  return Object.fromEntries([...aliases].sort(([left], [right]) => left.localeCompare(right)));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  void generateFitnessCatalog().catch((cause) => {
    process.stderr.write(`${cause instanceof Error ? cause.message : String(cause)}\n`);
    process.exitCode = 1;
  });
}
