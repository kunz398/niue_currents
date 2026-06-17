"use client";

import { useEffect, useState } from "react";
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Cell,
  ReferenceDot,
} from "recharts";
import type { ProbePoint } from "../OceanViewer";
import { loadDepthLevels, loadTimeSteps, loadProfileAtPoint, findNearestIndex } from "../../lib/zarrLoader";

const DATASET_NAME = "d1_temp_salt_uv_z_all.zarr";

interface TSDataPoint {
  depth: number;
  temperature: number | null;
  salinity: number | null;
}

interface WaterMassPoint {
  key: string;
  x: number;
  y: number;
  label: string;
  labelPosition: "top" | "bottom" | "left" | "right";
  labelOffset?: number;
}

// Known water masses expected around Niue and their T-S signatures.
const WATER_MASSES: WaterMassPoint[] = [
  { key: "SPTW", x: 35.6, y: 24, label: "SPTW", labelPosition: "top", labelOffset: 12 },
  { key: "SPEW", x: 35.2, y: 21, label: "SPEW", labelPosition: "top", labelOffset: 10 },
  { key: "AAIW", x: 34.4, y: 5, label: "AAIW", labelPosition: "right", labelOffset: 10 },
  { key: "SAMW", x: 34.5, y: 8, label: "SAMW", labelPosition: "top", labelOffset: 10 },
  { key: "PDW", x: 34.6, y: 2, label: "PDW", labelPosition: "left", labelOffset: 10 },
  { key: "LCDW", x: 34.7, y: 1.5, label: "LCDW", labelPosition: "right", labelOffset: 10 },
];

// Map depth to a colour in the same style as the depth picker
const DEPTH_COLOUR_MAP: Record<string, string> = {
  "-5": "#ef4444",
  "-10": "#f97316",
  "-20": "#eab308",
  "-30": "#22c55e",
  "-50": "#14b8a6",
  "-100": "#3b82f6",
  "-300": "#8b5cf6",
  "-500": "#ec4899",
  "-1000": "#94a3b8",
};

function depthColour(depth: number): string {
  const key = String(depth);
  return DEPTH_COLOUR_MAP[key] ?? "#94a3b8";
}

interface Props {
  probePoint: ProbePoint | null;
  currentTime: string | null;
}

export default function TSDiagram({ probePoint, currentTime }: Props) {
  const [data, setData] = useState<TSDataPoint[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!probePoint || !currentTime) {
      return;
    }
    // Debounce: wait 600ms after last change before firing
    let cancelled = false;
    const timer = setTimeout(() => {
      setLoading(true);

      Promise.all([loadDepthLevels(DATASET_NAME), loadTimeSteps(DATASET_NAME)])
        .then(async ([depths, times]) => {
          const timeIndex = findNearestIndex(
            times.map((t) => new Date(t).getTime()),
            new Date(currentTime).getTime()
          );
          const [temperature, salinity] = await Promise.all([
            loadProfileAtPoint(DATASET_NAME, "temperature", { timeIndex, lon: probePoint.lon, lat: probePoint.lat }),
            loadProfileAtPoint(DATASET_NAME, "salinity", { timeIndex, lon: probePoint.lon, lat: probePoint.lat }),
          ]);
          return depths.map((d, i) => ({
            depth: d,
            temperature: temperature[i] ?? null,
            salinity: salinity[i] ?? null,
          }));
        })
        .then((points) => {
          if (cancelled) return;
          setData(points);
          setLoading(false);
        })
        .catch(() => { if (!cancelled) setLoading(false); });
    }, 600);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [probePoint, currentTime]);

  if (!probePoint) {
    return (
      <div className="flex items-center justify-center h-full text-slate-500 text-xs text-center px-4">
        Click the map to inspect a point
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-slate-500 text-xs">
        Loading…
      </div>
    );
  }

  const validData = data.filter(
    (d) => d.temperature !== null && d.salinity !== null
  );

  if (validData.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-slate-500 text-xs">
        No T-S data
      </div>
    );
  }

  const scatterData = validData.map((d) => ({
    x: d.salinity as number,
    y: d.temperature as number,
    depth: d.depth,
  }));

  return (
    <ResponsiveContainer width="100%" height={155}>
      <ScatterChart margin={{ top: 8, right: 16, bottom: 20, left: 24 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#2d3748" />
        <XAxis
          type="number"
          dataKey="x"
          name="Salinity"
          tick={{ fill: "#94a3b8", fontSize: 10 }}
          label={{ value: "Salinity (PSU)", position: "insideBottomRight", fill: "#94a3b8", fontSize: 10, dy: 12 }}
          domain={[34, 37]}
        />
        <YAxis
          type="number"
          dataKey="y"
          name="Temperature"
          tick={{ fill: "#94a3b8", fontSize: 10 }}
          label={{ value: "Temp (°C)", angle: -90, position: "insideLeft", fill: "#94a3b8", fontSize: 10, dx: -10 }}
          domain={[0, 32]}
        />
        <Tooltip
          contentStyle={{ background: "#1a1f2e", border: "1px solid #2d3748", fontSize: 11 }}
          cursor={{ strokeDasharray: "3 3" }}
          content={({ payload }) => {
            if (!payload?.length) return null;
            const d = payload[0].payload;
            return (
              <div className="bg-[#1a1f2e] border border-[#2d3748] px-2 py-1.5 text-[11px]">
                <p className="text-slate-400">Depth: {d.depth} m</p>
                <p className="text-slate-200">Temp: {d.y.toFixed(2)} °C</p>
                <p className="text-slate-200">Salinity: {d.x.toFixed(2)} PSU</p>
              </div>
            );
          }}
        />
        <Scatter data={scatterData} fill="#94a3b8">
          {scatterData.map((entry, index) => (
            <Cell key={`cell-${index}`} fill={depthColour(entry.depth)} />
          ))}
        </Scatter>
        {WATER_MASSES.map((wm) => (
          <ReferenceDot
            key={wm.key}
            x={wm.x}
            y={wm.y}
            r={4}
            fill="#0b1220"
            stroke="#e2e8f0"
            strokeWidth={1.2}
            ifOverflow="visible"
            label={{
              value: wm.label,
              position: wm.labelPosition,
              offset: wm.labelOffset ?? 8,
              fill: "#cbd5e1",
              fontSize: 10,
              fontWeight: 600,
            }}
          />
        ))}
      </ScatterChart>
    </ResponsiveContainer>
  );
}
