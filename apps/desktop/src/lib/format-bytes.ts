/**
 * [INPUT]: Dependence when not running
 * [OUTPUT]: Provides formatBytes in the binary unit B/KiB/MiB/GiB
 * [POS]: The volume of the renderer lib is the single source of truth; The Import volume of Skills and the instruction file volume of Personalization read the same measurement
 */

/* ============================================================
 * 单位符号是国际写法，不进语言目录——「KiB」在五种语言里都是 KiB。
 * 1 MiB 以下给整数，之上给一位小数：82 KiB 与 13.0 MiB 都要一眼可比。
 *
 * 它此前私藏在 settings/skills/skill-text.ts 里。同一个应用里两处
 * 报体积却各写一份换算，迟早一处用 1000 一处用 1024——那种偏差不会
 * 报错，只会让两页上的同一个文件显示成两个大小。
 * ============================================================ */
export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KiB", "MiB", "GiB"] as const;
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 100 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}
