import type { Metadata } from "next";
import OceanViewer from "../components/OceanViewer";

export const metadata: Metadata = {
  title: "Tuvalu Ocean Circulation Forecast (CROCO)",
  description: "Ocean forecast for Tuvalu – temperature, salinity, currents",
};

// Funafuti, Tuvalu
const TUV_INITIAL_VIEW = {
  longitude: 179.1942,
  latitude: -8.5167,
  zoom: 7,
  pitch: 0,
  bearing: 0,
};

export default function TuvCurrentPage() {
  return (
    <OceanViewer
      title="Tuvalu Ocean Circulation Forecast"
      datasetName="tuv_d1_temp_salt_uv_z_all"
      initialView={TUV_INITIAL_VIEW}
      disabledLayers={["seaSurfaceHeight"]}
    />
  );
}
