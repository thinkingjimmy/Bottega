/**
 * [INPUT]: Depends on node: fs realpathSync with node: path
 * [OUTPUT]: Provides SBPL original language`sandbox-exec` Routes, system root read/read files/mach service list, string conversion, canonical/requested routes, standardization, weighting, containment and ancestors
 * [POS]: The unbiased underlying of backends/sandbox; The seatbelt (Agent turn) and projects/Git-runner (Git mutation) both have the same path and metaphor, avoiding writing one on either side
 */

import { realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

export const SANDBOX_EXEC = "/usr/bin/sandbox-exec";

export const SYSTEM_READ_ROOTS = [
  "/Applications",
  "/Library",
  "/System",
  "/bin",
  "/opt",
  "/private/etc",
  "/private/var/db",
  "/private/var/run",
  // macOS 把 /bin/sh 实现指向 /private/var/select/sh；缺它则任何 shell 包装脚本无法启动。
  "/private/var/select",
  "/sbin",
  "/usr",
] as const;

export const SYSTEM_READ_FILES = [
  "/dev/null",
  "/dev/random",
  "/dev/urandom",
  "/dev/zero",
] as const;

/**
 * deny default 会连同 mach 服务查找一起拒绝，而 TLS 证书链校验要与 trustd 通信，
 * 名字解析要与 opendirectoryd/dnssd 通信——缺它们的表征是 UnknownIssuer 与 ENOTFOUND，
 * 而非权限报错。这里只放行具名服务，它们自身不提供网络出口，出网仍由 network* 单独把关。
 *
 * FSEvents 同理且更隐蔽：macOS 上 `fs.watch` 全部经 fseventsd，缺这个服务时
 * libuv 起不了后端，errno 被映射成 **EMFILE**——一句与事实无关的「打开文件过多」
 * （2026-08-07 Kimi 0.34.0 现场：围栏外 34 个 fd 绰绰有余，围栏内必崩）。
 * 更要命的是这个错误异步打在裸 FSWatcher 上，CLI 若没挂 error listener 就是
 * 未捕获 'error' → 整个进程自杀。
 *
 * 放行它**不放宽任何读权限**：mach-lookup 只是让「已获准读的目录」可被监视，
 * file-read* 的 deny 一行未动——所以 CLI 去 watch 主目录照样 EPERM，
 * 那正是围栏该说的「不」。
 */
export const SYSTEM_MACH_SERVICES = [
  "com.apple.trustd",
  "com.apple.trustd.agent",
  "com.apple.SecurityServer",
  "com.apple.system.opendirectoryd.libinfo",
  "com.apple.dnssd.service",
  "com.apple.system.notification_center",
  "com.apple.FSEvents",
] as const;

export function sbplString(value: string) {
  return `"${value
    .replaceAll("\\", "\\\\")
    .replaceAll("\"", "\\\"")
    .replaceAll("\n", "\\n")
    .replaceAll("\r", "\\r")}"`;
}

export function requestedAbsolutePath(path: string, label: string) {
  if (!isAbsolute(path)) throw new Error(`${label} 必须是绝对路径`);
  return resolve(path);
}

/**
 * 规范化到「最近的真实祖先 + 尚不存在的后缀」。内核按 canonical 路径判权限，
 * 而围栏经常要先放行一个还没被创建出来的目录（worktree parent、scratch）——
 * 直接 realpath 会抛，直接 resolve 又会把 symlink 留在里面。
 */
export function canonicalPath(path: string, label: string) {
  const requested = requestedAbsolutePath(path, label);
  const suffix: string[] = [];
  let current = requested;
  while (true) {
    try {
      return join(realpathSync(current), ...suffix);
    } catch {
      const parent = dirname(current);
      if (parent === current) return requested;
      suffix.unshift(basename(current));
      current = parent;
    }
  }
}

export function uniquePaths(paths: Array<string | undefined>, label: string) {
  return [
    ...new Set(
      paths
        .filter((path): path is string => Boolean(path))
        .map((path) => canonicalPath(path, label))
    ),
  ];
}

export function uniqueRequestedPaths(
  paths: Array<string | undefined>,
  label: string
) {
  return [
    ...new Set(
      paths
        .filter((path): path is string => Boolean(path))
        .map((path) => requestedAbsolutePath(path, label))
    ),
  ];
}

export function within(path: string, root: string) {
  return path === root || path.startsWith(`${root}/`);
}

export const overlaps = (left: string, right: string) =>
  within(left, right) || within(right, left);

/**
 * 写规则按**具体性**升序发射，而不是「先 allow 再 deny」。
 *
 * SBPL 末条匹配者胜，于是唯一正确的排序是「越具体越靠后」。两个方向的嵌套都
 * 真实存在：更窄的写入例外可能嵌在只读面中，而更窄的 deny 也可能嵌在写入面中。
 * 固定「deny 在后」会让前者一行都写不进去，固定
 * 「allow 在后」又会让后者的保护失效——一条排序同时解决两个方向。
 * 同长度时 deny 胜：两条规则指向同一路径，保守解释才是安全的解释。
 */
export function writeRules(
  writeRoots: readonly string[],
  denyRoots: readonly string[]
) {
  return [
    ...writeRoots.map((path) => ({ path, allow: true })),
    ...denyRoots.map((path) => ({ path, allow: false })),
  ]
    .sort((left, right) =>
      left.path.length !== right.path.length
        ? left.path.length - right.path.length
        : Number(right.allow) - Number(left.allow)
    )
    .map(
      (rule) =>
        `(${rule.allow ? "allow" : "deny"} file-write* (subpath ${sbplString(rule.path)}))`
    );
}

/** deny default 连 metadata lookup 一起拒；不逐级放行祖先，任何深路径都打不开。 */
export function pathAncestors(path: string) {
  const ancestors: string[] = [];
  let current = resolve(path);
  while (true) {
    ancestors.push(current);
    const parent = dirname(current);
    if (parent === current) return ancestors;
    current = parent;
  }
}
