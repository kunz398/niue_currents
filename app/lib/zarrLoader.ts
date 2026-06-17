/**
 * zarrLoader.ts
 * ─────────────
 * Reads coordinate arrays (depth, time) from a Zarr v2 store served as
 * static files.  The base URL comes from `layers.config.ts` so there is
 * exactly one place to change when switching local ↔ remote storage.
 */

import { HTTPStore, openArray } from "zarr";
import { ZARR_BASE_URL } from "./layers.config";

/* ------------------------------------------------------------------ */
/*  Store cache – avoid reopening the same dataset repeatedly          */
/* ------------------------------------------------------------------ */
const storeCache = new Map<string, HTTPStore>();

/**
 * Open (or reuse) an HTTPStore for a dataset under the zarr base URL.
 *
 * @param datasetName  
 * @param baseUrl      
 */
export function getStore(
  datasetName: string,
  baseUrl: string = ZARR_BASE_URL
): HTTPStore {
  // Guarantee exactly one slash between base and dataset name
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  // zarr.js's HTTPStore does `new URL(root)` with no base, so a root that's
  // just a path (e.g. "/niue-current/zarr-data/...") throws "Invalid URL".
  // Resolve it against the page origin first; absolute URLs pass through unchanged.
  const resolvedBase =
    typeof window !== "undefined" && window.location?.origin
      ? new URL(normalizedBase, window.location.origin).toString()
      : normalizedBase;
  const url = `${resolvedBase}${datasetName}`;
  let store = storeCache.get(url);
  if (!store) {
    store = new HTTPStore(url, { fetchOptions: { mode: "cors" } });
    storeCache.set(url, store);
  }
  return store;
}

/* ------------------------------------------------------------------ */
/*  Array cache – avoid reopening the same array repeatedly            */
/* ------------------------------------------------------------------ */
const arrayCache = new Map<string, Promise<import("zarr").ZarrArray>>();

/**
 * Open (or reuse) a Zarr array under a dataset.
 */
export function getArray(
  datasetName: string,
  variable: string,
  baseUrl?: string
) {
  const store = getStore(datasetName, baseUrl);
  const key = `${store.url}/${variable}`;
  let promise = arrayCache.get(key);
  if (!promise) {
    promise = openArray({ store, path: variable, mode: "r" }).catch((e: Error) => {
      arrayCache.delete(key);
      throw new Error(
        `Failed to open "${variable}" array in "${datasetName}". ` +
        `Check that ${store.url}/${variable}/.zarray exists and is reachable. Original: ${e.message}`
      );
    });
    arrayCache.set(key, promise);
  }
  return promise;
}

/**
 * Load a 1-D coordinate array (depth, lat, lon, ...) as plain numbers.
 */
async function loadCoordinateArray(
  datasetName: string,
  variable: string,
  baseUrl?: string
): Promise<number[]> {
  const arr = await getArray(datasetName, variable, baseUrl);
  const raw = await arr.get(null);

  // zarr.js returns a NestedArray — flatten to a plain number[]
  const data = raw.data as ArrayLike<number>;
  return Array.from(data);
}

/* ------------------------------------------------------------------ */
/*  Depth loader                                                       */
/* ------------------------------------------------------------------ */

/**
 * Load the `depth` coordinate array from a Zarr dataset.
 * Returns an array of depth values in meters (negative = below surface).
 */
export async function loadDepthLevels(
  datasetName: string,
  baseUrl?: string
): Promise<number[]> {
  return loadCoordinateArray(datasetName, "depth", baseUrl);
}

/* ------------------------------------------------------------------ */
/*  Lat / lon loader                                                   */
/* ------------------------------------------------------------------ */

/**
 * Load the `lat`/`lon` rectilinear coordinate arrays from a Zarr dataset.
 * `lon` is normalized to -180..180 — this dataset stores it as 0..360
 * (e.g. ~191° for Niue), but map clicks/viewport use -180..180.
 */
export async function loadLatLon(
  datasetName: string,
  baseUrl?: string
): Promise<{ lat: number[]; lon: number[] }> {
  const [lat, lon] = await Promise.all([
    loadCoordinateArray(datasetName, "lat", baseUrl),
    loadCoordinateArray(datasetName, "lon", baseUrl),
  ]);
  return { lat, lon: lon.map((v) => (v > 180 ? v - 360 : v)) };
}

/**
 * Index of the value in `values` closest to `target`.
 */
export function findNearestIndex(values: number[], target: number): number {
  let bestIndex = 0;
  let bestDist = Infinity;
  for (let i = 0; i < values.length; i++) {
    const dist = Math.abs(values[i] - target);
    if (dist < bestDist) {
      bestDist = dist;
      bestIndex = i;
    }
  }
  return bestIndex;
}

/* ------------------------------------------------------------------ */
/*  Time loader                                                        */
/* ------------------------------------------------------------------ */

/**
 * Parse the CF-style `units` attribute ("hours since YYYY-MM-DD HH:MM:SS")
 * and return the epoch milliseconds of the reference date.
 */
function parseTimeUnits(units: string): { factor: number; epochMs: number } {
  // e.g. "hours since 2026-06-16 00:00:00"
  const match = units.match(
    /^(seconds|minutes|hours|days)\s+since\s+(.+)$/i
  );
  if (!match) {
    throw new Error(`Cannot parse time units: "${units}"`);
  }

  const unitStr = match[1].toLowerCase();
  const epochMs = new Date(match[2].trim()).getTime();

  const FACTORS: Record<string, number> = {
    seconds: 1_000,
    minutes: 60_000,
    hours: 3_600_000,
    days: 86_400_000,
  };

  return { factor: FACTORS[unitStr], epochMs };
}

/**
 * Load the `time` coordinate array and convert to ISO-8601 strings.
 */
export async function loadTimeSteps(
  datasetName: string,
  baseUrl?: string
): Promise<string[]> {
  const arr = await getArray(datasetName, "time", baseUrl);

  // Read the `units` attribute so we know the reference epoch
  const attrs = await arr.attrs.asObject();
  const units: string = attrs.units ?? "hours since 2026-06-16 00:00:00";
  const { factor, epochMs } = parseTimeUnits(units);

  const raw = await arr.get(null);
  const data = raw.data as ArrayLike<number>;

  return Array.from(data).map((offset) => {
    const ms = epochMs + offset * factor;
    return new Date(ms).toISOString();
  });
}

/* ------------------------------------------------------------------ */
/*  Point readers – profile (all depths) / time series (all times)     */
/* ------------------------------------------------------------------ */

interface PointSelector {
  lon: number;
  lat: number;
}

/**
 * Read a vertical profile (one value per depth level) of `variable` at the
 * grid cell nearest to `lon`/`lat`, for a single time step.
 */
export async function loadProfileAtPoint(
  datasetName: string,
  variable: string,
  { timeIndex, lon, lat }: PointSelector & { timeIndex: number },
  baseUrl?: string
): Promise<number[]> {
  const [arr, { lat: latValues, lon: lonValues }] = await Promise.all([
    getArray(datasetName, variable, baseUrl),
    loadLatLon(datasetName, baseUrl),
  ]);
  const latIdx = findNearestIndex(latValues, lat);
  const lonIdx = findNearestIndex(lonValues, lon);

  const raw = await arr.get([timeIndex, null, latIdx, lonIdx]);
  return Array.from(raw.data as ArrayLike<number>);
}

/**
 * Read a full time series (one value per time step) of `variable` at the
 * grid cell nearest to `lon`/`lat`, for a single depth level.
 */
export async function loadTimeSeriesAtPoint(
  datasetName: string,
  variable: string,
  { depthIndex, lon, lat }: PointSelector & { depthIndex: number },
  baseUrl?: string
): Promise<number[]> {
  const [arr, { lat: latValues, lon: lonValues }] = await Promise.all([
    getArray(datasetName, variable, baseUrl),
    loadLatLon(datasetName, baseUrl),
  ]);
  const latIdx = findNearestIndex(latValues, lat);
  const lonIdx = findNearestIndex(lonValues, lon);

  const raw = await arr.get([null, depthIndex, latIdx, lonIdx]);
  return Array.from(raw.data as ArrayLike<number>);
}

/* ------------------------------------------------------------------ */
/*  Raster reader – full lat/lon slice for a single time (+ depth)     */
/* ------------------------------------------------------------------ */

export interface RasterSlice {
  data: Float32Array;
  height: number;
  width: number;
}

/**
 * Read a full lat/lon grid slice of `variable` for one time step
 * (and, when the variable has a depth axis, one depth level).
 */
export async function loadRasterSlice(
  datasetName: string,
  variable: string,
  { timeIndex, depthIndex }: { timeIndex: number; depthIndex: number },
  baseUrl?: string
): Promise<RasterSlice> {
  const arr = await getArray(datasetName, variable, baseUrl);
  const selection =
    arr.shape.length === 4
      ? [timeIndex, depthIndex, null, null]
      : [timeIndex, null, null];

  const raw = await arr.get(selection);
  const [height, width] = raw.shape;

  // For a 2-D get(), zarr.js's NestedArray.data is an array of per-row
  // typed arrays, not one flat array — flatten it ourselves.
  const rows = raw.data as ArrayLike<ArrayLike<number>>;
  const data = new Float32Array(height * width);
  for (let row = 0; row < height; row++) {
    data.set(rows[row], row * width);
  }
  return { data, height, width };
}
