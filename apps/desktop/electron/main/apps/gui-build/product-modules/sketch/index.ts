/**
 * [INPUT]: Reproducible, product-owned Sketch renderer snapshot.
 * [OUTPUT]: The fixed compiler's @bottega/sketch-react runtime, declarations and styles.
 * [POS]: Immutable virtual module; the author configures real Sketch behavior inside its isolated frame.
 */
import snapshot from './bundle.json';
export const PLUGIN_SKETCH_RUNTIME_SOURCE = snapshot.runtime;
export const PLUGIN_SKETCH_STYLE_SOURCE = snapshot.styles;
export const PLUGIN_SKETCH_TYPES_SOURCE = `import type { ReactElement } from 'react';
export type SketchShape='line'|'arrow'|'rectangle'|'circle'|'triangle'|'diamond'|'star'|'heart';
export type SketchPluginProps={palette?:readonly string[];shapes?:readonly SketchShape[]};
export function SketchPlugin(props:SketchPluginProps):ReactElement;`;
