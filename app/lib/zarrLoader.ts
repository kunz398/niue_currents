/**
 * zarrLoader.ts
 * ─────────────
 * Reads coordinate arrays (depth, time) from a Zarr v2 store served as
 * static files.  The base URL comes from `layers.config.ts` so there is
 * exactly one place to change when switching local ↔ remote storage.
 */

import { HTTPStore, openArray } from "zarr";
import { ZARR_BASE_URL } from "./layers.config";

/**
 * zarr's HTTPStore calls the bare global `fetch` per chunk with no retry —
 * a single transient 5xx (Wasabi does serve these intermittently) aborts
 * the whole multi-chunk read. That's most visible on requests that fan out
 * into many small chunk fetches (e.g. a full time-series-at-a-point query,
 * one request per timestep) — the more chunks, the more chances to hit a
 * blip. Patch the global fetch once with retry-with-backoff for transient
 * statuses so those reads recover instead of failing outright.
 */
if (typeof window !== "undefined" && !(window as { __retryFetchPatched?: boolean }).__retryFetchPatched) {
  const originalFetch = window.fetch.bind(window);
  const RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);
  const MAX_RETRIES = 3;
  const BASE_DELAY_MS = 300;

  window.fetch = async (input, init) => {
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await originalFetch(input, init);
        if (res.ok || !RETRYABLE_STATUSES.has(res.status) || attempt >= MAX_RETRIES) return res;
      } catch (err) {
        if (attempt >= MAX_RETRIES) throw err;
      }
      await new Promise((r) => setTimeout(r, BASE_DELAY_MS * 2 ** attempt));
    }
  };
  (window as { __retryFetchPatched?: boolean }).__retryFetchPatched = true;
}

export const CROCO_DATASET = "d1_temp_salt_uv_z_all.zarr";

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
    // cache: "no-cache" forces a conditional revalidation (If-None-Match/
    // If-Modified-Since) on every request instead of trusting the browser's
    // HTTP cache freshness heuristics — without it, a forecast re-run that
    // overwrites the same S3 keys can sit invisible behind a stale cached
    // response until the user hard-refreshes. S3 honors conditional GETs, so
    // unchanged chunks still come back as a cheap 304.
    store = new HTTPStore(url, { fetchOptions: { mode: "cors", cache: "no-cache" } });
    storeCache.set(url, store);
  }
  return store;
}

/* ------------------------------------------------------------------ */
/*  Array cache – avoid reopening the same array repeatedly            */
/* ------------------------------------------------------------------ */
const arrayCache = new Map<string, Promise<import("zarr").ZarrArray>>();
const consolidatedMetadataCache = new Map<string, Promise<Record<string, unknown> | null>>();

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
    promise = openArray({ store, path: variable, mode: "r" })
      .catch(async (e: Error) => {
        // Some published stores ship consolidated metadata in .zmetadata but
        // don't expose per-array .zarray/.zattrs files. Fall back to a virtual
        // metadata view so openArray can still resolve array metadata.
        const consolidatedStore = await getConsolidatedMetadataStore(store, variable);
        if (!consolidatedStore) {
          throw e;
        }
        return openArray({ store: consolidatedStore, path: variable, mode: "r" });
      })
      .catch((e: Error) => {
        arrayCache.delete(key);
        throw new Error(
          `Failed to open "${variable}" array in "${datasetName}". ` +
          `Checked both direct metadata (${store.url}/${variable}/.zarray) and consolidated metadata (${store.url}/.zmetadata). ` +
          `Original: ${e.message}`
        );
      });
    arrayCache.set(key, promise);
  }
  return promise;
}

async function loadConsolidatedMetadata(store: HTTPStore): Promise<Record<string, unknown> | null> {
  const key = `${store.url}/.zmetadata`;
  let promise = consolidatedMetadataCache.get(key);
  if (!promise) {
    promise = fetch(key, { cache: "no-cache" })
      .then(async (response) => {
        if (!response.ok) return null;
        const parsed = (await response.json()) as { metadata?: unknown };
        if (!parsed || typeof parsed !== "object" || !parsed.metadata || typeof parsed.metadata !== "object") {
          return null;
        }
        return parsed.metadata as Record<string, unknown>;
      })
      .catch(() => null);
    consolidatedMetadataCache.set(key, promise);
  }
  return promise;
}

function encodeJson(value: unknown): ArrayBuffer {
  return new TextEncoder().encode(JSON.stringify(value)).buffer;
}

function normalizeStoreKey(item: string): string {
  return item.replace(/^\/+/, "");
}

async function getConsolidatedMetadataStore(
  store: HTTPStore,
  variable: string
): Promise<{
  url: string;
  keys: () => Promise<string[]>;
  getItem: (item: string, opts?: RequestInit) => Promise<ArrayBuffer>;
  setItem: (item: string, value: string | ArrayBuffer) => Promise<boolean>;
  deleteItem: (item: string) => Promise<boolean>;
  containsItem: (item: string) => Promise<boolean>;
} | null> {
  const metadata = await loadConsolidatedMetadata(store);
  if (!metadata) return null;

  const variableZarrayKey = `${variable}/.zarray`;
  const variableZattrsKey = `${variable}/.zattrs`;
  if (!(variableZarrayKey in metadata)) {
    return null;
  }

  const virtualMetadata = new Map<string, ArrayBuffer>();
  const keysToInject = [
    ".zgroup",
    ".zattrs",
    variableZarrayKey,
    variableZattrsKey,
  ];

  for (const k of keysToInject) {
    if (k in metadata) {
      virtualMetadata.set(k, encodeJson(metadata[k]));
    }
  }

  return {
    url: store.url,
    keys: () => store.keys(),
    getItem: async (item: string, opts?: RequestInit) => {
      const normalized = normalizeStoreKey(item);
      const injected = virtualMetadata.get(normalized);
      if (injected) return injected;
      return store.getItem(normalized, opts);
    },
    setItem: (item, value) => store.setItem(item, value),
    deleteItem: (item) => store.deleteItem(item),
    containsItem: async (item: string) => {
      const normalized = normalizeStoreKey(item);
      if (virtualMetadata.has(normalized)) return true;
      return store.containsItem(normalized);
    },
  };
}

/**
 * Decoded-data cache, keyed by store URL + variable. `getArray` only caches
 * the array *handle* (metadata) — without this, every call below would
 * re-fetch and re-decode every chunk of a coordinate array from scratch
 * (99 separate chunk requests for `time`, since its chunk size is 1).
 */
const dataCache = new Map<string, Promise<unknown>>();
const availabilityCache = new Map<string, Promise<boolean>>();

function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  let promise = dataCache.get(key) as Promise<T> | undefined;
  if (!promise) {
    promise = load().catch((e) => {
      dataCache.delete(key);
      throw e;
    });
    dataCache.set(key, promise);
  }
  return promise;
}

type JsonObject = Record<string, unknown>;

function parseIsoToMs(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  // Keep only millisecond precision so dates like ...000000000 parse reliably.
  const normalized = trimmed.replace(/\.(\d{3})\d+/, ".$1");
  const ms = Date.parse(normalized);
  return Number.isFinite(ms) ? ms : null;
}

async function fetchJson(path: string): Promise<JsonObject> {
  const response = await fetch(path, { cache: "no-cache" });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return (await response.json()) as JsonObject;
}

async function loadDatasetAttrs(datasetName: string, baseUrl?: string): Promise<JsonObject> {
  const store = getStore(datasetName, baseUrl);
  const key = `${store.url}/.zattrs`;
  return cached(key, () => fetchJson(key));
}

interface ArrayMetadata {
  shape?: number[];
}

async function loadArrayMetadata(
  datasetName: string,
  variable: string,
  baseUrl?: string
): Promise<ArrayMetadata> {
  const store = getStore(datasetName, baseUrl);
  const key = `${store.url}/${variable}/.zarray`;
  return cached(key, () => fetchJson(key)) as Promise<ArrayMetadata>;
}

async function inferTimeCountFromVariables(
  datasetName: string,
  baseUrl?: string
): Promise<number | null> {
  const candidates = ["temperature", "salinity", "current_speed"];
  for (const variable of candidates) {
    try {
      const meta = await loadArrayMetadata(datasetName, variable, baseUrl);
      const count = meta.shape?.[0];
      if (typeof count === "number" && Number.isFinite(count) && count > 0) {
        return count;
      }
    } catch {
      // Try next candidate.
    }
  }
  return null;
}

async function buildFallbackTimeSteps(
  datasetName: string,
  baseUrl?: string
): Promise<string[]> {
  const attrs = await loadDatasetAttrs(datasetName, baseUrl);
  const startMs = parseIsoToMs(attrs.time_coverage_start);
  const endMs = parseIsoToMs(attrs.time_coverage_end);
  const count = await inferTimeCountFromVariables(datasetName, baseUrl);

  if (!startMs || !count || count <= 0) {
    throw new Error(
      `Dataset "${datasetName}" has no readable time coordinate and insufficient fallback metadata.`
    );
  }

  if (count === 1) {
    return [new Date(startMs).toISOString()];
  }

  const stepMs = endMs && endMs > startMs
    ? (endMs - startMs) / (count - 1)
    : 60 * 60 * 1000;

  return Array.from({ length: count }, (_, i) =>
    new Date(startMs + i * stepMs).toISOString()
  );
}

export function hasArray(
  datasetName: string,
  variable: string,
  baseUrl?: string
): Promise<boolean> {
  const store = getStore(datasetName, baseUrl);
  const url = `${store.url}/${variable}/.zarray`;
  let promise = availabilityCache.get(url);
  if (!promise) {
    promise = (async () => {
      try {
        const head = await fetch(url, { method: "HEAD", cache: "no-cache" });
        if (head.ok) return true;
      } catch {
        // Some hosts block HEAD; fall back to GET.
      }
      try {
        const get = await fetch(url, { cache: "no-cache" });
        return get.ok;
      } catch {
        return false;
      }
    })();
    availabilityCache.set(url, promise);
  }
  return promise;
}

/**
 * Load a 1-D coordinate array (depth, lat, lon, ...) as plain numbers.
 */
function loadCoordinateArray(
  datasetName: string,
  variable: string,
  baseUrl?: string
): Promise<number[]> {
  const key = `${getStore(datasetName, baseUrl).url}/${variable}`;
  return cached(key, async () => {
    const arr = await getArray(datasetName, variable, baseUrl);
    const raw = await arr.get(null);

    // zarr.js returns a NestedArray — flatten to a plain number[]
    const data = raw.data as ArrayLike<number>;
    return Array.from(data);
  });
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
 * Datasets store `lon` in 0..360 (e.g. Niue is ~188-194°, entirely past the
 * antimeridian). We fold those down to -180..180 since map clicks/viewport
 * use that range — but only when the *whole* axis is past 180°. A domain
 * that straddles the antimeridian (e.g. Tuvalu, ~172-184°) is already
 * monotonic in raw 0..360; folding only its >180 tail would make it jump
 * from +180 to -180 mid-array and corrupt every linear-spacing calculation
 * downstream (lonStep, BitmapLayer bounds, etc.), so leave it unwrapped.
 */
export async function loadLatLon(
  datasetName: string,
  baseUrl?: string
): Promise<{ lat: number[]; lon: number[] }> {
  const [lat, lon] = await Promise.all([
    loadCoordinateArray(datasetName, "lat", baseUrl),
    loadCoordinateArray(datasetName, "lon", baseUrl),
  ]);
  const allPastAntimeridian = lon.every((v) => v > 180);
  return { lat, lon: allPastAntimeridian ? lon.map((v) => v - 360) : lon };
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
  // CF reference dates are UTC, but a space-separated "YYYY-MM-DD HH:MM:SS"
  // string (no "Z"/offset) is parsed by Date as *local* time — force UTC by
  // rewriting it into a proper ISO-8601 UTC string before parsing.
  const epochMs = new Date(`${match[2].trim().replace(" ", "T")}Z`).getTime();

  const FACTORS: Record<string, number> = {
    seconds: 1_000,
    minutes: 60_000,
    hours: 3_600_000,
    days: 86_400_000,
  };

  return { factor: FACTORS[unitStr], epochMs };
}

/**
 * Read the time variable's CF `units` attribute ("hours since <reference>")
 * and return that reference date as an ISO-8601 string — this is the
 * model's initialization/run time, not a forecast time step.
 */
export function loadModelInitTime(
  datasetName: string,
  baseUrl?: string
): Promise<string> {
  const key = `${getStore(datasetName, baseUrl).url}/time:init`;
  return cached(key, async () => {
    try {
      const arr = await getArray(datasetName, "time", baseUrl);
      const attrs = await arr.attrs.asObject();
      const units: string = attrs.units ?? "hours since 2026-06-16 00:00:00";
      const { epochMs } = parseTimeUnits(units);
      return new Date(epochMs).toISOString();
    } catch {
      const datasetAttrs = await loadDatasetAttrs(datasetName, baseUrl);
      const fallbackMs = parseIsoToMs(datasetAttrs.time_coverage_start);
      if (!fallbackMs) {
        throw new Error(
          `Failed to infer model init time for "${datasetName}" (missing time array and time_coverage_start).`
        );
      }
      return new Date(fallbackMs).toISOString();
    }
  });
}

/**
 * Load the `time` coordinate array and convert to ISO-8601 strings.
 */
export function loadTimeSteps(
  datasetName: string,
  baseUrl?: string
): Promise<string[]> {
  const key = `${getStore(datasetName, baseUrl).url}/time:iso`;
  return cached(key, async () => {
    try {
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
    } catch {
      return buildFallbackTimeSteps(datasetName, baseUrl);
    }
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

// Playback loops back over the same handful of time steps (and the timeline
// scrubber revisits indices too), so cache decoded slices keyed by exactly
// what they depend on. Bounded so a long session doesn't grow unboundedly —
// evict the oldest entry (Map preserves insertion order) once full.
const RASTER_SLICE_CACHE_LIMIT = 80;
const rasterSliceCache = new Map<string, Promise<RasterSlice>>();

/**
 * Read a full lat/lon grid slice of `variable` for one time step
 * (and, when the variable has a depth axis, one depth level).
 */
export function loadRasterSlice(
  datasetName: string,
  variable: string,
  { timeIndex, depthIndex }: { timeIndex: number; depthIndex: number },
  baseUrl?: string
): Promise<RasterSlice> {
  const key = `${getStore(datasetName, baseUrl).url}/${variable}/${timeIndex}/${depthIndex}`;
  const cached = rasterSliceCache.get(key);
  if (cached) return cached;

  const promise = (async () => {
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
  })().catch((e) => {
    rasterSliceCache.delete(key);
    throw e;
  });

  rasterSliceCache.set(key, promise);
  if (rasterSliceCache.size > RASTER_SLICE_CACHE_LIMIT) {
    const oldestKey = rasterSliceCache.keys().next().value;
    if (oldestKey !== undefined && oldestKey !== key) {
      rasterSliceCache.delete(oldestKey);
    }
  }
  return promise;
}
