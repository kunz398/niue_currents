import { type NextRequest, NextResponse } from "next/server";

const WMS_BASE =
  "https://gemthreddshpc.spc.int/thredds/wms/POP/model/country/spc/forecast/hourly/NIU_Currents/d1_temp_salt_uv_z_all.nc";

function buildTimeseriesUrl({
  lon,
  lat,
  depth,
  layer,
  infoFormat,
  startTime,
  endTime,
}: {
  lon: string;
  lat: string;
  depth: string;
  layer: string;
  infoFormat: string;
  startTime?: string;
  endTime?: string;
}) {
  return (
    `${WMS_BASE}?SERVICE=WMS&REQUEST=GetTimeseries` +
    `&LAYERS=${encodeURIComponent(layer)}` +
    `&CRS=CRS:84` +
    `&BBOX=${lon},${lat},${lon},${lat}` +
    `&WIDTH=1&HEIGHT=1` +
    `&INFO_FORMAT=${infoFormat}` +
    `&QUERY_LAYERS=${encodeURIComponent(layer)}` +
    `&I=0&J=0` +
    `&FORMAT=image/png` +
    `&ELEVATION=${encodeURIComponent(depth)}` +
    (startTime && endTime
      ? `&TIME=${encodeURIComponent(startTime)}/${encodeURIComponent(endTime)}`
      : "") +
    `&VERSION=1.3.0`
  );
}

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const lon = params.get("lon") ?? "";
  const lat = params.get("lat") ?? "";
  const depth = params.get("depth") ?? "-5";
  const startTime = params.get("startTime") ?? "";
  const endTime = params.get("endTime") ?? "";
  const layer = params.get("layer") ?? "temperature";

  const VALID_INFO_FORMATS: Record<string, string> = {
    "application/prs.coverage+json": "application/prs.coverage%2Bjson",
    "text/csv": "text/csv",
    "image/png": "image/png",
  };
  const requestedFormat = params.get("infoFormat") ?? "application/prs.coverage+json";
  const infoFormat = VALID_INFO_FORMATS[requestedFormat] ?? "application/prs.coverage%2Bjson";

  const upstreamWithTime = buildTimeseriesUrl({
    lon,
    lat,
    depth,
    layer,
    infoFormat,
    startTime,
    endTime,
  });

  let res = await fetch(upstreamWithTime, { next: { revalidate: 3600 } });

  // Some layers return 404 for requested TIME windows with no coverage.
  // Retry without TIME to get the server's available timeseries instead.
  if (!res.ok && res.status === 404 && startTime && endTime) {
    const upstreamNoTime = buildTimeseriesUrl({
      lon,
      lat,
      depth,
      layer,
      infoFormat,
    });
    res = await fetch(upstreamNoTime, { next: { revalidate: 3600 } });
  }

  if (!res.ok) {
    if (res.status === 404) {
      return NextResponse.json({ times: [], values: [] }, {
        headers: { "Cache-Control": "public, max-age=300" },
      });
    }
    return new NextResponse(`Timeseries error: ${res.status}`, { status: res.status });
  }

  const json = await res.json();
  return NextResponse.json(json, {
    headers: { "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400" },
  });
}
