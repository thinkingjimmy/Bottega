/**
 * [INPUT]: Depends on the shared Base location/row types and the cellValue read projection, paired with a fixed, well-known OSM tile URL
 * [OUTPUT]: Provides the OSM raster style, BaseMapLabel, and a Base rows → GeoJSON FeatureCollection converter
 * [POS]: Shared Base presentation in ui/views/map-support.
 */

import type * as GeoJSON from "geojson";
import {
  cellValue,
  type BaseCellContext,
  type BaseColumn,
  type BaseLocation,
  type BaseRow,
} from "@ai-chat/base-ui/model/bases-ipc";

const OSM_TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";

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
