import { type NextRequest, NextResponse } from "next/server";

const NCSS_BASE =
  "https://gemthreddshpc.spc.int/thredds/ncss/grid/POP/model/country/spc/forecast/hourly/NIU_Currents/d1_temp_salt_uv_z_all.nc";

// Domain bounding box
const DOMAIN = {
  north: -16.436661124726577,
  south: -22.654609684513026,
  east: -165.84291076660156,
  west: -172.1634979248047,
};


const STEP = 1.0;

interface ArrowPoint {
  lon: number;
  lat: number;
  u: number;
  v: number;
  speed: number;
}

function parseNcssPointCsv(csv: string): ArrowPoint | null {
  const lines = csv.trim().split("\n");
  if (lines.length < 2) return null;

  const headerIdx = lines.findIndex((l) => !l.startsWith("#") && l.includes(","));
  if (headerIdx === -1) return null;

  const headers = lines[headerIdx].split(",").map((h) => h.trim().toLowerCase());
  const lonIdx = headers.findIndex((h) => h.includes("longitude"));
  const latIdx = headers.findIndex((h) => h.includes("latitude"));
  const uIdx = headers.findIndex((h) => h.startsWith("u[") || h === "u");
  const vIdx = headers.findIndex((h) => h.startsWith("v[") || h === "v");

  if (lonIdx === -1 || latIdx === -1 || uIdx === -1 || vIdx === -1) return null;

  const dataLine = lines[headerIdx + 1];
  if (!dataLine) return null;

  const parts = dataLine.split(",");
  const lon = parseFloat(parts[lonIdx]);
  const lat = parseFloat(parts[latIdx]);
  const u = parseFloat(parts[uIdx]);
  const v = parseFloat(parts[vIdx]);
  if (isNaN(lon) || isNaN(lat) || isNaN(u) || isNaN(v)) return null;
  return { lon, lat, u, v, speed: Math.sqrt(u * u + v * v) };
}

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const time = params.get("time") ?? "";
  const depth = params.get("depth") ?? "-5";

  // Build sample grid of lat/lon points across the domain
  const samplePoints: { lat: number; lon: number }[] = [];
  for (let lat = DOMAIN.south; lat <= DOMAIN.north + 0.01; lat += STEP) {
    for (let lon = DOMAIN.west; lon <= DOMAIN.east + 0.01; lon += STEP) {
      samplePoints.push({
        lat: Math.round(lat * 100) / 100,
        lon: Math.round(lon * 100) / 100,
      });
    }
  }

  // Fetch each point in parallel — NCSS only supports CSV for point (lat/lon) queries
  const results = await Promise.all(
    samplePoints.map(async ({ lat, lon }) => {
      const url =
        `${NCSS_BASE}?var=u&var=v` +
        `&latitude=${lat}&longitude=${lon}` +
        `&accept=csv` +
        (time ? `&time=${encodeURIComponent(time)}` : "") +
        (depth ? `&vertCoord=${depth}` : "");
      try {
        const res = await fetch(url, { next: { revalidate: 60 } });
        if (!res.ok) return null;
        const csv = await res.text();
        return parseNcssPointCsv(csv);
      } catch {
        return null;
      }
    })
  );

  const points = results.filter((p): p is ArrowPoint => p !== null);

  return NextResponse.json(points, {
    headers: { "Cache-Control": "public, max-age=60" },
  });
}

