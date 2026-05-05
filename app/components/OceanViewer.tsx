"use client";

import { useState, useEffect, useCallback } from "react";
import dynamic from "next/dynamic";
import ControlBar from "./ControlBar";
import LayersPanel from "./LayersPanel";
import BottomPanel from "./BottomPanel";


// Dynamically import MapPanel to avoid SSR issues with maplibre-gl / deck.gl
const MapPanel = dynamic(() => import("./MapPanel"), { ssr: false });

export type DepthLevel =
  | -5
  | -10
  | -20
  | -30
  | -50
  | -100
  | -300
  | -500
  | -1000;

export interface LayerState {
  temperature: boolean;
  salinity: boolean;
  velocity: boolean;
}

export interface ProbePoint {
  lon: number;
  lat: number;
}

export interface AppState {
  layers: LayerState;
  depth: DepthLevel;
  timeIndex: number;
  availableTimes: string[];
  probePoint: ProbePoint | null;
}

const INITIAL_STATE: AppState = {
  layers: {
    temperature: false,
    salinity: false,
    velocity: true,
  },
  depth: -5,
  timeIndex: 0,
  availableTimes: [],
  probePoint: null,
};

export default function OceanViewer() {
  const [state, setState] = useState<AppState>(INITIAL_STATE);

  // Fetch available time steps on mount
  useEffect(() => {
    const abortCtrl = new AbortController();
    fetch(
      "/api/metadata?item=layerDetails&layerName=temperature",
      { signal: abortCtrl.signal }
    )
      .then((r) => r.json())
      .then((data: { nearestTimeIso?: string; datesWithData?: Record<string, Record<string, number[]>> }) => {
        // Build time strings from datesWithData
        const times: string[] = [];
        if (data.datesWithData) {
          for (const year of Object.keys(data.datesWithData)) {
            for (const month of Object.keys(data.datesWithData[year])) {
              for (const day of data.datesWithData[year][month]) {
                // Hourly: we'll use timesteps API for a specific day
                // For now seed with the nearest time; we'll fetch a day's timesteps separately
                const paddedMonth = String(parseInt(month) + 1).padStart(2, "0");
                const paddedDay = String(day).padStart(2, "0");
                times.push(`${year}-${paddedMonth}-${paddedDay}T00:00:00.000Z`);
              }
            }
          }
        }
        if (data.nearestTimeIso && times.length === 0) {
          times.push(data.nearestTimeIso);
        }
        setState((s) => ({ ...s, availableTimes: times }));

        // Fetch hourly timesteps for all days
        return Promise.all(
          times.map((t) =>
            fetch(
              `/api/metadata?item=timesteps&layerName=temperature&day=${t.slice(0, 10)}`,
              { signal: abortCtrl.signal }
            )
              .then((r) => r.json())
              .then((d: { timesteps?: string[] }) =>
                (d.timesteps ?? []).map((ts) => `${t.slice(0, 10)}T${ts}`)
              )
              .catch(() => [t])
          )
        );
      })
      .then((hourlyArrays: string[][]) => {
        const all = hourlyArrays.flat().sort();
        if (all.length > 0) {
          setState((s) => ({
            ...s,
            availableTimes: all,
            // Start near the most recent time
            timeIndex: Math.max(0, all.length - 1),
          }));
        }
      })
      .catch(() => {
        // Silently handle abort or network error
      });

    return () => abortCtrl.abort();
  }, []);

  const setLayerToggle = useCallback(
    (key: keyof LayerState, value: boolean) =>
      setState((s) => ({ ...s, layers: { ...s.layers, [key]: value } })),
    []
  );

  const setDepth = useCallback(
    (d: DepthLevel) => setState((s) => ({ ...s, depth: d })),
    []
  );

  const setTimeIndex = useCallback(
    (i: number) => setState((s) => ({ ...s, timeIndex: i })),
    []
  );

  const setProbePoint = useCallback(
    (p: ProbePoint | null) => setState((s) => ({ ...s, probePoint: p })),
    []
  );

  const currentTime =
    state.availableTimes[state.timeIndex] ?? null;

  return (
    <div className="flex flex-col h-full bg-[#0f1117] text-slate-200 select-none">
      {/* Top control bar */}
      <ControlBar />

      {/* Main content area */}
      <div className="flex flex-1 min-h-0">
        {/* Left sidebar */}
        <LayersPanel
          layers={state.layers}
          depth={state.depth}
          timeIndex={state.timeIndex}
          availableTimes={state.availableTimes}
          currentTime={currentTime}
          onLayerToggle={setLayerToggle}
          onDepthChange={setDepth}
          onTimeIndexChange={setTimeIndex}
        />

        {/* Map + charts column */}
        <div className="flex flex-col flex-1 min-w-0">
          {/* Map */}
          <div className="flex-1 relative">
            <MapPanel
              layers={state.layers}
              depth={state.depth}
              currentTime={currentTime}
              probePoint={state.probePoint}
              onProbePointChange={setProbePoint}
            />
          </div>

          {/* Bottom chart panel */}
          <BottomPanel
            layers={state.layers}
            probePoint={state.probePoint}
            depth={state.depth}
            currentTime={currentTime}
            availableTimes={state.availableTimes}
          />
        </div>
      </div>
    </div>
  );
}
