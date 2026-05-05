import { type NextRequest, NextResponse } from "next/server";

const WMS_BASE =
  "https://gemthreddshpc.spc.int/thredds/wms/POP/model/country/spc/forecast/hourly/NIU_Currents/d1_temp_salt_uv_z_all.nc";

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const upstream = `${WMS_BASE}?request=GetMetadata&${params.toString()}`;

  const res = await fetch(upstream, { next: { revalidate: 300 } });

  if (!res.ok) {
    return new NextResponse(`Metadata error: ${res.status}`, {
      status: res.status,
    });
  }

  const json = await res.json();
  return NextResponse.json(json, {
    headers: { "Cache-Control": "public, max-age=300" },
  });
}
