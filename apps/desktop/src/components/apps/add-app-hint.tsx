/**
 * [INPUT]: Depends on i18n text and Tailwind arbitrary font size (the system is handwritten, no font weight)
 * [OUTPUT]: Provides AddAppHint: A hand drawing arrow batch pointing to the top of the page +
 * [POS]: The second instalment of Apps Airborne provides instructions on how to install itThe relative ancestors must be positioned
 */

import { useAppTranslation } from "@/components/providers/i18n-provider";

/* ── 为什么是系统字体栈而不是打包一份手写字 ─────────────────────────
 * 一句批注不值一个字体文件的下载与体积。macOS 自带 Bradley Hand（拉丁）
 * 与 Kaiti SC（中文楷书），两者按 glyph 覆盖自然接力：拉丁走前者，
 * 汉字落到后者，一行中英混排也不会有半句掉回正文黑体。
 * ──────────────────────────────────────────────────────────────── */
const HANDWRITING =
  "[font-family:'Bradley_Hand','Chalkboard_SE','Kaiti_SC','Comic_Sans_MS',cursive]";

/* 手绘感来自三处：非对称的控制点（曲线不是标准圆弧）、round 端头，
   以及两根长度不等的箭羽。描边用 currentColor，随主题走。 */
function ScribbleArrow() {
  return (
    <svg
      aria-hidden="true"
      className="h-20 w-12 shrink-0 text-muted-foreground/70"
      fill="none"
      viewBox="0 0 48 80"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* 弧朝下凸：手写批注的箭头是顺着手腕甩出去的——先向右下荡开，再兜上来
          扎向目标。控制点因此都压在弦的下方；压在上方就成了「绕过去」的弧，
          方向感反而背离目标。 */}
      <path
        d="M7 70C24 79 39 58 41 17"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.8"
      />
      {/* 两根箭羽长短不一：等长的对称箭头一看就是画出来的，不是写出来的 */}
      <path
        d="M41 17 34 25M41 17l5 10"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

export function AddAppHint() {
  const { t } = useAppTranslation();
  return (
    <div className="pointer-events-none absolute top-0 right-2 hidden items-start gap-1.5 md:flex">
      <p
        className={`mt-10 max-w-44 text-right text-[15px] text-muted-foreground leading-snug ${HANDWRITING}`}
      >
        {t("apps.emptyAction")}
      </p>
      <ScribbleArrow />
    </div>
  );
}
