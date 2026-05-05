"use client";

import type { DepthLevel, LayerState } from "./OceanViewer";
import Depth from "./Depth";
import TimeStep from "./TimeStep";

const LAYER_CONFIG: { key: keyof LayerState; label: string; color: string }[] = [
  { key: "temperature", label: "Temperature", color: "bg-yellow-400" },
  { key: "salinity",    label: "Salinity",    color: "bg-blue-400" },
  { key: "velocity",    label: "Velocity",    color: "bg-cyan-400" },
];

interface Props {
  layers: LayerState;
  depth: DepthLevel;
  timeIndex: number;
  availableTimes: string[];
  currentTime?: string | null;
  onLayerToggle: (key: keyof LayerState, value: boolean) => void;
  onDepthChange: (d: DepthLevel) => void;
  onTimeIndexChange: (i: number) => void;
}

export default function LayersPanel({
  layers,
  depth,
  timeIndex,
  availableTimes,
  onLayerToggle,
  onDepthChange,
  onTimeIndexChange,
}: Props) {
  return (
    <aside className="shrink-0 bg-[#1a1f2e] border-r border-[#2d3748] flex flex-col gap-6 p-4 overflow-y-auto" style={{ width: "max(320px, 16%)" }}>
      {/* LAYERS */}
      <section>
        <h3 className="text-[10px] font-semibold tracking-widest text-slate-500 uppercase mb-3">
          Overlays
        </h3>
        <div className="flex flex-col gap-3">
          {LAYER_CONFIG.map(({ key, label, color }) => (
            <label key={key} className="flex items-center justify-between cursor-pointer">
              <div className="flex items-center gap-2">
                <span className={`w-2.5 h-2.5 rounded-full ${color}`} />
                <span className="text-sm text-slate-200">{label}</span>
              </div>
              <button
                role="switch"
                aria-checked={layers[key]}
                onClick={() => onLayerToggle(key, !layers[key])}
                className={`relative w-9 h-5 rounded-full transition-colors ${layers[key] ? "bg-blue-500" : "bg-slate-600"}`}
              >
                <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${layers[key] ? "translate-x-4" : "translate-x-0"}`} />
              </button>
            </label>
          ))}
        </div>
      </section>

      {/* DEPTH */}
      <section>
        <h3 className="text-[10px] font-semibold tracking-widest text-slate-500 uppercase mb-3">
          {/* Depth */}
        </h3>
        <Depth depth={depth} onDepthChange={onDepthChange} />
      </section>

      {/* TIME STEP */}
      <section>
        <TimeStep
          timeIndex={timeIndex}
          availableTimes={availableTimes}
          depth={depth}
          onTimeIndexChange={onTimeIndexChange}
          onDepthChange={onDepthChange}
        />
      </section>
    </aside>
  );
}