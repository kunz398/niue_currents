"use client";

import { useEffect, useRef, useState } from "react";
import type { ProbePoint } from "../OceanViewer";

const DEPTHS = [-5, -10, -20, -30, -50, -100, -300, -500, -1000];

// Viridis colour scale approximation (temp range 24–30°C)
function tempToColor(value: number, min = 24, max = 30): [number, number, number] {
  const t = Math.max(0, Math.min(1, (value - min) / (max - min)));
  // Simple blue → green → yellow → red ramp
  const r = Math.round(Math.min(255, t * 2 * 255));
  const g = Math.round(Math.min(255, (t < 0.5 ? t * 2 : 2 - t * 2) * 255));
  const b = Math.round(Math.max(0, (1 - t * 2) * 255));
  return [r, g, b];
}

interface HovData {
  // [depthIdx][timeIdx] = temperature value
  grid: (number | null)[][];
  times: string[];
}

interface Props {
  probePoint: ProbePoint | null;
  availableTimes: string[];
}

export default function Hovmoller({ probePoint, availableTimes }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hovData, setHovData] = useState<HovData | null>(null);
  const [loading, setLoading] = useState(false);
  const hasRequestContext = Boolean(probePoint) && availableTimes.length > 0;

  useEffect(() => {
    if (!probePoint || availableTimes.length === 0) {
      return;
    }
    const abortCtrl = new AbortController();
    queueMicrotask(() => setLoading(true));

    // Fetch time series at each depth in parallel
    const fetchDepth = (depth: number) => {
      const params = new URLSearchParams({
        lon: String(probePoint.lon),
        lat: String(probePoint.lat),
        depth: String(depth),
        startTime: availableTimes[0],
        endTime: availableTimes[availableTimes.length - 1],
        layer: "temperature",
      });
      return fetch(`${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/timeseries?${params.toString()}`, {
        signal: abortCtrl.signal,
      })
        .then((r) => r.json())
        .then((json) => {
          let values: (number | null)[] = [];
          if (json?.times && json?.values) {
            values = json.values as number[];
          } else if (Array.isArray(json)) {
            values = json.map((p: { value?: number }) => p.value ?? null);
          } else if (json?.data) {
            values = Object.values(json.data) as number[];
          }
          return values;
        })
        .catch(() => [] as (number | null)[]);
    };

    Promise.all(DEPTHS.map((d) => fetchDepth(d)))
      .then((rows) => {
        setHovData({ grid: rows, times: availableTimes });
        setLoading(false);
      })
      .catch(() => setLoading(false));

    return () => abortCtrl.abort();
  }, [probePoint, availableTimes]);

  // Draw on canvas whenever data changes
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !hovData) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const { grid, times } = hovData;
    const nTimes = times.length;
    const nDepths = DEPTHS.length;

    canvas.width = canvas.offsetWidth * window.devicePixelRatio;
    canvas.height = canvas.offsetHeight * window.devicePixelRatio;
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

    const W = canvas.offsetWidth;
    const H = canvas.offsetHeight;
    const cellW = W / nTimes;
    const cellH = H / nDepths;

    ctx.clearRect(0, 0, W, H);

    for (let di = 0; di < nDepths; di++) {
      for (let ti = 0; ti < nTimes; ti++) {
        const val = grid[di]?.[ti];
        if (val == null || isNaN(val as number)) {
          ctx.fillStyle = "#1a1f2e";
        } else {
          const [r, g, b] = tempToColor(val as number);
          ctx.fillStyle = `rgb(${r},${g},${b})`;
        }
        ctx.fillRect(ti * cellW, di * cellH, cellW + 1, cellH + 1);
      }
    }

    // Y-axis labels (depth)
    ctx.fillStyle = "#94a3b8";
    ctx.font = `${10 * window.devicePixelRatio}px sans-serif`;
    ctx.scale(1 / window.devicePixelRatio, 1 / window.devicePixelRatio);
    for (let di = 0; di < nDepths; di++) {
      ctx.fillText(
        `${DEPTHS[di]}m`,
        2,
        (di * cellH + cellH / 2 + 4) * window.devicePixelRatio
      );
    }
  }, [hovData]);

  if (!probePoint) {
    return (
      <div className="flex items-center justify-center h-full text-slate-500 text-xs text-center px-4">
        Click the map for Hovmöller
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-slate-500 text-xs">
        Loading Hovmöller…
      </div>
    );
  }

  if (!hasRequestContext || !hovData) {
    return (
      <div className="flex items-center justify-center h-full text-slate-500 text-xs">
        No data
      </div>
    );
  }

  return (
    <div className="relative w-full h-full">
      <canvas ref={canvasRef} className="w-full h-full" />
      {/* X-axis labels */}
      <div className="absolute bottom-0 left-0 right-0 flex justify-between text-[9px] text-slate-500 px-2 pb-0.5">
        <span>T+0</span>
        <span>T+{hovData.times.length - 1}h</span>
      </div>
    </div>
  );
}
