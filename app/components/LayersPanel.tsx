"use client";

import type { DepthLevel, LayerState } from "./OceanViewer";
import Depth from "./Depth";
import TimeStep from "./TimeStep";

const LAYER_CONFIG: { key: keyof LayerState; label: string; color: string; unit: string }[] = [
  { key: "temperature", label: "Temperature", color: "#f59e0b", unit: "°C" },
  { key: "salinity",    label: "Salinity",    color: "#60a5fa", unit: "PSU" },
  { key: "velocity",    label: "Velocity",    color: "#34d399", unit: "m/s" },
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
        <div style={{ fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", color: "rgba(255,255,255,0.28)", marginBottom: 10 }}>
          overlay
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 3, background: "rgba(0,0,0,0.25)", borderRadius: 10, padding: 3 }}>
          {LAYER_CONFIG.map(({ key, label, color, unit }) => {
            const isActive = layers[key];
            return (
              <button
                key={key}
                type="button"
                aria-pressed={isActive}
                onClick={() => onLayerToggle(key, true)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  width: "100%",
                  border: "none",
                  padding: "7px 10px",
                  borderRadius: 8,
                  cursor: "pointer",
                  textAlign: "left",
                  background: isActive ? "rgba(255,255,255,0.1)" : "transparent",
                  transition: "background 0.15s",
                }}
              >
                <span style={{
                  width: 7, height: 7, borderRadius: "50%", background: color, flexShrink: 0,
                  boxShadow: isActive ? `0 0 6px ${color}` : "none",
                  transition: "box-shadow 0.2s",
                }} />
                <span style={{
                  fontSize: 12, fontWeight: isActive ? 500 : 400, flex: 1,
                  color: isActive ? "#fff" : "rgba(255,255,255,0.4)",
                  transition: "color 0.15s",
                }}>
                  {label}
                </span>
                {isActive && (
                  <span style={{ fontSize: 10, color: "rgba(255,255,255,0.35)" }}>{unit}</span>
                )}
              </button>
            );
          })}
        </div>
      </section>

      {/* DEPTH */}
      <section>
        <h3 className="text-[10px] font-semibold tracking-widest text-slate-500 uppercase mb-3">
          {/* Select Depth */}
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