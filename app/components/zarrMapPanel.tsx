"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import Map from "react-map-gl/maplibre";
import { DeckGL } from "@deck.gl/react";
import { BitmapLayer, ScatterplotLayer } from "@deck.gl/layers";
import type { MapViewState } from "@deck.gl/core";
import type { DepthLevel, LayerState, ProbePoint } from "./OceanViewer";
import {
  loadDepthLevels,
  loadTimeSteps,
  loadLatLon,
  findNearestIndex,
  loadRasterSlice,
} from "../lib/zarrLoader";
import { getColormap } from "../lib/colormaps";

const DATASET_NAME = "d1_temp_salt_uv_z_all.zarr";

// Niue centre
const INITIAL_VIEW: MapViewState = {
  longitude: -169.0,
  latitude: -19.05,
  zoom: 7,
  pitch: 0,
  bearing: 0,
};

// Which Zarr variable + colour range backs each LayerState toggle.
// temperature/velocity ranges match layers.config.ts's croco-temperature /
// croco-sea-velocity entries; salinity/zeta carry over the old WMS COLORSCALERANGE.
const RASTER_VARIABLES: Record<keyof LayerState, { variable: string; min: number; max: number; label: string }> = {
  temperature: { variable: "temperature", min: 20, max: 30, label: "Temperature (°C)" },
  salinity: { variable: "salinity", min: 34, max: 36, label: "Salinity (PSU)" },
  velocity: { variable: "current_speed", min: 0, max: 0.8, label: "Velocity (m/s)" },
  seaSurfaceHeight: { variable: "zeta", min: 0, max: 0.8, label: "Sea Surface Height (m)" },
};
const RASTER_KEYS = Object.keys(RASTER_VARIABLES) as (keyof LayerState)[];

function buildLegendGradient(): string {
  const colormap = getColormap("jet");
  const stops = [0, 0.25, 0.5, 0.75, 1].map((t) => {
    const [r, g, b] = colormap(t);
    return `rgb(${r},${g},${b}) ${t * 100}%`;
  });
  return `linear-gradient(to right, ${stops.join(", ")})`;
}
const LEGEND_GRADIENT = buildLegendGradient();

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

interface Coords {
  depths: number[];
  times: string[];
  timesMs: number[];
  lat: number[];
  lon: number[];
}

interface RasterImage {
  canvas: HTMLCanvasElement;
  bounds: [number, number, number, number];
}

interface Props {
  layers: LayerState;
  depth: DepthLevel;
  currentTime: string | null;
  probePoint: ProbePoint | null;
  onProbePointChange: (p: ProbePoint | null) => void;
}

export default function ZarrMapPanel({
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
  const [coords, setCoords] = useState<Coords | null>(null);
  const [raster, setRaster] = useState<RasterImage | null>(null);

  const activeKey = RASTER_KEYS.find((k) => layers[k]) ?? null;

  // Load coordinate arrays once per dataset.
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      loadDepthLevels(DATASET_NAME),
      loadTimeSteps(DATASET_NAME),
      loadLatLon(DATASET_NAME),
    ])
      .then(([depths, times, { lat, lon }]) => {
        if (cancelled) return;
        setCoords({
          depths,
          times,
          timesMs: times.map((t) => new Date(t).getTime()),
          lat,
          lon,
        });
      })
      .catch((err) => console.error("Failed to load Zarr coordinates:", err));
    return () => {
      cancelled = true;
    };
  }, []);

  // Rebuild the colour raster whenever the active layer, depth, or time changes.
  useEffect(() => {
    if (!coords || !activeKey || !currentTime) {
      setRaster(null);
      return;
    }

    let cancelled = false;
    const { variable, min, max } = RASTER_VARIABLES[activeKey];
    const timeIndex = findNearestIndex(coords.timesMs, new Date(currentTime).getTime());
    const depthIndex = findNearestIndex(coords.depths, depth);

    loadRasterSlice(DATASET_NAME, variable, { timeIndex, depthIndex })
      .then(({ data, height, width }) => {
        if (cancelled) return;

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        const imageData = ctx.createImageData(width, height);
        const colormap = getColormap("jet");
        const range = max - min || 1;
        const latAscending = coords.lat[0] < coords.lat[coords.lat.length - 1];
        const lonAscending = coords.lon[0] < coords.lon[coords.lon.length - 1];

        for (let latIdx = 0; latIdx < height; latIdx++) {
          const row = latAscending ? height - 1 - latIdx : latIdx;
          for (let lonIdx = 0; lonIdx < width; lonIdx++) {
            const col = lonAscending ? lonIdx : width - 1 - lonIdx;
            const value = data[latIdx * width + lonIdx];
            const pixelIndex = (row * width + col) * 4;

            if (!Number.isFinite(value)) {
              imageData.data[pixelIndex + 3] = 0;
              continue;
            }

            const t = Math.min(1, Math.max(0, (value - min) / range));
            const [r, g, b] = colormap(t);
            imageData.data[pixelIndex] = r;
            imageData.data[pixelIndex + 1] = g;
            imageData.data[pixelIndex + 2] = b;
            imageData.data[pixelIndex + 3] = Math.round(0.85 * 255);
          }
        }

        ctx.putImageData(imageData, 0, 0);
        setRaster({
          canvas,
          bounds: [
            Math.min(...coords.lon),
            Math.min(...coords.lat),
            Math.max(...coords.lon),
            Math.max(...coords.lat),
          ],
        });
      })
      .catch((err) => console.error("Failed to load raster slice:", err));

    return () => {
      cancelled = true;
    };
  }, [coords, activeKey, depth, currentTime]);

  const rasterLayer = useMemo(
    () =>
      raster
        ? new BitmapLayer({
            id: "zarr-raster",
            image: raster.canvas,
            bounds: raster.bounds,
            opacity: 0.85,
          })
        : null,
    [raster]
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

  const activeLegend = activeKey ? RASTER_VARIABLES[activeKey] : null;

  return (
    <div className="relative w-full h-full">
      <DeckGL
        viewState={viewState}
        controller={true}
        layers={[...(rasterLayer ? [rasterLayer] : []), ...(markerLayer ? [markerLayer] : [])]}
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

      {/* Legend colorbar — for the single active raster layer */}
      {activeLegend && (
        <div className="absolute bottom-4 left-4 pointer-events-none select-none">
          <div className="bg-[#1a1f2e]/90 rounded-lg px-3 py-2 border border-[#2d3748]">
            <p className="text-[11px] text-slate-300 mb-1.5 font-medium">{activeLegend.label}</p>
            <div className="h-3 w-44 rounded" style={{ background: LEGEND_GRADIENT }} />
            <div className="flex justify-between mt-1">
              <span className="text-[9px] text-slate-400">{activeLegend.min}</span>
              <span className="text-[9px] text-slate-400">{activeLegend.max}</span>
            </div>
          </div>
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
