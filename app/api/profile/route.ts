import { type NextRequest, NextResponse } from "next/server";

const WMS_BASE =
  "https://gemthreddshpc.spc.int/thredds/wms/POP/model/country/spc/forecast/hourly/NIU_Currents/d1_temp_salt_uv_z_all.nc";

function buildProfileUrl(layer: string, lon: string, lat: string, time: string): string {
  return (
    `${WMS_BASE}?SERVICE=WMS&REQUEST=GetVerticalProfile` +
    `&LAYERS=${encodeURIComponent(layer)}` +
    `&CRS=CRS:84` +
    `&BBOX=${lon},${lat},${lon},${lat}` +
    `&WIDTH=1&HEIGHT=1` +
    `&INFO_FORMAT=application/prs.coverage%2Bjson` +
    `&QUERY_LAYERS=${encodeURIComponent(layer)}` +
    `&I=0&J=0` +
    `&FORMAT=image/png` +
    (time ? `&TIME=${encodeURIComponent(time)}` : "") +
    `&VERSION=1.3.0`
  );
}

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const lon = params.get("lon") ?? "";
  const lat = params.get("lat") ?? "";
  const time = params.get("time") ?? "";
  const layer = params.get("layer") ?? "temperature";

  let res = await fetch(buildProfileUrl(layer, lon, lat, time), { next: { revalidate: 3600 } });
  if (!res.ok && time) {
    // Some variables can have slightly different time catalogs.
    // Retry without TIME so charts still show nearest/default profile.
    res = await fetch(buildProfileUrl(layer, lon, lat, ""), { next: { revalidate: 3600 } });
  }

  if (!res.ok) {
    return NextResponse.json([], {
      headers: { "Cache-Control": "public, max-age=60, stale-while-revalidate=300" },
    });
  }

  const json = await res.json();
  return NextResponse.json(json, {
    headers: { "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400" },
  });
}
