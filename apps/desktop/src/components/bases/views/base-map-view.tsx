/**
 * [INPUT]: Depends on MapLibre, projected Base rows/columns, the canonical BaseCellContext, view configuration, and main-owned HTTPS external opening
 * [OUTPUT]: Provides BaseMapView with canonical labels/URLs, location configuration, OSM attribution, clusters, safe text popups, and an unlocated-row fallback
 * [POS]: The Base Map renderer; visible geography follows projection while computed/relation values always follow the full snapshot context
 */

import { SlimScroller } from "@ai-chat/ui/components/ui/slim-scroller";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import type { BaseMutationOutcome } from "../state/base-mutation-error";
import * as maplibregl from "maplibre-gl";
import type {
  GeoJSONSource,
  MapMouseEvent,
  MapGeoJSONFeature,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { MapPinIcon, PlusIcon } from "lucide-react";
import { Button } from "@ai-chat/ui/components/ui/button";
import {
  type BaseCellContext,
  type BaseColumn,
  type BaseColumnType,
  type BaseLocation,
  type BaseRow,
} from "../../../../shared/bases-ipc";
import { openExternal } from "@/lib/agent-client";
import {
  baseMapLabel,
  createBaseMapGeoJson,
  createBaseMapStyle,
} from "@/lib/bases/map-model";
import { createBaseMapPopup } from "@/lib/bases/map-popup";
import { ViewConfigBar, ViewConfigSelect } from "./view-config-bar";

const MAP_FAILURE = {
  offline: 1,
  tilesUnavailable: 2,
} as const;

export function BaseMapView({
  columns,
  context,
  rows,
  locationColumnId,
  labelColumnId,
  busy = false,
  onLocationColumnChange,
  onLabelColumnChange,
  onAddColumn,
}: {
  columns: BaseColumn[];
  context: BaseCellContext;
  rows: BaseRow[];
  locationColumnId?: string;
  labelColumnId?: string;
  busy?: boolean;
  /* intent 一律来自 workbench 的收口出口：判决即返回值，永不 reject。 */
  onLocationColumnChange?(columnId: string): Promise<BaseMutationOutcome>;
  onLabelColumnChange?(columnId: string): Promise<BaseMutationOutcome>;
  onAddColumn?(type: BaseColumnType): Promise<BaseMutationOutcome>;
}) {
  const { t } = useAppTranslation();
  const locationColumn = useMemo(
    () =>
      columns.find(
        (column) =>
          column.id === locationColumnId && column.type === "location"
      ) ?? columns.find((column) => column.type === "location"),
    [columns, locationColumnId]
  );
  const labelColumn = useMemo(
    () =>
      columns.find((column) => column.id === labelColumnId) ??
      columns.find((column) => column.type === "text"),
    [columns, labelColumnId]
  );
  const urlColumn = useMemo(
    () => columns.find((column) => column.type === "url"),
    [columns]
  );
  const points = useMemo(
    () =>
      locationColumn
        ? rows.flatMap((row) => {
            const value = row.values[locationColumn.id];
            return value && typeof value === "object"
              ? [{ row, location: value as BaseLocation }]
              : [];
          })
        : [],
    [locationColumn, rows]
  );
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<
    (typeof MAP_FAILURE)[keyof typeof MAP_FAILURE] | null
  >(navigator.onLine ? null : MAP_FAILURE.offline);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !locationColumn || !points.length || !navigator.onLine) {
      return;
    }
    const map = new maplibregl.Map({
      container,
      center: [points[0]!.location.lng, points[0]!.location.lat],
      zoom: 3,
      style: createBaseMapStyle(),
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    const geojson = createBaseMapGeoJson(
      points,
      context,
      labelColumn,
      urlColumn
    );
    map.on("load", () => {
      map.addSource("base-points", {
        type: "geojson",
        data: geojson,
        cluster: true,
        clusterRadius: 42,
        clusterMaxZoom: 14,
      });
      map.addLayer({
        id: "base-clusters",
        type: "circle",
        source: "base-points",
        filter: ["has", "point_count"],
        paint: {
          "circle-color": "#334155",
          "circle-radius": ["step", ["get", "point_count"], 16, 20, 21, 100, 27],
        },
      });
      map.addLayer({
        id: "base-cluster-count",
        type: "symbol",
        source: "base-points",
        filter: ["has", "point_count"],
        layout: {
          "text-field": ["get", "point_count_abbreviated"],
          "text-size": 11,
        },
        paint: { "text-color": "#ffffff" },
      });
      map.addLayer({
        id: "base-unclustered",
        type: "circle",
        source: "base-points",
        filter: ["!", ["has", "point_count"]],
        paint: {
          "circle-color": "#2563eb",
          "circle-radius": 7,
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 2,
        },
      });
      map.on(
        "click",
        "base-clusters",
        async (
          event: MapMouseEvent & { features?: MapGeoJSONFeature[] }
        ) => {
        const feature = event.features?.[0] as MapGeoJSONFeature | undefined;
        const id = feature?.properties.cluster_id as number | undefined;
        const source = map.getSource("base-points") as GeoJSONSource;
        if (id === undefined || !feature) return;
        const zoom = await source.getClusterExpansionZoom(id);
        const coordinates = (feature.geometry as GeoJSON.Point).coordinates;
        map.easeTo({ center: [coordinates[0]!, coordinates[1]!], zoom });
        }
      );
      map.on(
        "click",
        "base-unclustered",
        (event: MapMouseEvent & { features?: MapGeoJSONFeature[] }) => {
        const feature = event.features?.[0];
        if (!feature || feature.geometry.type !== "Point") return;
        const url = String(feature.properties?.url ?? "");
        const root = createBaseMapPopup(document, {
          label: String(feature.properties?.label ?? ""),
          url,
          fallbackLabel: t("bases.map.unnamedLocation"),
          openLinkLabel: t("bases.cell.openLink"),
          onOpen: (target) => void openExternal(target),
        });
        const coordinates = feature.geometry.coordinates;
        new maplibregl.Popup()
          .setLngLat([coordinates[0]!, coordinates[1]!])
          .setDOMContent(root)
          .addTo(map);
        }
      );
    });
    map.on("error", () => setError(MAP_FAILURE.tilesUnavailable));
    return () => map.remove();
  }, [context, labelColumn, locationColumn, points, t, urlColumn]);

  if (!locationColumn) {
    return (
      <div className="grid flex-1 place-items-center p-8">
        <div className="flex flex-col items-center gap-3 text-center">
          <MapPinIcon className="size-8 text-muted-foreground/50" />
          <p className="text-muted-foreground text-sm">
            {t("bases.map.hint")}
          </p>
          {onAddColumn && (
            <Button
              className="cursor-pointer"
              disabled={busy}
              onClick={() => void onAddColumn("location")}
              size="sm"
              type="button"
              variant="outline"
            >
              <PlusIcon />
              {t("bases.map.addColumn")}
            </Button>
          )}
        </div>
      </div>
    );
  }
  const locationColumns = columns.filter(
    (column) => column.type === "location"
  );
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {(onLocationColumnChange || onLabelColumnChange) && (
        <ViewConfigBar>
          {onLocationColumnChange && (
            <ViewConfigSelect
              disabled={busy}
              label={t("bases.map.location")}
              onChange={(id) => void onLocationColumnChange(id)}
              options={locationColumns}
              value={locationColumn.id}
            />
          )}
          {onLabelColumnChange && (
            <ViewConfigSelect
              disabled={busy}
              label={t("bases.map.label")}
              onChange={(id) => void onLabelColumnChange(id)}
              options={columns.filter((column) => column.id !== locationColumn.id)}
              placeholder={t("bases.map.auto")}
              value={labelColumn?.id ?? ""}
            />
          )}
        </ViewConfigBar>
      )}
      {!error && <div ref={containerRef} className="min-h-[18rem] flex-1" />}
      {(error || !points.length) && (
        <SlimScroller className="min-h-0 flex-1 overflow-auto p-4">
          <p className="mb-3 text-muted-foreground text-sm">
            {error
              ? t(
                  error === MAP_FAILURE.offline
                    ? "bases.map.offline"
                    : "bases.map.tilesUnavailable"
                )
              : t("bases.map.noCoordinates")}
          </p>
          <LocationList
            cellContext={context}
            labelColumn={labelColumn}
            locationColumn={locationColumn}
            points={points}
          />
        </SlimScroller>
      )}
    </div>
  );
}

function LocationList({
  points,
  locationColumn,
  labelColumn,
  cellContext,
}: {
  points: Array<{ row: BaseRow; location: BaseLocation }>;
  locationColumn: BaseColumn;
  labelColumn?: BaseColumn;
  cellContext: BaseCellContext;
}) {
  return (
    <ul className="grid gap-2">
      {points.map(({ row, location }) => (
        <li key={row.id} className="rounded-md border p-3 text-xs">
          <p className="font-medium">
            {baseMapLabel(row, cellContext, labelColumn)}
          </p>
          <p className="mt-1 text-muted-foreground">
            {locationColumn.name}: {location.lat}, {location.lng}
          </p>
        </li>
      ))}
    </ul>
  );
}
