/**
 * [INPUT]: The current Settings locale.
 * [OUTPUT]: Palette validation label and hint in the five supported languages.
 * [POS]: Settings-only copy leaf; kept out of the shared eager catalog and Dock renderers.
 */
const en = { label: "Validate chart palette", hint: "Check chart colors, light or dark mode, and the actual surface. Reports warnings and failures. Works without an Artifact editor or Python." };
type Copy = typeof en;
const zh: Copy = { label: "校验图表配色", hint: "检查图表颜色、浅色或深色模式及实际背景，保留警告与失败结果。无需打开作品编辑器或安装 Python。" };
const ja: Copy = { label: "グラフの配色を検証", hint: "グラフの色、ライト／ダークモード、実際の背景を検証し、警告と失敗を報告します。作品エディターや Python は不要です。" };
const fr: Copy = { label: "Vérifier la palette du graphique", hint: "Vérifie les couleurs, le mode clair ou sombre et le fond réel. Signale les avertissements et les échecs. Sans éditeur Artifact ni Python." };
const es: Copy = { label: "Validar la paleta del gráfico", hint: "Comprueba los colores, el modo claro u oscuro y el fondo real. Indica advertencias y fallos. No requiere el editor de Artifact ni Python." };
export const paletteToolCopy = (locale: string): Copy => locale.startsWith("zh") ? zh : locale.startsWith("ja") ? ja : locale.startsWith("fr") ? fr : locale.startsWith("es") ? es : en;
