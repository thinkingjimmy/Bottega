/**
 * [INPUT]: No external dependence
 * [OUTPUT]: Provides Gallery and the conversation Image tab to share five-level scales with Select options
 * [POS]: The basis for the accuracy of the scaled vocabulary of bases/views/gallery; The two views consume only, not replicate arrays
 */

export const GALLERY_ZOOMS = [25, 50, 100, 150, 200] as const;

export const GALLERY_ZOOM_OPTIONS = GALLERY_ZOOMS.map((value) => ({
  id: String(value),
  name: `${value}%`,
}));
