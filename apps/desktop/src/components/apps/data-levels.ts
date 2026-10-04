/**
 * [INPUT]: Depends only on the shared data-level enum wording in the Apps authorization catalog
 * [OUTPUT]: Provides AppDataLevel, APP_DATA_LEVELS, and the label/detail/outcome catalog-key maps for the three levels
 * [POS]: The one wording source for none/read/row-write, read by the authorization dialog, the App grants panel, and the Project App summary
 */

/* ============================================================
 * 一个枚举只该有一套说法
 *
 * 这三档从前在产品里有三份映射：授权弹窗一份、App 授权面把选项就地拼成
 * 三个 SelectItem、Project 摘要又抄了第三份。三份指向的目录键其实相同，
 * 但没有一处说了算——于是任何一次措辞调整都要靠人记得改满三遍，而漏掉
 * 一遍的症状是「同一个权限在三个界面上是三个名字」。
 *
 * 档位的措辞与后果句成对存在：枚举名不回答「按下去会发生什么」，而授权屏
 * 正是用户唯一需要做安全判断的地方。
 * ============================================================ */
export type AppDataLevel = "none" | "read" | "row-write";

export const APP_DATA_LEVELS = ["none", "read", "row-write"] as const;

export const APP_DATA_LEVEL_KEYS = {
  none: "apps.authorization.dataNone",
  read: "apps.authorization.dataRead",
  "row-write": "apps.authorization.dataWrite",
} as const satisfies Record<AppDataLevel, string>;

export const APP_DATA_LEVEL_DETAIL_KEYS = {
  none: "apps.authorization.dataNoneDetail",
  read: "apps.authorization.dataReadDetail",
  "row-write": "apps.authorization.dataWriteDetail",
} as const satisfies Record<AppDataLevel, string>;

export const APP_DATA_LEVEL_OUTCOME_KEYS = {
  none: "apps.authorization.outcomeNone",
  read: "apps.authorization.outcomeRead",
  "row-write": "apps.authorization.outcomeWrite",
} as const satisfies Record<AppDataLevel, string>;
