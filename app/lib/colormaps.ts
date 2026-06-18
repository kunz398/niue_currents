export type RGB = readonly [number, number, number];

export type ColormapName = "jet" | "red-blue" | "viridis";

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function lerpRgb(a: RGB, b: RGB, t: number): RGB {
  return [
    Math.round(lerp(a[0], b[0], t)),
    Math.round(lerp(a[1], b[1], t)),
    Math.round(lerp(a[2], b[2], t)),
  ] as const;
}

function jet(t: number): RGB {
  const x = clamp01(t);
  const r = Math.round(clamp01(1.5 - Math.abs(4 * x - 3)) * 255);
  const g = Math.round(clamp01(1.5 - Math.abs(4 * x - 2)) * 255);
  const b = Math.round(clamp01(1.5 - Math.abs(4 * x - 1)) * 255);
  return [r, g, b] as const;
}

function redBlue(t: number): RGB {
  const x = clamp01(t);
  const blue: RGB = [0, 0, 255];
  const white: RGB = [255, 255, 255];
  const red: RGB = [255, 0, 0];

  if (x <= 0.5) {
    return lerpRgb(blue, white, x / 0.5);
  }

  return lerpRgb(white, red, (x - 0.5) / 0.5);
}

// Perceptually-uniform sequential ramp (violet -> blue -> teal -> green -> yellow),
// sampled from the standard "viridis" colormap. Good default for ordered scalar
// fields like salinity where a diverging red/blue scale would wrongly imply a
// midpoint, and a strict luminance ramp also reads correctly in grayscale.
const VIRIDIS_STOPS: readonly RGB[] = [
  [68, 1, 84],
  [72, 40, 120],
  [62, 74, 137],
  [49, 104, 142],
  [38, 130, 142],
  [31, 158, 137],
  [53, 183, 121],
  [109, 205, 89],
  [180, 222, 44],
  [253, 231, 37],
];

function viridis(t: number): RGB {
  const x = clamp01(t);
  const lastIndex = VIRIDIS_STOPS.length - 1;
  const scaled = x * lastIndex;
  const i = Math.min(lastIndex - 1, Math.floor(scaled));
  return lerpRgb(VIRIDIS_STOPS[i], VIRIDIS_STOPS[i + 1], scaled - i);
}

export function normalizeColormapName(value: unknown): ColormapName | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "jet") {
    return "jet";
  }

  if (normalized === "red-blue" || normalized === "redblue" || normalized === "red_blue") {
    return "red-blue";
  }

  if (normalized === "viridis") {
    return "viridis";
  }

  return null;
}

export function getColormap(name: unknown): (t: number) => RGB {
  const normalized = normalizeColormapName(name) ?? "jet";

  switch (normalized) {
    case "red-blue":
      return redBlue;
    case "viridis":
      return viridis;
    case "jet":
    default:
      return jet;
  }
}

const LUT_SIZE = 256;
const lutCache = new Map<ColormapName, Uint8Array>();

/**
 * A 256-entry RGB lookup table for a colormap, used to recolor large rasters
 * without re-running the (branchy) colormap math per pixel. Built once per
 * colormap and cached — there are only ever a handful of distinct colormaps.
 */
export function getColormapLUT(name: unknown): Uint8Array {
  const normalized = normalizeColormapName(name) ?? "jet";
  const cached = lutCache.get(normalized);
  if (cached) return cached;

  const fn = getColormap(normalized);
  const lut = new Uint8Array(LUT_SIZE * 3);
  for (let i = 0; i < LUT_SIZE; i++) {
    const [r, g, b] = fn(i / (LUT_SIZE - 1));
    lut[i * 3] = r;
    lut[i * 3 + 1] = g;
    lut[i * 3 + 2] = b;
  }
  lutCache.set(normalized, lut);
  return lut;
}
