/**
 * [INPUT]: Completed pointer resize widths in CSS pixels and release timestamps.
 * [OUTPUT]: Provides desktop sidebar width bounds, a bounded width preference, and its parser and recorder.
 * [POS]: The desktop sidebar's preferred-width calculation. The layout store owns persistence.
 */

export const SIDEBAR_MIN_WIDTH = 200;
export const SIDEBAR_MAX_WIDTH = 400;
export const SIDEBAR_SNAP_DISTANCE = 10;

const SPREAD = 8;
const HALF_LIFE = 5;
const MIN_SUPPORT = 2.5;
const CORRECTION_MS = 2_000;
const SAMPLE_LIMIT = 40;

type WidthSample = { width: number; at: number };

export type SidebarWidthPreference = Readonly<{
  samples: readonly WidthSample[];
  snapPoint: number | null;
}>;

export const EMPTY_SIDEBAR_WIDTH_PREFERENCE: SidebarWidthPreference = {
  samples: [],
  snapPoint: null,
};

function isSidebarWidth(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) &&
    value >= SIDEBAR_MIN_WIDTH && value <= SIDEBAR_MAX_WIDTH;
}

function isWidthSample(value: unknown): value is WidthSample {
  if (!value || typeof value !== "object") return false;
  const { width, at } = value as Partial<WidthSample>;
  return isSidebarWidth(width) && typeof at === "number" && Number.isSafeInteger(at) && at >= 0;
}

export function parseSidebarWidthPreference(value: unknown): SidebarWidthPreference {
  if (!value || typeof value !== "object") return EMPTY_SIDEBAR_WIDTH_PREFERENCE;
  const { samples, snapPoint } = value as Partial<SidebarWidthPreference>;
  if (!Array.isArray(samples) || samples.length > SAMPLE_LIMIT || !samples.every(isWidthSample)) {
    return EMPTY_SIDEBAR_WIDTH_PREFERENCE;
  }
  if (snapPoint !== null && (!isSidebarWidth(snapPoint) || samples.length < 3)) {
    return EMPTY_SIDEBAR_WIDTH_PREFERENCE;
  }
  return { samples, snapPoint };
}

// Each release adds a Gaussian peak. Recent releases have more weight.
function strongestWidth(samples: readonly WidthSample[]) {
  if (samples.length < 3) return null;
  const weighted = samples.map(({ width }, index) => ({
    width,
    weight: 0.5 ** ((samples.length - 1 - index) / HALF_LIFE),
  }));
  const widths = samples.map(({ width }) => width);
  const maximum = Math.max(...widths);
  let peak = Math.min(...widths);
  let maxDensity = 0;
  for (let width = peak; width <= maximum; width++) {
    const density = weighted.reduce((sum, sample) => {
      const distance = (width - sample.width) / SPREAD;
      return sum + sample.weight * Math.exp(-(distance ** 2) / 2);
    }, 0);
    if (density > maxDensity) {
      maxDensity = density;
      peak = width;
    }
  }
  const support = weighted.reduce(
    (sum, sample) => Math.abs(sample.width - peak) <= 2 * SPREAD ? sum + sample.weight : sum,
    0,
  );
  return support >= MIN_SUPPORT ? peak : null;
}

export function recordSidebarWidth(
  preference: SidebarWidthPreference,
  width: number,
  at: number,
): SidebarWidthPreference {
  const { samples, snapPoint } = preference;
  const last = samples.at(-1);
  const elapsed = last ? at - last.at : Infinity;
  const recent = elapsed >= 0 && elapsed < CORRECTION_MS
    ? samples.slice(0, -1)
    : samples.slice(1 - SAMPLE_LIMIT);
  const next = [...recent, { width, at }];
  const peak = strongestWidth(next);
  const stays = snapPoint !== null && peak !== null &&
    Math.abs(peak - snapPoint) <= SIDEBAR_SNAP_DISTANCE;
  return { samples: next, snapPoint: stays ? snapPoint : peak };
}
