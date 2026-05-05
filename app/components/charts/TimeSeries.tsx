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

interface TSPoint {
  timeLabel: string;
  value: number;
}

interface Props {
  probePoint: ProbePoint | null;
  depth: DepthLevel;
  availableTimes: string[];
  layer?: string;
  label?: string;
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
}: Props) {
  const [data, setData] = useState<TSPoint[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!probePoint || availableTimes.length === 0) {
      setData([]);
      return;
    }
    setLoading(true);
    const abortCtrl = new AbortController();
    const startTime = availableTimes[0];
    const endTime = availableTimes[availableTimes.length - 1];

    const params = new URLSearchParams({
      lon: String(probePoint.lon),
      lat: String(probePoint.lat),
      depth: String(depth),
      startTime,
      endTime,
      layer,
    });
    fetch(`/api/timeseries?${params.toString()}`, { signal: abortCtrl.signal })
      .then((r) => r.json())
      .then((json) => {
        let points: TSPoint[] = [];
        // ncWMS returns CovJSON PointSeries: domain.axes.t.values + ranges[layer].values
        if (json?.domain?.axes?.t?.values && json?.ranges) {
          const times: string[] = json.domain.axes.t.values;
          const rangeKey = Object.keys(json.ranges)[0];
          const values: (number | null)[] = json.ranges[rangeKey]?.values ?? [];
          points = times.map((t: string, i: number) => ({
            timeLabel: formatLabel(t, startTime),
            value: values[i] ?? 0,
          }));
        } else if (json?.times && json?.values) {
          points = (json.times as string[]).map((t: string, i: number) => ({
            timeLabel: formatLabel(t, startTime),
            value: (json.values as number[])[i],
          }));
        } else if (Array.isArray(json)) {
          points = json.map((p: { time?: string; t?: string; value?: number }) => ({
            timeLabel: formatLabel(p.time ?? p.t ?? startTime, startTime),
            value: p.value ?? 0,
          }));
        } else if (json?.data) {
          points = Object.entries(json.data).map(([t, v]) => ({
            timeLabel: formatLabel(t, startTime),
            value: v as number,
          }));
        }
        setData(points);
        setLoading(false);
      })
      .catch(() => setLoading(false));
    return () => abortCtrl.abort();
  }, [probePoint, depth, availableTimes, layer]);

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
        No time series data
      </div>
    );
  }

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
          tick={{ fill: "#94a3b8", fontSize: 10 }}
          label={{ value: label, angle: -90, position: "insideLeft", fill: "#94a3b8", fontSize: 10, dx: -10 }}
        />
        <Tooltip
          contentStyle={{ background: "#1a1f2e", border: "1px solid #2d3748", fontSize: 11 }}
          labelStyle={{ color: "#94a3b8" }}
          itemStyle={{ color: "#e2e8f0" }}
          formatter={(v: unknown) => [(v as number).toFixed(2), label]}
        />
        <Line
          type="monotone"
          dataKey="value"
          stroke="#3b82f6"
          strokeWidth={2}
          dot={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
