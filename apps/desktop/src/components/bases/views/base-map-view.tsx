/**
 * [INPUT]: Depends on MapLibre, projected Base rows/columns, the canonical BaseCellContext, view configuration, virtualization, and main-owned HTTPS external opening
 * [OUTPUT]: Provides BaseMapView with canonical labels/URLs, location configuration, OSM attribution, clusters, safe text popups, and a virtualized unlocated-row fallback
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
import { useVirtualizer } from "@tanstack/react-virtual";
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

const POINTS_SOURCE = "base-points";
/** 坐标卡片是定高读态：估值只决定首帧滚动条长度，measureElement 落地即取代它。 */
const LOCATION_ROW_HEIGHT = 74;

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
  /* label/url 全部烘进 feature properties，于是「换标签列」与「改一个格子」
     在数据面是同一件事：一次 setData 即可，图层配置无须跟着变。 */
  const geojson = useMemo(
    () => createBaseMapGeoJson(points, context, labelColumn, urlColumn),
    [context, labelColumn, points, urlColumn]
  );
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const geojsonRef = useRef(geojson);
  const [error, setError] = useState<
    (typeof MAP_FAILURE)[keyof typeof MAP_FAILURE] | null
  >(navigator.onLine ? null : MAP_FAILURE.offline);
  /* load 是异步的，数据却可能先于它到达。用一枚计数把「图层就绪」变成一次
     普通的依赖变化，setData 便不必去猜自己跑在 load 之前还是之后。 */
  const [layersReady, setLayersReady] = useState(0);
  const locationColumnKey = locationColumn?.id;
  const hasPoints = points.length > 0;

  /* ── 地图只建一次 ──────────────────────────────────────────────
   * 这只 effect 曾依赖 context/points：改一个格子就 remove 整张地图，
   * 连同 source、四个图层与两个 click handler 一起重建——用户看到的是
   * 视野被打回初始 zoom，而目的只是让某个点位挪一下。
   * 建图（样式/控件/交互）与喂数据本是两件事；拆开后前者的依赖只剩
   * 「哪一列是坐标」「有没有点」「地图还活着吗」这三件真正决定它存亡的事。
   * ────────────────────────────────────────────────────────── */
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !locationColumnKey || !hasPoints || error) return;
    if (!navigator.onLine) return;
    const first = geojsonRef.current.features[0];
    const center = (first?.geometry as GeoJSON.Point | undefined)?.coordinates;
    const map = new maplibregl.Map({
      container,
      center: center ? [center[0]!, center[1]!] : [0, 0],
      zoom: 3,
      style: createBaseMapStyle(),
    });
    mapRef.current = map;
    map.addControl(
      new maplibregl.NavigationControl({ showCompass: false }),
      "top-right"
    );
    map.on("load", () => {
      map.addSource(POINTS_SOURCE, {
        type: "geojson",
        data: geojsonRef.current,
        cluster: true,
        clusterRadius: 42,
        clusterMaxZoom: 14,
      });
      map.addLayer({
        id: "base-clusters",
        type: "circle",
        source: POINTS_SOURCE,
        filter: ["has", "point_count"],
        paint: {
          "circle-color": "#334155",
          "circle-radius": ["step", ["get", "point_count"], 16, 20, 21, 100, 27],
        },
      });
      map.addLayer({
        id: "base-cluster-count",
        type: "symbol",
        source: POINTS_SOURCE,
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
        source: POINTS_SOURCE,
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
        const source = map.getSource(POINTS_SOURCE) as GeoJSONSource;
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
      setLayersReady((value) => value + 1);
    });
    map.on("error", () => setError(MAP_FAILURE.tilesUnavailable));
    return () => {
      mapRef.current = null;
      map.remove();
    };
  }, [error, hasPoints, locationColumnKey, t]);

  /* 数据更新走 source.setData：点位的增删改只是同一张地图换一份
     FeatureCollection，视野、缩放与已展开的 cluster 都留在原处。 */
  useEffect(() => {
    geojsonRef.current = geojson;
    const source = mapRef.current?.getSource(POINTS_SOURCE) as
      | GeoJSONSource
      | undefined;
    source?.setData(geojson);
  }, [geojson, layersReady]);

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
        <div className="flex min-h-0 flex-1 flex-col px-4 pt-4">
          <p className="mb-3 shrink-0 text-muted-foreground text-sm">
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
        </div>
      )}
    </div>
  );
}

/**
 * 离线兜底同样面对一万行：这里曾一次性摊开全部 `<li>`，于是「地图挂了」
 * 之后紧接着是「页面也挂了」。与 table/list 同构走 TanStack 窗口化，
 * 兜底才真的兜得住。
 */
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
  const scrollRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line react-hooks/incompatible-library -- 10k 行必须使用 TanStack 窗口化
  const virtualizer = useVirtualizer({
    count: points.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => LOCATION_ROW_HEIGHT,
    getItemKey: (index) => points[index]!.row.id,
    overscan: 8,
    initialRect: { width: 480, height: 480 },
  });
  return (
    <SlimScroller
      ref={scrollRef}
      className="min-h-0 flex-1 overflow-auto pb-4"
      data-testid="base-map-location-list"
    >
      <ul className="relative" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((item) => {
          const { row, location } = points[item.index]!;
          return (
            <li
              key={item.key}
              className="absolute left-0 w-full pb-2"
              data-index={item.index}
              ref={virtualizer.measureElement}
              style={{ transform: `translateY(${item.start}px)` }}
            >
              <div className="rounded-md border p-3 text-xs">
                <p className="font-medium">
                  {baseMapLabel(row, cellContext, labelColumn)}
                </p>
                <p className="mt-1 text-muted-foreground">
                  {locationColumn.name}: {location.lat}, {location.lng}
                </p>
              </div>
            </li>
          );
        })}
      </ul>
    </SlimScroller>
  );
}
