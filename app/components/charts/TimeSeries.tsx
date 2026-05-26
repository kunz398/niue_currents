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

    function fetchLayer(lyr: string): Promise<TSPoint[]> {
      const params = new URLSearchParams({
        lon: String(probePoint!.lon),
        lat: String(probePoint!.lat),
        depth: String(depth),
        startTime,
        endTime,
        layer: lyr,
      });
      return fetch(`${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/timeseries?${params.toString()}`, { signal: abortCtrl.signal })
        .then(async (r) => {
          if (!r.ok) {
            const message = await r.text().catch(() => "");
            throw new Error(message || `Timeseries request failed (${r.status})`);
          }
          return r.json();
        })
        .then((json) => {
          let points: TSPoint[] = [];
          if (json?.domain?.axes?.t?.values && json?.ranges) {
            const times: string[] = json.domain.axes.t.values;
            const rangeKey = Object.keys(json.ranges)[0];
            const values: (number | null)[] = json.ranges[rangeKey]?.values ?? [];
            const firstReturnedTime = times[0] ?? startTime;
            points = times.map((t: string, i: number) => ({
              timeLabel: formatLabel(t, firstReturnedTime),
              value: values[i] ?? 0,
            }));
          } else if (json?.times && json?.values) {
            const times = json.times as string[];
            const firstReturnedTime = times[0] ?? startTime;
            points = times.map((t: string, i: number) => ({
              timeLabel: formatLabel(t, firstReturnedTime),
              value: (json.values as number[])[i],
            }));
          } else if (Array.isArray(json)) {
            const firstReturnedTime = json[0]?.time ?? json[0]?.t ?? startTime;
            points = json.map((p: { time?: string; t?: string; value?: number }) => ({
              timeLabel: formatLabel(p.time ?? p.t ?? firstReturnedTime, firstReturnedTime),
              value: p.value ?? 0,
            }));
          } else if (json?.data) {
            const entries = Object.entries(json.data);
            const firstReturnedTime = entries[0]?.[0] ?? startTime;
            points = entries.map(([t, v]) => ({
              timeLabel: formatLabel(t, firstReturnedTime),
              value: v as number,
            }));
          }
          return points;
        });
    }

    const fetches: [Promise<TSPoint[]>, Promise<TSPoint[]> | null] = [
      fetchLayer(layer),
      layer2 ? fetchLayer(layer2) : null,
    ];

    Promise.all(fetches.map((p) => p ?? Promise.resolve([])))
      .then(([primary, secondary]) => {
        const merged: TSPoint[] = primary.map((pt, i) => ({
          ...pt,
          value2: secondary[i]?.value,
        }));
        setData(merged);
        setLoading(false);
      })
      .catch(() => {
        setData([]);
        setLoading(false);
      });
    return () => abortCtrl.abort();
  }, [probePoint, depth, availableTimes, layer, layer2]);

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
