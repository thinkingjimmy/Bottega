/**
 * [INPUT]: Depends on shared Base location/row type and cellValue reading projection; Context with a readable definitive tile URL
 * [OUTPUT]: Provides OSM raster style, BaseMapLabel and Base rows→ GeoJSON FeatureCollection
 * [POS]: The Map data pipeline for lib/bases; Share the production view with local fixture testing without contact with DOM/MapLibre examples
 */

import {
  cellValue,
  type BaseCellContext,
  type BaseColumn,
  type BaseLocation,
  type BaseRow,
} from "../../../shared/bases-ipc";

export const OSM_TILE_URL =
  "https://tile.openstreetmap.org/{z}/{x}/{y}.png";

export function createBaseMapStyle(tileUrl = OSM_TILE_URL) {
  return {
    version: 8 as const,
    sources: {
      osm: {
        type: "raster" as const,
        tiles: [tileUrl],
        tileSize: 256,
        attribution:
          '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
      },
    },
    layers: [{ id: "osm", type: "raster" as const, source: "osm" }],
  };
}

/**
 * label/url 一律走 cellValue：直读 row.values 会让 relation 标签退成 row id、
 * 公式列退成空——地图上的字必须和表格里看到的是同一句话。
 */
export function createBaseMapGeoJson(
  points: Array<{ row: BaseRow; location: BaseLocation }>,
  context: BaseCellContext,
  labelColumn?: BaseColumn,
  urlColumn?: BaseColumn
): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: points.map(({ row, location }) => ({
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [location.lng, location.lat],
      },
      properties: {
        rowId: row.id,
        label: baseMapLabel(row, context, labelColumn),
        url: String(
          (urlColumn ? cellValue(row, urlColumn, context) : undefined) ?? ""
        ),
      },
    })),
  };
}

export function baseMapLabel(
  row: BaseRow,
  context: BaseCellContext,
  labelColumn?: BaseColumn
) {
  const label = labelColumn ? cellValue(row, labelColumn, context) : undefined;
  return String(label ?? row.id);
}
