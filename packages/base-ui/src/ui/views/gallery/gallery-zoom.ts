/**
 * [INPUT]: No external dependence
 * [OUTPUT]: Provides GALLERY_ZOOM_OPTIONS, the five-step zoom vocabulary shared by Gallery and the conversation image tab
 * [POS]: Shared Base presentation in ui/views/gallery.
 */

const GALLERY_ZOOMS = [25, 50, 100, 150, 200] as const;

export const GALLERY_ZOOM_OPTIONS = GALLERY_ZOOMS.map((value) => ({
  id: String(value),
  name: `${value}%`,
}));
