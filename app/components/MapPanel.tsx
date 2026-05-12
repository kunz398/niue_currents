"use client";

import { useState, useCallback, useMemo } from "react";
import Map from "react-map-gl/maplibre";
import { DeckGL } from "@deck.gl/react";
import { TileLayer } from "@deck.gl/geo-layers";
import { BitmapLayer, ScatterplotLayer } from "@deck.gl/layers";
import type { MapViewState } from "@deck.gl/core";
import type { DepthLevel, LayerState, ProbePoint } from "./OceanViewer";

// Niue centre
const INITIAL_VIEW: MapViewState = {
  longitude: -169.0,
  latitude: -19.05,
  zoom: 7,
  pitch: 0,
  bearing: 0,
};

// Per-layer WMS config
const RASTER_LAYERS = ["temperature", "salinity", "velocity"] as const;
type RasterKey = typeof RASTER_LAYERS[number];

const LAYER_WMS: Record<RasterKey, string> = {
  temperature: "temperature",
  salinity: "salinity",
  velocity: "u:v-group",
};
const LAYER_STYLE: Record<RasterKey, string> = {
  temperature: "raster/div-RdBu-inv",
  salinity: "raster/div-BuRd",
  velocity: "default-vector",
};
const LAYER_COLORSCALE: Record<RasterKey, string> = {
  temperature: "24,30",
  salinity: "34,36",
  velocity: "0.0001,0.4237",
};

interface LegendConfig {
  label: string;
  gradient: string;
  ticks: string[];
}
const LAYER_LEGEND: Record<RasterKey, LegendConfig> = {
  temperature: {
    label: "Temperature (°C)",
    gradient: "linear-gradient(to right,#2166ac,#d1e5f0,#f7f7f7,#fddbc7,#d6604d)",
    ticks: ["24", "26", "28", "30"],
  },
  salinity: {
    label: "Salinity (PSU)",
    gradient: "linear-gradient(to right,#2166ac,#f7f7f7,#d6604d)",
    ticks: ["34", "34.5", "35", "35.5", "36"],
  },
  velocity: {
    label: "Velocity (m/s)",
    gradient: "linear-gradient(to right,#440154,#2a788e,#22a884,#7ad151,#fde725)",
    ticks: ["0.0001", "0.21", "0.4237"],
  },
};

// Compute EPSG:3857 bounding box string for a tile at (x, y, z)
const FULL_EXTENT = 6378137 * Math.PI; // 20037508.342789244 m
function tileToMercatorBbox(x: number, y: number, z: number): string {
  const size = (2 * FULL_EXTENT) / Math.pow(2, z);
  const west = -FULL_EXTENT + x * size;
  const east = west + size;
  const north = FULL_EXTENT - y * size;
  const south = north - size;
  return `${west},${south},${east},${north}`;
}

function buildWmsTileUrl(
  key: RasterKey,
  depth: DepthLevel,
  time: string | null,
  bbox: string
): string {
  const params = new URLSearchParams({
    SERVICE: "WMS",
    VERSION: "1.1.1",
    REQUEST: "GetMap",
    LAYERS: LAYER_WMS[key],
    STYLES: LAYER_STYLE[key],
    SRS: "EPSG:3857",
    BBOX: bbox,
    WIDTH: "256",
    HEIGHT: "256",
    FORMAT: "image/png",
    TRANSPARENT: "true",
    ELEVATION: String(depth),
    NUMCOLORBANDS: "250",
    COLORSCALERANGE: LAYER_COLORSCALE[key],
    ABOVEMAXCOLOR: "extend",
    BELOWMINCOLOR: "transparent",
    BGCOLOR: "extend",
    LOGSCALE: "false",
    ...(time ? { TIME: time } : {}),
  });
  return `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/wms?${decodeURIComponent(params.toString())}`;
}


// Basemap styles — defined at module scope so they're never recreated
const SATELLITE_STYLE = {
  version: 8 as const,
  sources: {
    satellite: {
      type: "raster" as const,
      tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
      tileSize: 256,
      attribution: "Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics",
    },
  },
  layers: [{ id: "satellite", type: "raster" as const, source: "satellite" }],
};

const TOPO_STYLE = {
  version: 8 as const,
  sources: {
    topo: {
      type: "raster" as const,
      tiles: ["https://tile.opentopomap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "Map data: &copy; OpenStreetMap contributors, SRTM | Map style: &copy; OpenTopoMap (CC-BY-SA)",
    },
  },
  layers: [{ id: "topo", type: "raster" as const, source: "topo" }],
};

const BASEMAPS: { key: "dark" | "osm" | "carto" | "satellite" | "topo"; label: string; style: string | object }[] = [
  { key: "topo",      label: "Topo",          style: TOPO_STYLE },
  { key: "dark",      label: "Dark",          style: "https://tiles.openfreemap.org/styles/dark" },
  { key: "osm",       label: "OpenStreetMap", style: "https://tiles.openfreemap.org/styles/liberty" },
  { key: "carto",     label: "CartoDB",       style: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json" },
  { key: "satellite", label: "Satellite",     style: SATELLITE_STYLE },
];

interface Props {
  layers: LayerState;
  depth: DepthLevel;
  currentTime: string | null;
  probePoint: ProbePoint | null;
  onProbePointChange: (p: ProbePoint | null) => void;
}

export default function MapPanel({
  layers,
  depth,
  currentTime,
  probePoint,
  onProbePointChange,
}: Props) {
  const [viewState, setViewState] = useState<MapViewState>(INITIAL_VIEW);
  const [is3D, setIs3D] = useState(false);
  const [basemap, setBasemap] = useState<"dark" | "osm" | "carto" | "satellite" | "topo">("topo");
  const [showBasemapPicker, setShowBasemapPicker] = useState(false);

  // Count active raster layers to compute opacity
  const activeRasterCount = RASTER_LAYERS.filter((k) => layers[k]).length;
  const rasterOpacity = activeRasterCount > 1 ? 0.55 : 0.85;

  // deck.gl TileLayers for WMS — keeps old tiles visible while new ones load (no blink)
  const deckLayers = useMemo(
    () =>
      RASTER_LAYERS.filter((key) => layers[key]).map(
        (key) =>
          new TileLayer({
            id: `wms-${key}`,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            getTileData: (props: any) => {
              const { index, signal } = props;
              const bbox = tileToMercatorBbox(index.x, index.y, index.z);
              const url = buildWmsTileUrl(key, depth, currentTime, bbox);
              return fetch(url, signal ? { signal } : {})
                .then((r) => (r.ok ? r.blob() : null))
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                .then((b): Promise<any> | null => (b ? createImageBitmap(b) : null));
            },
            updateTriggers: {
              getTileData: [key, depth, currentTime],
            },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            renderSubLayers: (props: any) => {
              const { boundingBox } = props.tile;
              if (!props.data) return null;
              return new BitmapLayer(props, {
                data: undefined,
                image: props.data,
                bounds: [
                  boundingBox[0][0],
                  boundingBox[0][1],
                  boundingBox[1][0],
                  boundingBox[1][1],
                ],
              });
            },
            opacity: rasterOpacity,
            tileSize: 256,
            refinementStrategy: "best-available" as const,
          })
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [layers.temperature, layers.salinity, layers.velocity, depth, currentTime, rasterOpacity]
  );

  const markerLayer = useMemo(
    () =>
      probePoint
        ? new ScatterplotLayer({
            id: "probe-marker",
            data: [probePoint],
            getPosition: (d: ProbePoint) => [d.lon, d.lat],
            getRadius: 8,
            radiusUnits: "pixels" as const,
            getFillColor: [255, 255, 255, 220],
            getLineColor: [59, 130, 246, 255],
            stroked: true,
            lineWidthMinPixels: 2,
            pickable: false,
          })
        : null,
    [probePoint]
  );

  const handleMapClick = useCallback(
    (info: { coordinate?: number[] | null }) => {
      if (!info.coordinate) return;
      onProbePointChange({
        lon: info.coordinate[0],
        lat: info.coordinate[1],
      });
    },
    [onProbePointChange]
  );

  const handleZoomIn = useCallback(
    () => setViewState((vs) => ({ ...vs, zoom: Math.min(vs.zoom + 1, 18) })),
    []
  );
  const handleZoomOut = useCallback(
    () => setViewState((vs) => ({ ...vs, zoom: Math.max(vs.zoom - 1, 1) })),
    []
  );
  const handleToggle3D = useCallback(() => {
    setIs3D((prev) => {
      const next = !prev;
      setViewState((vs) => ({ ...vs, pitch: next ? 45 : 0 }));
      return next;
    });
  }, []);

  const activeLegends = RASTER_LAYERS.filter((k) => layers[k]).map((k) => LAYER_LEGEND[k]);

  return (
    <div className="relative w-full h-full">
      <DeckGL
        viewState={viewState}
        controller={true}
        layers={[...deckLayers, ...(markerLayer ? [markerLayer] : [])]}
        onViewStateChange={({ viewState: vs }) =>
          setViewState(vs as MapViewState)
        }
        onClick={handleMapClick}
        style={{ position: "absolute", inset: "0" }}
      >
        <Map
          mapStyle={BASEMAPS.find((b) => b.key === basemap)!.style as string}
          style={{ width: "100%", height: "100%" }}
          attributionControl={false}
        />
      </DeckGL>

      {/* Legend colorbars — one per active raster layer */}
      {activeLegends.length > 0 && (
        <div className="absolute bottom-4 left-4 flex flex-col gap-2 pointer-events-none select-none">
          {activeLegends.map((legend) => (
            <div
              key={legend.label}
              className="bg-[#1a1f2e]/90 rounded-lg px-3 py-2 border border-[#2d3748]"
            >
              <p className="text-[11px] text-slate-300 mb-1.5 font-medium">{legend.label}</p>
              <div className="h-3 w-44 rounded" style={{ background: legend.gradient }} />
              <div className="flex justify-between mt-1">
                {legend.ticks.map((t) => (
                  <span key={t} className="text-[9px] text-slate-400">{t}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Basemap switcher — top right */}
      <div className="absolute top-3 right-3 z-10">
        <button
          onClick={() => setShowBasemapPicker((v) => !v)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-[#1a1f2e]/90 border border-[#2d3748] rounded-lg text-[11px] text-slate-300 hover:bg-[#2d3748] transition-colors"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polygon points="3,6 9,3 15,6 21,3 21,18 15,21 9,18 3,21" />
            <line x1="9" y1="3" x2="9" y2="18" />
            <line x1="15" y1="6" x2="15" y2="21" />
          </svg>
          {BASEMAPS.find((b) => b.key === basemap)!.label}
        </button>
        {showBasemapPicker && (
          <div className="absolute right-0 mt-1 w-44 bg-[#1a1f2e] border border-[#2d3748] rounded-lg overflow-hidden shadow-lg">
            {BASEMAPS.map((b) => (
              <button
                key={b.key}
                onClick={() => { setBasemap(b.key); setShowBasemapPicker(false); }}
                className={`w-full text-left px-3 py-2 text-[12px] transition-colors ${
                  basemap === b.key
                    ? "bg-blue-600/30 text-blue-300"
                    : "text-slate-300 hover:bg-[#2d3748]"
                }`}
              >
                {b.key === basemap && <span className="mr-1.5">✓</span>}{b.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Zoom + 3D controls */}
      <div className="absolute right-3 top-1/2 -translate-y-1/2 flex flex-col gap-1">
        <button
          onClick={handleZoomIn}
          className="w-9 h-9 bg-[#1a1f2e]/90 border border-[#2d3748] rounded text-slate-200 text-lg font-light flex items-center justify-center hover:bg-[#2d3748] transition-colors"
        >
          +
        </button>
        <button
          onClick={handleZoomOut}
          className="w-9 h-9 bg-[#1a1f2e]/90 border border-[#2d3748] rounded text-slate-200 text-lg font-light flex items-center justify-center hover:bg-[#2d3748] transition-colors"
        >
          −
        </button>
        <button
          onClick={handleToggle3D}
          className={`w-9 h-9 border rounded text-[11px] font-semibold flex items-center justify-center transition-colors ${
            is3D
              ? "bg-blue-600 border-blue-500 text-white"
              : "bg-[#1a1f2e]/90 border-[#2d3748] text-slate-300 hover:bg-[#2d3748]"
          }`}
        >
          3D
        </button>
      </div>
    </div>
  );
}
