/**
 * [INPUT]: None.
 * [OUTPUT]: Provides the fixed Widget size vocabulary and three-edge DIP dimensions without schema dependencies.
 * [POS]: Schema-free geometry leaf shared by the compiler, native Dock metrics and isolated renderers.
 */
export const DOCK_SUMMARY_SIZES=['small','medium','large'] as const;
export type DockSummarySize=typeof DOCK_SUMMARY_SIZES[number];
export function summaryDimensions(size:DockSummarySize,edge:'bottom'|'left'|'right'):{width:number;height:number}{
 const extent={small:68,medium:136,large:204}[size];return edge==='bottom'?{width:extent,height:68}:{width:68,height:extent};
}
