import { type NextRequest, NextResponse } from "next/server";

const WMS_BASE =
  "https://gemthreddshpc.spc.int/thredds/wms/POP/model/country/spc/forecast/hourly/NIU_Currents/d1_temp_salt_uv_z_all.nc";

interface TSPoint {
  depth: number;
  temperature: number | null;
  salinity: number | null;
}

async function fetchProfile(
  layer: string,
  lon: string,
  lat: string,
  time: string
): Promise<Array<{ depth: number; value: number }>> {
  const upstream =
    `${WMS_BASE}?REQUEST=GetVerticalProfile` +
    `&LAYERS=${encodeURIComponent(layer)}` +
    `&CRS=CRS:84` +
    `&BBOX=${lon},${lat},${lon},${lat}` +
    `&WIDTH=1&HEIGHT=1` +
    `&INFO_FORMAT=application/prs.coverage%2Bjson` +
    `&QUERY_LAYERS=${encodeURIComponent(layer)}` +
    `&I=0&J=0` +
    `&FORMAT=image/png` +
    (time ? `&TIME=${encodeURIComponent(time)}` : "") +
    `&VERSION=1.3.0`;

  const res = await fetch(upstream, { next: { revalidate: 3600 } });
  if (!res.ok) return [];

  const json = await res.json();
  // ncWMS returns CovJSON VerticalProfile format
  if (json?.domain?.axes?.z?.values && json?.ranges) {
    const zVals: number[] = json.domain.axes.z.values;
    const rangeKey = Object.keys(json.ranges)[0];
    const vals: (number | null)[] = json.ranges[rangeKey]?.values ?? [];
    return zVals.map((z: number, i: number) => ({ depth: z, value: vals[i] ?? 0 }));
  }
  if (Array.isArray(json)) {
    return json.map((p: { depth?: number; z?: number; value: number }) => ({
      depth: p.depth ?? p.z ?? 0,
      value: p.value,
    }));
  }
  return [];
}

async function fetchProfileWithFallback(
  layer: string,
  lon: string,
  lat: string,
  time: string
): Promise<Array<{ depth: number; value: number }>> {
  const withRequestedTime = await fetchProfile(layer, lon, lat, time);
  if (withRequestedTime.length > 0 || !time) {
    return withRequestedTime;
  }

  // Fallback: some layers have different timestep catalogs. If the requested
  // TIME is missing for temp/salinity, ask ncWMS for nearest/default profile.
  return fetchProfile(layer, lon, lat, "");
}

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const lon = params.get("lon") ?? "";
  const lat = params.get("lat") ?? "";
  const time = params.get("time") ?? "";

  const [tempData, saltData] = await Promise.all([
    fetchProfileWithFallback("temperature", lon, lat, time),
    fetchProfileWithFallback("salinity", lon, lat, time),
  ]);

  // Merge by depth
  const depthMap = new Map<number, TSPoint>();

  for (const t of tempData) {
    depthMap.set(t.depth, {
      depth: t.depth,
      temperature: t.value,
      salinity: null,
    });
  }
  for (const s of saltData) {
    const existing = depthMap.get(s.depth);
    if (existing) {
      existing.salinity = s.value;
    } else {
      depthMap.set(s.depth, {
        depth: s.depth,
        temperature: null,
        salinity: s.value,
      });
    }
  }

  const result = Array.from(depthMap.values()).sort((a, b) => a.depth - b.depth);

  return NextResponse.json(result, {
    headers: { "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400" },
  });
}
