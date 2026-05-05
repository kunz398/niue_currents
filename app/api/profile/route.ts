import { type NextRequest, NextResponse } from "next/server";

const WMS_BASE =
  "https://gemthreddshpc.spc.int/thredds/wms/POP/model/country/spc/forecast/hourly/NIU_Currents/d1_temp_salt_uv_z_all.nc";

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const lon = params.get("lon") ?? "";
  const lat = params.get("lat") ?? "";
  const time = params.get("time") ?? "";
  const layer = params.get("layer") ?? "temperature";

  // WMS GetVerticalProfile returns JSON with depth/value pairs
  const upstream =
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
    `&VERSION=1.3.0`;

  const res = await fetch(upstream, { next: { revalidate: 3600 } });

  if (!res.ok) {
    return new NextResponse(`Profile error: ${res.status}`, { status: res.status });
  }

  const json = await res.json();
  return NextResponse.json(json, {
    headers: { "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400" },
  });
}
