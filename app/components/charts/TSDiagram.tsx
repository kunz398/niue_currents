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
} from "recharts";
import type { ProbePoint } from "../OceanViewer";

interface TSDataPoint {
  depth: number;
  temperature: number | null;
  salinity: number | null;
}

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
      setData([]);
      return;
    }
    // Debounce: wait 600ms after last change before firing
    const abortCtrl = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      const params = new URLSearchParams({
        lon: String(probePoint.lon),
        lat: String(probePoint.lat),
        time: currentTime,
      });
      fetch(`/api/tsdata?${params.toString()}`, { signal: abortCtrl.signal })
        .then((r) => r.json())
        .then((json: TSDataPoint[]) => {
          setData(Array.isArray(json) ? json : []);
          setLoading(false);
        })
        .catch(() => setLoading(false));
    }, 600);
    return () => { clearTimeout(timer); abortCtrl.abort(); };
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
          domain={["auto", "auto"]}
        />
        <YAxis
          type="number"
          dataKey="y"
          name="Temperature"
          tick={{ fill: "#94a3b8", fontSize: 10 }}
          label={{ value: "Temp (°C)", angle: -90, position: "insideLeft", fill: "#94a3b8", fontSize: 10, dx: -10 }}
          domain={["auto", "auto"]}
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
      </ScatterChart>
    </ResponsiveContainer>
  );
}
