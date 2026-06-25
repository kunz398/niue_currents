import type { Metadata } from "next";
import OceanViewer from "../components/OceanViewer";

export const metadata: Metadata = {
  title: "Niue Ocean Circulation Forecast (CROCO)",
  description: "Ocean forecast for Niue – temperature, salinity, currents",
};

export default function NiueCurrentPage() {
  return <OceanViewer />;
}
