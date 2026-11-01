/**
 * [INPUT]: Captured native font family names and closed deck-root resource references.
 * [OUTPUT]: CSS string quoting and inert compiler font declarations with no executable HTML or live URLs.
 * [POS]: Shared native font composition for owner validation and fixed source-built viewers.
 */
export function nativeFontCssString(value: string): string {
  return '"' + Array.from(value, char => {
    const point = char.codePointAt(0)!;
    return "\"'\\<>".includes(char) || point < 32 || point === 127 ? "\\" + point.toString(16) + " " : char;
  }).join("") + '"';
}
export function nativeSlideFontHead(faces: readonly { family: string; src: string }[]): string {
  if (faces.length > 4) throw new Error("A native deck supports at most four captured font faces");
  const rules = faces.map(face => {
    const parts = face.src.split("/");
    const local = face.src.length > 0 && face.src.length <= 240 && parts.length <= 4 &&
      parts.every(part => /^[A-Za-z0-9_][A-Za-z0-9_. -]*$/.test(part)) && !parts.includes("node_modules");
    if (!local && !/^\/_blob\/[a-f0-9]{32}$/.test(face.src)) throw new Error("Native fonts require a closed deck-root resource reference");
    if (!face.family.trim() || face.family.length > 128 || Array.from(face.family).some(char => char.codePointAt(0)! < 32 || char.codePointAt(0) === 127)) throw new Error("A native font family is invalid");
    return "@font-face{font-family:" + nativeFontCssString(face.family) + ";src:url(" + nativeFontCssString(face.src) + ");font-weight:100 900;font-style:normal}";
  });
  return rules.length ? "<style>" + rules.join("") + "</style>" : "";
}
