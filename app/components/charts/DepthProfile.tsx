"use client";

import { useEffect, useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import type { DepthLevel, ProbePoint } from "../OceanViewer";

interface ProfilePoint {
  depth: number;
  value: number;
}

// Depth colour scale (matches depth picker colours roughly)
const DEPTH_COLOURS: Record<number, string> = {
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

interface Props {
  probePoint: ProbePoint | null;
  currentTime: string | null;
  layer?: string;
  label?: string;
}

export default function DepthProfile({
  probePoint,
  currentTime,
  layer = "temperature",
  label = "Temp (°C)",
}: Props) {
  const [data, setData] = useState<ProfilePoint[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!probePoint || !currentTime) {
      setData([]);
      return;
    }
    // Debounce: wait 600ms after last change before firing (avoids firing on every animation step)
    const abortCtrl = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
    const params = new URLSearchParams({
      lon: String(probePoint.lon),
      lat: String(probePoint.lat),
      time: currentTime,
      layer,
    });
    fetch(`${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/profile?${params.toString()}`, { signal: abortCtrl.signal })
      .then((r) => r.json())
      .then((json) => {
        // Handle ncWMS vertical profile response shapes
        let points: ProfilePoint[] = [];
        if (Array.isArray(json)) {
          points = json.map((p: { depth?: number; z?: number; value?: number; elevation?: number }) => ({
            depth: p.depth ?? p.z ?? p.elevation ?? 0,
            value: p.value ?? 0,
          }));
        } else if (json?.domain?.axes?.z && json?.ranges) {
          const zVals: number[] = json.domain.axes.z.values ?? [];
          const rangeValues: number[] = Object.values<{ values: number[] }>(json.ranges)[0]?.values ?? [];
          points = zVals.map((z: number, i: number) => ({ depth: z, value: rangeValues[i] ?? 0 }));
        } else if (json?.data) {
          points = Object.entries(json.data).map(([z, v]) => ({
            depth: parseFloat(z),
            value: v as number,
          }));
        }
        setData(points.sort((a, b) => a.depth - b.depth));
        setLoading(false);
      })
      .catch(() => setLoading(false));
    }, 600);
    return () => { clearTimeout(timer); abortCtrl.abort(); };
  }, [probePoint, currentTime, layer]);

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

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-slate-500 text-xs">
        No profile data
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={155}>
      <LineChart
        data={data}
        layout="vertical"
        margin={{ top: 8, right: 16, bottom: 8, left: 24 }}
      >
        <CartesianGrid strokeDasharray="3 3" stroke="#2d3748" />
        <XAxis
          type="number"
          dataKey="value"
          domain={layer === "u" ? [-2, 2] : layer === "salinity" ? [32, "auto"] : ["auto", "auto"]}
          tick={{ fill: "#94a3b8", fontSize: 10 }}
          label={{ value: label, position: "insideBottom", fill: "#94a3b8", fontSize: 10, dy: 12 }}
        />
        <YAxis
          type="number"
          dataKey="depth"
          reversed
          tick={{ fill: "#94a3b8", fontSize: 10 }}
          label={{ value: "Depth (m)", angle: -90, position: "insideLeft", fill: "#94a3b8", fontSize: 10, dx: -10 }}
        />
        <Tooltip
          contentStyle={{ background: "#1a1f2e", border: "1px solid #2d3748", fontSize: 11 }}
          labelStyle={{ color: "#94a3b8" }}
          itemStyle={{ color: "#e2e8f0" }}
          formatter={(v: unknown) => [(v as number).toFixed(2), label]}
          labelFormatter={(d: unknown) => `${d} m`}
        />
        <Line
          type="monotone"
          dataKey="value"
          stroke="#ef4444"
          strokeWidth={2}
          dot={{ fill: "#ef4444", r: 3 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
