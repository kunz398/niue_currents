import { type NextRequest, NextResponse } from "next/server";

const WMS_BASE =
  "https://gemthreddshpc.spc.int/thredds/wms/POP/model/country/spc/forecast/hourly/NIU_Currents/d1_temp_salt_uv_z_all.nc";

export async function GET(req: NextRequest) {
  // Pass the raw search string; decode %2F→/ so STYLES "raster/psu-viridis" reaches THREDDS intact
  const upstream = `${WMS_BASE}${req.nextUrl.search.replace(/%2F/gi, "/")}`;

  const res = await fetch(upstream, { next: { revalidate: 3600 } });

  if (!res.ok) {
    // Return a transparent 1×1 PNG so BitmapLayer doesn't crash
    const transparent1x1 = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
      "base64"
    );
    console.error(`[wms] upstream error ${res.status}: ${upstream}`);
    return new NextResponse(transparent1x1, {
      status: 200,
      headers: { "Content-Type": "image/png", "Cache-Control": "no-store" },
    });
  }

  const contentType = res.headers.get("content-type") ?? "image/png";
  const body = await res.arrayBuffer();

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
    },
  });
}
