/**
 * [INPUT]: No external dependence
 * [OUTPUT]: Provides GALLERY_ZOOM_OPTIONS, the five-step zoom vocabulary shared by Gallery and the conversation image tab
 * [POS]: The single source of the zoom-level vocabulary for bases/views/gallery; both consumers read this array rather than duplicating it
 */

/* 刻度只有一种对外形态：Select 要的 {id,name}。把裸数组也导出去，
   消费方就会各自再把数字拼成 "%"——同一件事便有了第二种写法。 */
const GALLERY_ZOOMS = [25, 50, 100, 150, 200] as const;

export const GALLERY_ZOOM_OPTIONS = GALLERY_ZOOMS.map((value) => ({
  id: String(value),
  name: `${value}%`,
}));
