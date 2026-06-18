"use client";

import { useState, useEffect, useCallback } from "react";
import dynamic from "next/dynamic";
import ControlBar from "./ControlBar";
import LayersPanel from "./LayersPanel";
import BottomPanel from "./BottomPanel";


// Dynamically import ZarrMapPanel to avoid SSR issues with maplibre-gl / deck.gl
const ZarrMapPanel = dynamic(() => import("./zarrMapPanel"), { ssr: false });

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
  seaSurfaceHeight: boolean;
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
  particlesEnabled: boolean;
  particleSpeed: number;
  modelRunTime: string | null;
}

const INITIAL_STATE: AppState = {
  layers: {
    temperature: false,
    salinity: false,
    velocity: true,
    seaSurfaceHeight: false,
  },
  depth: -5,
  timeIndex: 0,
  availableTimes: [],
  probePoint: null,
  particlesEnabled: true,
  particleSpeed: 1,
  modelRunTime: null,
};

export default function OceanViewer() {
  const [state, setState] = useState<AppState>(INITIAL_STATE);
  const activeLayer: keyof LayerState = state.layers.seaSurfaceHeight
    ? "seaSurfaceHeight"
    : state.layers.velocity
    ? "velocity"
    : state.layers.salinity
    ? "salinity"
    : "temperature";
  const metadataLayerName =
    activeLayer === "velocity"
      ? "u"
      : activeLayer === "seaSurfaceHeight"
      ? "zeta"
      : activeLayer;

  // Fetch available time steps for the currently selected layer
  useEffect(() => {
    const abortCtrl = new AbortController();
    fetch(
      `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/metadata?item=layerDetails&layerName=${metadataLayerName}`,
      { signal: abortCtrl.signal }
    )
      .then((r) => r.json())
      .then((data: { nearestTimeIso?: string; datesWithData?: Record<string, Record<string, number[]>> }) => {
        // Build day anchors from datesWithData, then expand to intraday timesteps.
        const times: string[] = [];
        if (data.datesWithData) {
          for (const year of Object.keys(data.datesWithData).sort()) {
            for (const month of Object.keys(data.datesWithData[year]).sort((a, b) => Number(a) - Number(b))) {
              for (const day of data.datesWithData[year][month]) {
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

        // Fetch intraday timesteps for all available days.
        return Promise.all(
          times.map((t) =>
            fetch(
              `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/metadata?item=timesteps&layerName=${metadataLayerName}&day=${t.slice(0, 10)}`,
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
        setState((s) => {
          if (all.length === 0) {
            return { ...s, availableTimes: [], timeIndex: 0 };
          }

          const previousTime = s.availableTimes[s.timeIndex];
          const preservedIndex = previousTime ? all.indexOf(previousTime) : -1;
          const nextIndex = preservedIndex >= 0 ? preservedIndex : Math.max(0, all.length - 1);

          return {
            ...s,
            availableTimes: all,
            timeIndex: nextIndex,
          };
        });
      })
      .catch((err) => {
        if (abortCtrl.signal.aborted) return;
        console.error("metadata fetch failed", err);
      });

    return () => abortCtrl.abort();
  }, [metadataLayerName]);

  const setLayerToggle = useCallback(
    (key: keyof LayerState, value: boolean) =>
      setState((s) => ({
        ...s,
        layers: value
          ? {
              temperature: false,
              salinity: false,
              velocity: false,
              seaSurfaceHeight: false,
              [key]: true,
            }
          : { ...s.layers, [key]: false },
      })),
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

  const setParticlesEnabled = useCallback(
    (enabled: boolean) => setState((s) => ({ ...s, particlesEnabled: enabled })),
    []
  );

  const setParticleSpeed = useCallback(
    (speed: number) => setState((s) => ({ ...s, particleSpeed: speed })),
    []
  );

  const setModelRunTime = useCallback(
    (iso: string | null) => setState((s) => ({ ...s, modelRunTime: iso })),
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
          particlesEnabled={state.particlesEnabled}
          particleSpeed={state.particleSpeed}
          modelRunTime={state.modelRunTime}
          onLayerToggle={setLayerToggle}
          onDepthChange={setDepth}
          onTimeIndexChange={setTimeIndex}
          onParticlesEnabledChange={setParticlesEnabled}
          onParticleSpeedChange={setParticleSpeed}
        />

        {/* Map + charts column */}
        <div className="flex flex-col flex-1 min-w-0">
          {/* Map */}
          <div className="flex-1 relative">
            <ZarrMapPanel
              layers={state.layers}
              depth={state.depth}
              currentTime={currentTime}
              probePoint={state.probePoint}
              onProbePointChange={setProbePoint}
              particlesEnabled={state.particlesEnabled}
              particleSpeed={state.particleSpeed}
              onModelRunTimeChange={setModelRunTime}
            />
          </div>

          {/* Bottom chart panel */}
          {!state.layers.seaSurfaceHeight && (
            <BottomPanel
              layers={state.layers}
              probePoint={state.probePoint}
              depth={state.depth}
              currentTime={currentTime}
              availableTimes={state.availableTimes}
            />
          )}
        </div>
      </div>
    </div>
  );
}
