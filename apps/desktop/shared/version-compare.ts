/**
 * [INPUT]: dependence when not in operation; Just use the strings
 * [OUTPUT]: Provides isThreeSegmentVersion / compareVersions / isNewerVersion
 * [POS]: The shared version is a single truth source; This is a bit of a bounce window for the main version of the PyPI directory and the renderer version
 */

/* ============================================================
 * 比较必须是全函数：manifest 里可能躺着上游发布的四段版本
 * （0.4.16.1），而排序、快照与「有无更新」都是热路径——在这里抛错
 * 等于让一个已经安装成功的运行时再也打不开面板。
 *
 * 于是「不可比」不是错误而是一个位置：恒小且稳定。它排在目录末尾、
 * 永不冒充更新，也永远不会让两次排序给出不同答案。
 *
 * 这份序从前有三个副本（main 的 PyPI 目录、renderer 的版本弹窗、
 * 各自的正则）。三份实现只要有一份写法不同，同一对版本就会在目录里
 * 排在前面、在弹窗里被判成降级——版本序是事实，不是各处的观点。
 * ============================================================ */

const THREE_SEGMENT = /^\d+\.\d+\.\d+$/;

/** 严格三段（且全为十进制数字）才可比；其余一律视为不可比。 */
export function isThreeSegmentVersion(value: string) {
  return THREE_SEGMENT.test(value);
}

export function compareVersions(left: string, right: string) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) return a ? 1 : b ? -1 : 0;
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index]! - b[index]!;
  }
  return 0;
}

/** 只有两端都可比且候选严格更大才算「有更新」；不可比一律不打扰。 */
export function isNewerVersion(
  candidate: string | null,
  installed: string | null
) {
  if (!candidate || !installed) return false;
  if (!parseVersion(candidate) || !parseVersion(installed)) return false;
  return compareVersions(candidate, installed) > 0;
}

function parseVersion(value: string) {
  if (!isThreeSegmentVersion(value)) return null;
  return value.split(".").map(Number) as [number, number, number];
}
