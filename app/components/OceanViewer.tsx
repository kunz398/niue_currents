"use client";

import { useState, useCallback } from "react";
import dynamic from "next/dynamic";
import type { MapViewState } from "@deck.gl/core";
import ControlBar from "./ControlBar";
import LayersPanel from "./LayersPanel";
import BottomPanel from "./BottomPanel";


// Dynamically import ZarrMapPanel to avoid SSR issues with maplibre-gl / deck.gl
const ZarrMapPanel = dynamic(() => import("./zarrMapPanel"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center text-sm text-slate-500">
      Loading map…
    </div>
  ),
});

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

interface Props {
  title?: string;
  datasetName?: string;
  initialView?: MapViewState;
  disabledLayers?: (keyof LayerState)[];
}

export default function OceanViewer({ title, datasetName, initialView, disabledLayers }: Props) {
  const [state, setState] = useState<AppState>(INITIAL_STATE);
  const [velocityParticleSupport, setVelocityParticleSupport] = useState<{
    datasetName: string;
    available: boolean;
  } | null>(null);

  // The timeline comes straight from the Zarr dataset's own `time` axis
  // (reported up by ZarrMapPanel once it loads coordinates) rather than a
  // separate metadata lookup — this used to hit a legacy THREDDS/WMS
  // endpoint that was hardcoded to Niue's feed and on a totally different
  // forecast cycle than the actual Zarr data, so the timeline never lined
  // up with what the map could actually render.
  const setAvailableTimes = useCallback((all: string[]) => {
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
  }, []);

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

  const setVelocityParticlesAvailability = useCallback(
    (reportedDatasetName: string, available: boolean) => {
      setVelocityParticleSupport({ datasetName: reportedDatasetName, available });
      if (!available) {
        setState((s) => (s.particlesEnabled ? { ...s, particlesEnabled: false } : s));
      }
    },
    []
  );

  const currentTime =
    state.availableTimes[state.timeIndex] ?? null;
  const activeDatasetName = datasetName ?? "d1_temp_salt_uv_z_all.zarr";
  const velocityParticlesAvailable =
    velocityParticleSupport?.datasetName === activeDatasetName
      ? velocityParticleSupport.available
      : null;

  return (
    <div className="flex flex-col h-full bg-[#0f1117] text-slate-200 select-none">
      {/* Top control bar */}
      <ControlBar title={title} />

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
          velocityParticlesAvailable={velocityParticlesAvailable}
          modelRunTime={state.modelRunTime}
          disabledLayers={disabledLayers}
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
              onTimesChange={setAvailableTimes}
              onVelocityParticlesAvailabilityChange={setVelocityParticlesAvailability}
              datasetName={datasetName}
              initialView={initialView}
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
              datasetName={datasetName}
            />
          )}
        </div>
      </div>
    </div>
  );
}
