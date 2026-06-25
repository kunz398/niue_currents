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
import { CROCO_DATASET, loadDepthLevels, loadTimeSteps, loadTimeSeriesAtPoint, findNearestIndex } from "../../lib/zarrLoader";

interface TSPoint {
  timeLabel: string;
  value: number;
  value2?: number;
}

interface Props {
  probePoint: ProbePoint | null;
  depth: DepthLevel;
  availableTimes: string[];
  layer?: string;
  label?: string;
  layer2?: string;
  label2?: string;
  datasetName?: string;
}

function formatLabel(iso: string, firstIso: string): string {
  const t0 = new Date(firstIso).getTime();
  const t = new Date(iso).getTime();
  const diffH = Math.round((t - t0) / 3_600_000);
  return `T+${diffH}h`;
}

export default function TimeSeries({
  probePoint,
  depth,
  availableTimes,
  layer = "temperature",
  label = "Temp (°C)",
  layer2,
  label2,
  datasetName = CROCO_DATASET,
}: Props) {
  const [data, setData] = useState<TSPoint[]>([]);
  const [loading, setLoading] = useState(false);
  const hasRequestContext = Boolean(probePoint) && availableTimes.length > 0;

  useEffect(() => {
    if (!probePoint || availableTimes.length === 0) {
      return;
    }
    let cancelled = false;
    queueMicrotask(() => setLoading(true));

    Promise.all([loadDepthLevels(datasetName), loadTimeSteps(datasetName)])
      .then(([depths, times]) => {
        const depthIndex = findNearestIndex(depths, depth);
        const firstTime = times[0];

        function fetchLayer(variable: string): Promise<TSPoint[]> {
          return loadTimeSeriesAtPoint(datasetName, variable, {
            depthIndex,
            lon: probePoint!.lon,
            lat: probePoint!.lat,
          }).then((values) =>
            times.map((t, i) => ({
              timeLabel: formatLabel(t, firstTime),
              value: values[i],
            }))
          );
        }

        return Promise.all([fetchLayer(layer), layer2 ? fetchLayer(layer2) : Promise.resolve(null)]);
      })
      .then(([primary, secondary]) => {
        if (cancelled) return;
        const merged: TSPoint[] = primary.map((pt, i) => ({
          ...pt,
          value2: secondary?.[i]?.value,
        }));
        setData(merged);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setData([]);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [probePoint, depth, availableTimes, layer, layer2, datasetName]);

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

  if (!hasRequestContext || data.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-slate-500 text-xs">
        No time series data
      </div>
    );
  }

  const isVelocity = layer === "u" || layer === "v";
  const yMin = isVelocity
    ? -1
    : data.length > 0
    ? Math.floor(Math.min(...data.map((d) => d.value)))
    : layer === "temperature"
    ? 22
    : layer === "salinity"
    ? 32
    : "auto";
  const yMax = isVelocity ? 1 : "auto";

  return (
    <ResponsiveContainer width="100%" height={155}>
      <LineChart data={data} margin={{ top: 8, right: 16, bottom: 20, left: 24 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#2d3748" />
        <XAxis
          dataKey="timeLabel"
          tick={{ fill: "#94a3b8", fontSize: 10 }}
          label={{ value: "Forecast time", position: "insideBottomRight", fill: "#94a3b8", fontSize: 10, dy: 12 }}
        />
        <YAxis
          domain={[yMin, yMax]}
          tick={{ fill: "#94a3b8", fontSize: 10 }}
          label={{ value: label, angle: -90, position: "insideLeft", fill: "#94a3b8", fontSize: 10, dx: -10 }}
        />
        <Tooltip
          contentStyle={{ background: "#1a1f2e", border: "1px solid #2d3748", fontSize: 11 }}
          labelStyle={{ color: "#94a3b8" }}
          itemStyle={{ color: "#e2e8f0" }}
          formatter={(v: unknown, name: string | number | undefined) => [
            (v as number).toFixed(2),
            name === "value2" ? (label2 ?? "V (m/s)") : label,
          ]}
        />
        <Line
          type="monotone"
          dataKey="value"
          name="value"
          stroke="#ef4444"
          strokeWidth={2}
          dot={false}
        />
        {layer2 && (
          <Line
            type="monotone"
            dataKey="value2"
            name="value2"
            stroke="#60a5fa"
            strokeWidth={2}
            dot={false}
          />
        )}
      </LineChart>
    </ResponsiveContainer>
  );
}
