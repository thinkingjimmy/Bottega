/**
 * [INPUT]: Depends only on the canvas source text and the bounded opening-tag hint the preview bridge emits
 * [OUTPUT]: Provides workspaceSourceLine — the 1-based line of the single opening tag a hint can name, or null when the hint is ambiguous
 * [POS]: The one source-line matcher shared by the legacy workspace route and the compiled workspace facade
 */

/* 提示词是浏览器桥截断过的开标签：超过 180 字符时属性会被裁掉，所以精确
   子串命中只是幸运路径。回退到按标签名扫描时必须用提示里仅存的 id/class
   收窄，否则同名标签全都成为候选，唯一性判定永远落空——两份实现里只有一
   份做了收窄，就等于同一个提问在两条路由上得到两个答案。 */
export function workspaceSourceLine(source: string, hint: string) {
  const matches = matchingOpeningTags(source, hint);
  return matches.length === 1 ? source.slice(0, matches[0]).split("\n").length : null;
}

function matchingOpeningTags(source: string, hint: string) {
  const exact = source.indexOf(hint);
  if (exact >= 0) {
    return source.indexOf(hint, exact + hint.length) < 0 ? [exact] : [exact, exact];
  }
  const tag = /^<([a-z][a-z0-9:-]*)\b/i.exec(hint)?.[1];
  if (!tag) return [];
  const expectedId = htmlAttribute(hint, "id");
  const expectedClasses = (htmlAttribute(hint, "class") ?? "").split(/\s+/).filter(Boolean);
  const pattern = new RegExp(`<${escapeRegExp(tag)}(?:\\s[^<>]*?)?>`, "gi");
  const matches: number[] = [];
  for (const candidate of source.matchAll(pattern)) {
    if (expectedId !== null && htmlAttribute(candidate[0], "id") !== expectedId) continue;
    const classes = new Set((htmlAttribute(candidate[0], "class") ?? "").split(/\s+/));
    if (expectedClasses.some((name) => !classes.has(name))) continue;
    matches.push(candidate.index);
  }
  return matches;
}

function htmlAttribute(tag: string, name: string) {
  const pattern = new RegExp(`\\s${escapeRegExp(name)}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i");
  const match = pattern.exec(tag);
  return match ? (match[1] ?? match[2] ?? match[3] ?? "") : null;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
