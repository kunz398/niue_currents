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
import type { ProbePoint } from "../OceanViewer";
import { CROCO_DATASET, loadDepthLevels, loadTimeSteps, loadProfileAtPoint, findNearestIndex } from "../../lib/zarrLoader";

interface ProfilePoint {
  depth: number;
  value: number;
  value2?: number;
}

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
      return;
    }
    // Debounce: wait 600ms after last change before firing (avoids firing on every animation step)
    let cancelled = false;
    const timer = setTimeout(() => {
      setLoading(true);

      Promise.all([loadDepthLevels(CROCO_DATASET), loadTimeSteps(CROCO_DATASET)])
        .then(([depths, times]) => {
          const timeIndex = findNearestIndex(
            times.map((t) => new Date(t).getTime()),
            new Date(currentTime!).getTime()
          );

          function fetchLayer(variable: string): Promise<ProfilePoint[]> {
            return loadProfileAtPoint(CROCO_DATASET, variable, {
              timeIndex,
              lon: probePoint!.lon,
              lat: probePoint!.lat,
            }).then((values) =>
              depths
                .map((d, i) => ({ depth: d, value: values[i] }))
                .sort((a, b) => a.depth - b.depth)
            );
          }

          const fetchU = fetchLayer(layer);
          const fetchV: Promise<ProfilePoint[] | null> =
            layer === "u" ? fetchLayer("v") : Promise.resolve(null);

          return Promise.allSettled([fetchU, fetchV]);
        })
        .then(([uResult, vResult]) => {
          if (cancelled) return;
          const uPts = uResult.status === "fulfilled" ? uResult.value : [];
          const vPts =
            vResult.status === "fulfilled"
              ? vResult.value
              : null;

          if (vPts) {
            // Merge v values onto u points by matching depth
            const vMap = new Map(vPts.map((p) => [p.depth, p.value]));
            setData(uPts.map((p) => ({ ...p, value2: vMap.get(p.depth) })));
          } else {
            setData(uPts);
          }
          setLoading(false);
        })
        .catch(() => { if (!cancelled) setLoading(false); });
    }, 600);
    return () => { cancelled = true; clearTimeout(timer); };
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

  if (!currentTime) {
    return (
      <div className="flex items-center justify-center h-full text-slate-500 text-xs">
        No profile data
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
          label={{ value: layer === "u" ? "Velocity (m/s)" : label, position: "insideBottom", fill: "#94a3b8", fontSize: 10, dy: 12 }}
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
          formatter={(v: unknown, name?: string | number) => [(v as number).toFixed(3), name ?? ""]}
          labelFormatter={(d: unknown) => `${d} m`}
        />
        <Line
          type="monotone"
          dataKey="value"
          name={layer === "u" ? "U (m/s)" : label}
          stroke="#ef4444"
          strokeWidth={2}
          dot={{ fill: "#ef4444", r: 3 }}
        />
        {layer === "u" && (
          <Line
            type="monotone"
            dataKey="value2"
            name="V (m/s)"
            stroke="#60a5fa"
            strokeWidth={2}
            dot={{ fill: "#60a5fa", r: 3 }}
          />
        )}
      </LineChart>
    </ResponsiveContainer>
  );
}
