"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import Map, { type MapRef } from "react-map-gl/maplibre";
import { DeckGL } from "@deck.gl/react";
import { BitmapLayer, ScatterplotLayer } from "@deck.gl/layers";
import type { MapViewState } from "@deck.gl/core";
import type { DepthLevel, LayerState, ProbePoint } from "./OceanViewer";
import {
  CROCO_DATASET,
  loadDepthLevels,
  loadTimeSteps,
  loadLatLon,
  loadModelInitTime,
  findNearestIndex,
  loadRasterSlice,
} from "../lib/zarrLoader";
import { getColormap, getColormapLUT, type ColormapName } from "../lib/colormaps";
import { ZARR_BASE_URL } from "../lib/layers.config";
import { WindAnimationOverlay } from "../lib/WindAnimationOverlay";

// Niue centre
const DEFAULT_INITIAL_VIEW: MapViewState = {
  longitude: -169.0,
  latitude: -19.05,
  zoom: 7,
  pitch: 0,
  bearing: 0,
};

// Which Zarr variable + colour range/scheme backs each LayerState toggle.
// temperature/velocity ranges match layers.config.ts's croco-temperature /
// croco-sea-velocity entries; salinity/zeta carry over the old WMS COLORSCALERANGE.
//
// Colormap choice follows what each field actually represents: temperature and
// sea surface height are diverging (cold/below-mean vs. hot/above-mean), so they
// use red-blue; salinity and velocity magnitude have no natural midpoint, so they
// use the sequential violet-to-yellow "viridis" ramp.
const RASTER_VARIABLES: Record<
  keyof LayerState,
  { variable: string; min: number; max: number; label: string; colormap: ColormapName }
> = {
  temperature: { variable: "temperature", min: 20, max: 30, label: "Temperature (°C)", colormap: "red-blue" },
  salinity: { variable: "salinity", min: 34, max: 36, label: "Salinity (PSU)", colormap: "viridis" },
  velocity: { variable: "current_speed", min: 0, max: 0.8, label: "Velocity (m/s)", colormap: "viridis" },
  // zeta is "free-surface elevation above geoid", not a zero-centered
  // anomaly — both Niue and Tuvalu's actual data clusters around 0.45-0.87m
  // (verified against the live datasets), so the domain is set to that band
  // rather than 0-0.8 to avoid washing out almost the whole map in one color.
  seaSurfaceHeight: { variable: "zeta", min: 0.4, max: 0.9, label: "Sea Surface Height (m)", colormap: "red-blue" },
};
const RASTER_KEYS = Object.keys(RASTER_VARIABLES) as (keyof LayerState)[];

// Temperature and velocity get their colour range from the actual loaded
// slice instead of the fixed defaults above — both vary a lot by depth/time
// (e.g. -1000m temperature is nowhere near the 20-30°C surface range), so a
// fixed scale either clips most of the data to one end or leaves it washed
// out. Salinity/zeta stay on fixed ranges since they cluster tightly enough
// that a fixed scale is more useful for comparing across frames.
const DYNAMIC_RANGE_KEYS = new Set<keyof LayerState>(["temperature", "velocity"]);

function buildLegendGradient(colormapName: ColormapName): string {
  const colormap = getColormap(colormapName);
  const stops = [0, 0.25, 0.5, 0.75, 1].map((t) => {
    const [r, g, b] = colormap(t);
    return `rgb(${r},${g},${b}) ${t * 100}%`;
  });
  return `linear-gradient(to right, ${stops.join(", ")})`;
}

// Basemap styles — defined at module scope so they're never recreated
const SATELLITE_STYLE = {
  version: 8 as const,
  sources: {
    satellite: {
      type: "raster" as const,
      tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
      tileSize: 256,
      // attribution: "Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics",
    },
    // Esri's imagery tiles carry no place names on their own — this is Esri's
    // companion "reference" layer (transparent PNGs with place/road labels and
    // boundaries) meant to be stacked on top of World_Imagery for exactly that.
    satelliteLabels: {
      type: "raster" as const,
      tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}"],
      tileSize: 256,
    },
  },
  layers: [
    { id: "satellite", type: "raster" as const, source: "satellite" },
    { id: "satellite-labels", type: "raster" as const, source: "satelliteLabels" },
  ],
};

const TOPO_STYLE = {
  version: 8 as const,
  sources: {
    topo: {
      type: "raster" as const,
      tiles: ["https://tile.opentopomap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      // attribution: "Map data: &copy; OpenStreetMap contributors, SRTM | Map style: &copy; OpenTopoMap (CC-BY-SA)",
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
  particlesEnabled: boolean;
  particleSpeed: number;
  onModelRunTimeChange?: (iso: string | null) => void;
  onTimesChange?: (times: string[]) => void;
  datasetName?: string;
  initialView?: MapViewState;
}

// Base displacement multiplier for the velocity flow particles before the
// user's speed control (particleSpeed) is applied.
const BASE_PARTICLE_SPEED_FACTOR = 0.35;

export default function ZarrMapPanel({
  layers,
  depth,
  currentTime,
  probePoint,
  onProbePointChange,
  particlesEnabled,
  particleSpeed,
  onModelRunTimeChange,
  onTimesChange,
  datasetName = CROCO_DATASET,
  initialView = DEFAULT_INITIAL_VIEW,
}: Props) {
  const [viewState, setViewState] = useState<MapViewState>(initialView);
  const [is3D, setIs3D] = useState(false);
  const [basemap, setBasemap] = useState<"dark" | "osm" | "carto" | "satellite" | "topo">("topo");
  const [showBasemapPicker, setShowBasemapPicker] = useState(false);
  const [coords, setCoords] = useState<Coords | null>(null);
  const [raster, setRaster] = useState<RasterImage | null>(null);
  const [dynamicRange, setDynamicRange] = useState<{ min: number; max: number } | null>(null);
  const mapRef = useRef<MapRef>(null);
  const [mapReady, setMapReady] = useState(false);
  const windOverlayRef = useRef<WindAnimationOverlay | null>(null);
  const particleMountRef = useRef<HTMLDivElement>(null);

  const activeKey = RASTER_KEYS.find((k) => layers[k]) ?? null;

  // Load coordinate arrays once per dataset.
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      loadDepthLevels(datasetName),
      loadTimeSteps(datasetName),
      loadLatLon(datasetName),
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
        onTimesChange?.(times);
      })
      .catch((err) => console.error("Failed to load Zarr coordinates:", err));
    loadModelInitTime(datasetName)
      .then((iso) => {
        if (!cancelled) onModelRunTimeChange?.(iso);
      })
      .catch((err) => console.error("Failed to load model run time:", err));
    return () => {
      cancelled = true;
    };
  }, [datasetName, onModelRunTimeChange, onTimesChange]);

  // Rebuild the colour raster whenever the active layer, depth, or time changes.
  useEffect(() => {
    if (!coords || !activeKey || !currentTime) {
      setRaster(null);
      setDynamicRange(null);
      return;
    }

    let cancelled = false;
    const { variable, min: configMin, max: configMax, colormap: colormapName } = RASTER_VARIABLES[activeKey];
    const isDynamic = DYNAMIC_RANGE_KEYS.has(activeKey);
    const timeIndex = findNearestIndex(coords.timesMs, new Date(currentTime).getTime());
    const depthIndex = findNearestIndex(coords.depths, depth);

    loadRasterSlice(datasetName, variable, { timeIndex, depthIndex })
      .then(({ data, height, width }) => {
        if (cancelled) return;

        let min = configMin;
        let max = configMax;
        if (isDynamic) {
          let dataMin = Infinity;
          let dataMax = -Infinity;
          let finiteCount = 0;
          for (let i = 0; i < data.length; i++) {
            const value = data[i];
            if (Number.isFinite(value)) {
              finiteCount++;
              if (value < dataMin) dataMin = value;
              if (value > dataMax) dataMax = value;
            }
          }
          if (dataMin <= dataMax && finiteCount > 0) {
            // A handful of cells can carry sentinel/fill values far outside the
            // real data range (e.g. land cells that should have been masked to
            // NaN but read back as exactly 0) — a literal min/max would let one
            // such cell wreck the whole colour scale. Bucket into a coarse
            // histogram and clip to the 1st/99th percentile instead — the same
            // robust-max approach already used for particle speed normalization
            // in WindAnimationOverlay, just without needing a full sort of
            // ~1.3M values every time the slice changes.
            const BIN_COUNT = 512;
            const span = dataMax - dataMin || 1;
            const bins = new Uint32Array(BIN_COUNT);
            for (let i = 0; i < data.length; i++) {
              const value = data[i];
              if (!Number.isFinite(value)) continue;
              const binIdx = Math.min(BIN_COUNT - 1, Math.floor(((value - dataMin) / span) * BIN_COUNT));
              bins[binIdx]++;
            }
            const lowTarget = finiteCount * 0.01;
            const highTarget = finiteCount * 0.99;
            let cumulative = 0;
            let lowBin = 0;
            let highBin = BIN_COUNT - 1;
            for (let b = 0; b < BIN_COUNT; b++) {
              cumulative += bins[b];
              if (cumulative >= lowTarget) { lowBin = b; break; }
            }
            cumulative = 0;
            for (let b = 0; b < BIN_COUNT; b++) {
              cumulative += bins[b];
              if (cumulative >= highTarget) { highBin = b; break; }
            }
            min = dataMin + (lowBin / BIN_COUNT) * span;
            max = dataMin + ((highBin + 1) / BIN_COUNT) * span;
          }
          setDynamicRange({ min, max });
        } else {
          setDynamicRange(null);
        }

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        const imageData = ctx.createImageData(width, height);
        // Precomputed 256-entry RGB table — looking up a pixel's color is now a
        // couple of array reads instead of re-running the colormap's branchy
        // math per pixel, which matters once playback is redrawing the raster
        // every ~400ms.
        const lut = getColormapLUT(colormapName);
        const lutMaxIndex = lut.length / 3 - 1;
        const range = max - min || 1;

        // The grid rows are evenly spaced in *latitude*, but deck.gl's
        // BitmapLayer paints the texture evenly in *Web-Mercator Y*. Over this
        // dataset's ~6° tall extent that mismatch slides the land mask ~3 km
        // (several cells) off the coastline near the island. Fix it by
        // resampling every output row to a uniform Mercator step, picking the
        // model row whose latitude actually falls there. Longitude needs no such
        // correction — it's linear in Mercator X — so columns map straight through.
        const latN = coords.lat.length;
        const lonN = coords.lon.length;
        const latStep = (coords.lat[latN - 1] - coords.lat[0]) / (latN - 1); // signed
        const lonStep = (coords.lon[lonN - 1] - coords.lon[0]) / (lonN - 1); // signed
        const lonAscending = lonStep > 0;

        // BitmapLayer bounds are the outer *edges* of the image, but lat/lon
        // hold cell *centres*; extend by half a cell so the raster isn't shifted
        // inward by half a grid cell.
        const latEdgeMin = Math.min(coords.lat[0], coords.lat[latN - 1]) - Math.abs(latStep) / 2;
        const latEdgeMax = Math.max(coords.lat[0], coords.lat[latN - 1]) + Math.abs(latStep) / 2;
        const lonEdgeMin = Math.min(coords.lon[0], coords.lon[lonN - 1]) - Math.abs(lonStep) / 2;
        const lonEdgeMax = Math.max(coords.lon[0], coords.lon[lonN - 1]) + Math.abs(lonStep) / 2;

        const d2r = Math.PI / 180;
        const mercY = (deg: number) => Math.log(Math.tan(Math.PI / 4 + (deg * d2r) / 2));
        const invMercY = (y: number) => (2 * Math.atan(Math.exp(y)) - Math.PI / 2) / d2r;
        const mercTop = mercY(latEdgeMax); // output row 0 = north
        const mercBot = mercY(latEdgeMin);

        for (let row = 0; row < height; row++) {
          // Latitude at this output row's Mercator centre, then the model row
          // whose cell that latitude lands in.
          const lat = invMercY(mercTop + ((row + 0.5) / height) * (mercBot - mercTop));
          const srcRow = Math.round((lat - coords.lat[0]) / latStep);
          const rowOff = row * width * 4;

          if (srcRow < 0 || srcRow >= latN) {
            for (let col = 0; col < width; col++) imageData.data[rowOff + col * 4 + 3] = 0;
            continue;
          }

          const srcRowOff = srcRow * width;
          for (let col = 0; col < width; col++) {
            const srcCol = lonAscending ? col : width - 1 - col;
            const value = data[srcRowOff + srcCol];
            const pixelIndex = rowOff + col * 4;

            if (!Number.isFinite(value)) {
              imageData.data[pixelIndex + 3] = 0;
              continue;
            }

            const t = Math.min(1, Math.max(0, (value - min) / range));
            const lutOffset = ((t * lutMaxIndex + 0.5) | 0) * 3;
            imageData.data[pixelIndex] = lut[lutOffset];
            imageData.data[pixelIndex + 1] = lut[lutOffset + 1];
            imageData.data[pixelIndex + 2] = lut[lutOffset + 2];
            imageData.data[pixelIndex + 3] = Math.round(0.85 * 255);
          }
        }

        ctx.putImageData(imageData, 0, 0);
        setRaster({
          canvas,
          bounds: [lonEdgeMin, latEdgeMin, lonEdgeMax, latEdgeMax],
        });
      })
      .catch((err) => console.error("Failed to load raster slice:", err));

    return () => {
      cancelled = true;
    };
  }, [coords, activeKey, depth, currentTime, datasetName]);

  // Drive a canvas-based flow-particle animation (u/v current vectors) on top
  // of the map while the velocity layer is active. This is a maplibre overlay
  // (not a deck.gl layer) so it can animate every frame without re-running
  // deck.gl's render pipeline.
  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map || !mapReady || activeKey !== "velocity" || !particlesEnabled) {
      windOverlayRef.current?.destroy();
      windOverlayRef.current = null;
      return;
    }

    const overlay = new WindAnimationOverlay(
      map,
      {
        datasetName,
        zarrBaseUrl: ZARR_BASE_URL,
        uVariable: "u",
        vVariable: "v",
        latVariable: "lat",
        lonVariable: "lon",
        speedFactor: BASE_PARTICLE_SPEED_FACTOR * particleSpeed,
        particleCount: 2000,
        particleSize: 2.6,
        minSpeed: 0,
        maxSpeed: 0.8,
      },
      particleMountRef.current ?? undefined,
    );
    windOverlayRef.current = overlay;

    return () => {
      overlay.destroy();
      windOverlayRef.current = null;
    };
    // particleSpeed is intentionally excluded: live speed changes are pushed
    // via setSpeedFactor() below instead of tearing down/reseeding particles.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, activeKey, particlesEnabled, datasetName]);

  // Adjust particle speed live without recreating the overlay (avoids a reseed/flicker).
  useEffect(() => {
    windOverlayRef.current?.setSpeedFactor(BASE_PARTICLE_SPEED_FACTOR * particleSpeed);
  }, [particleSpeed]);

  // Keep the particle field's time/depth in sync with the rest of the panel.
  useEffect(() => {
    if (!coords || !currentTime) return;
    const timeIndex = findNearestIndex(coords.timesMs, new Date(currentTime).getTime());
    windOverlayRef.current?.setTimeIndex(timeIndex);
  }, [coords, currentTime, activeKey]);

  useEffect(() => {
    if (!coords) return;
    const depthIndex = findNearestIndex(coords.depths, depth);
    windOverlayRef.current?.setDepthIndex(depthIndex);
  }, [coords, depth, activeKey]);

  const rasterLayer = useMemo(() => {
    if (!raster) return null;
    const [lonMin, latMin, lonMax, latMax] = raster.bounds;
    // deck.gl draws `bounds` as a single quad in continuous Mercator space —
    // it never wraps at ±180° the way MapLibre's own tiles do. For a dataset
    // that straddles the antimeridian (e.g. Tuvalu), once the camera pans/
    // zooms enough that its longitude is represented on the "other side" of
    // 180° from our fixed bounds, the quad ends up ~360° away from the
    // viewport — i.e. it vanishes. Re-anchor it to whichever 360°-shifted
    // copy is nearest the camera on every render (cheap arithmetic, no
    // re-decoding) so it stays visible regardless of how the camera wrapped.
    const lonCenter = (lonMin + lonMax) / 2;
    const offset = Math.round((viewState.longitude - lonCenter) / 360) * 360;
    return new BitmapLayer({
      id: "zarr-raster",
      image: raster.canvas,
      bounds: [lonMin + offset, latMin, lonMax + offset, latMax],
      opacity: 0.85,
    });
  }, [raster, viewState.longitude]);

  const markerLayer = useMemo(
    () =>
      probePoint
        ? new ScatterplotLayer({
            id: "probe-marker",
            data: [probePoint],
            // Same antimeridian re-anchoring as the raster: keep the marker's
            // single point glued to whichever 360°-shifted copy is nearest
            // the camera, instead of leaving it pinned to the wrap it was
            // clicked in.
            getPosition: (d: ProbePoint) => [
              d.lon + Math.round((viewState.longitude - d.lon) / 360) * 360,
              d.lat,
            ],
            getRadius: 8,
            radiusUnits: "pixels" as const,
            getFillColor: [255, 255, 255, 220],
            getLineColor: [59, 130, 246, 255],
            stroked: true,
            lineWidthMinPixels: 2,
            pickable: false,
          })
        : null,
    [probePoint, viewState.longitude]
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
  const legendGradient = useMemo(
    () => (activeLegend ? buildLegendGradient(activeLegend.colormap) : null),
    [activeLegend]
  );
  const legendMin = activeKey && dynamicRange ? dynamicRange.min : activeLegend?.min;
  const legendMax = activeKey && dynamicRange ? dynamicRange.max : activeLegend?.max;
  const formatLegendValue = (value: number) =>
    Number.isInteger(value) ? String(value) : value.toFixed(2);

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
          ref={mapRef}
          onLoad={() => setMapReady(true)}
          mapStyle={BASEMAPS.find((b) => b.key === basemap)!.style as string}
          style={{ width: "100%", height: "100%" }}
          attributionControl={{ compact: true }}
        />
      </DeckGL>

      {/* Mount point for the flow-particle canvas. Rendered as a sibling after
          DeckGL (not inside the map container) so it stacks above deck.gl's own
          canvas via normal DOM-order painting — z-index alone can't do this
          since the two canvases don't share a stacking context. */}
      <div ref={particleMountRef} className="absolute inset-0 pointer-events-none" />

      {/* Legend colorbar — for the single active raster layer */}
      {activeLegend && (
        <div className="absolute bottom-4 left-4 pointer-events-none select-none">
          <div className="bg-[#1a1f2e]/90 rounded-lg px-3 py-2 border border-[#2d3748]">
            <p className="text-[11px] text-slate-300 mb-1.5 font-medium">{activeLegend.label}</p>
            <div className="h-3 w-44 rounded" style={{ background: legendGradient ?? undefined }} />
            <div className="flex justify-between mt-1">
              <span className="text-[9px] text-slate-400">{legendMin !== undefined ? formatLegendValue(legendMin) : ""}</span>
              <span className="text-[9px] text-slate-400">{legendMax !== undefined ? formatLegendValue(legendMax) : ""}</span>
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
