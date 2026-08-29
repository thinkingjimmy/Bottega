/**
 * [INPUT]: Depends only on complete UTF-8 Design HTML source
 * [OUTPUT]: Provides deterministic AntiSlopAdvisory records for the Bottega Design Canvas GUI and render-check tool
 * [POS]: Design's advisory-only visual-quality lint; it shares rule intent with resources/skills/design/SKILL.md without becoming a release gate
 */

export type AntiSlopAdvisory = Readonly<{
  ruleId: string;
  message: string;
  count: number;
}>;

type Rule = Readonly<{
  ruleId: string;
  message: string;
  pattern: RegExp;
}>;

// These deterministic checks mirror the Skill's `## Anti-slop` section. They
// deliberately report evidence rather than guessing design intent or blocking output.
const RULES: readonly Rule[] = [
  {
    ruleId: "default-indigo",
    message: "Default indigo/blue accents often make unrelated products look interchangeable.",
    pattern: /#(?:4f46e5|4338ca|6366f1|2563eb|3b82f6)\b/gi,
  },
  {
    ruleId: "trust-gradient",
    message: "A generic two-stop gradient is being used as a trust or quality shortcut.",
    pattern: /linear-gradient\([^)]*(?:#[0-9a-f]{3,8}|rgba?\([^)]*\))\s*,\s*(?:#[0-9a-f]{3,8}|rgba?\([^)]*\))[^)]*\)/gi,
  },
  {
    ruleId: "emoji-icon",
    message: "Emoji used as interface icons vary by platform and weaken visual consistency.",
    pattern: /<(?:button|a|span)[^>]*(?:class=["'][^"']*(?:icon|avatar|badge)[^"']*["'])?[^>]*>\s*[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/giu,
  },
  {
    ruleId: "generic-display-font",
    message: "Generic product fonts are used without a deliberate editorial type choice.",
    pattern: /font-family\s*:\s*(?:["']?(?:Inter|Roboto)["']?|system-ui)\b/gi,
  },
  {
    ruleId: "decorative-card-stripe",
    message: "Rounded cards with decorative colored side borders add chrome without hierarchy.",
    pattern: /[^{}]+\{(?=[^{}]*border-radius\s*:)(?=[^{}]*border-(?:left|inline-start)\s*:)[^{}]*\}/gi,
  },
  {
    ruleId: "invented-metric",
    message: "A precise metric appears without an accompanying data source or calculation.",
    pattern: /<(?:strong|b|span|div)[^>]*(?:class=["'][^"']*(?:metric|stat|kpi)[^"']*["'])[^>]*>[^<]*\b\d+(?:\.\d+)?%/gi,
  },
  {
    ruleId: "filler-copy",
    message: "Placeholder or filler copy should be replaced with product-specific language.",
    pattern: /\b(?:lorem ipsum|coming soon|your headline here|sample text|dummy text)\b/gi,
  },
  {
    ruleId: "placeholder-image",
    message: "External placeholder imagery makes the canvas non-hermetic and visually generic.",
    pattern: /<(?:img|source)[^>]+(?:placeholder\.com|placehold\.co|picsum\.photos|source\.unsplash\.com)[^>]*>/gi,
  },
];

export function lintDesignHtml(source: string | Buffer): readonly AntiSlopAdvisory[] {
  const html = Buffer.isBuffer(source) ? source.toString("utf8") : source;
  const advisories: AntiSlopAdvisory[] = [];
  for (const rule of RULES) {
    const count = [...html.matchAll(rule.pattern)].length;
    if (count) advisories.push({
      ruleId: rule.ruleId,
      message: rule.message,
      count,
    });
    rule.pattern.lastIndex = 0;
  }
  return advisories;
}
