"use client";

import type { DepthLevel, LayerState } from "./OceanViewer";
import Depth from "./Depth";
import TimeStep from "./TimeStep";

const LAYER_CONFIG: { key: keyof LayerState; label: string; color: string; unit: string }[] = [
  { key: "temperature", label: "Temperature", color: "#f59e0b", unit: "°C" },
  { key: "salinity",    label: "Salinity",    color: "#60a5fa", unit: "PSU" },
  { key: "velocity",    label: "Velocity",    color: "#34d399", unit: "m/s" },
  { key: "seaSurfaceHeight", label: "Sea Surface Height", color: "#22d3ee", unit: "m" },
];

interface Props {
  layers: LayerState;
  depth: DepthLevel;
  timeIndex: number;
  availableTimes: string[];
  currentTime?: string | null;
  particlesEnabled: boolean;
  particleSpeed: number;
  modelRunTime?: string | null;
  disabledLayers?: (keyof LayerState)[];
  onLayerToggle: (key: keyof LayerState, value: boolean) => void;
  onDepthChange: (d: DepthLevel) => void;
  onTimeIndexChange: (i: number) => void;
  onParticlesEnabledChange: (enabled: boolean) => void;
  onParticleSpeedChange: (speed: number) => void;
}

export default function LayersPanel({
  layers,
  depth,
  timeIndex,
  availableTimes,
  particlesEnabled,
  particleSpeed,
  modelRunTime,
  disabledLayers,
  onLayerToggle,
  onDepthChange,
  onTimeIndexChange,
  onParticlesEnabledChange,
  onParticleSpeedChange,
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
            const isDisabled = disabledLayers?.includes(key) ?? false;
            return (
              <button
                key={key}
                type="button"
                aria-pressed={isActive}
                disabled={isDisabled}
                onClick={() => onLayerToggle(key, true)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  width: "100%",
                  border: "none",
                  padding: "7px 10px",
                  borderRadius: 8,
                  cursor: isDisabled ? "not-allowed" : "pointer",
                  textAlign: "left",
                  background: isActive && !isDisabled ? "rgba(255,255,255,0.1)" : "transparent",
                  opacity: isDisabled ? 0.4 : 1,
                  transition: "background 0.15s",
                }}
              >
                <span style={{
                  width: 7, height: 7, borderRadius: "50%", background: isDisabled ? "rgba(255,255,255,0.3)" : color, flexShrink: 0,
                  boxShadow: isActive && !isDisabled ? `0 0 6px ${color}` : "none",
                  transition: "box-shadow 0.2s",
                }} />
                <span style={{
                  fontSize: 12, fontWeight: isActive && !isDisabled ? 500 : 400, flex: 1,
                  color: isActive && !isDisabled ? "#fff" : "rgba(255,255,255,0.4)",
                  transition: "color 0.15s",
                }}>
                  {label}{isDisabled ? " (disabled)" : ""}
                </span>
                {isActive && !isDisabled && (
                  <span style={{ fontSize: 10, color: "rgba(255,255,255,0.35)" }}>{unit}</span>
                )}
              </button>
            );
          })}
        </div>
      </section>

      {/* PARTICLES (velocity layer only) */}
      {layers.velocity && (
        <section>
          <div style={{ fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", color: "rgba(255,255,255,0.28)", marginBottom: 10 }}>
            flow particles
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, background: "rgba(0,0,0,0.25)", borderRadius: 10, padding: "10px 12px" }}>
            <button
              type="button"
              aria-pressed={particlesEnabled}
              onClick={() => onParticlesEnabledChange(!particlesEnabled)}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                width: "100%",
                border: "none",
                background: "transparent",
                cursor: "pointer",
                padding: 0,
              }}
            >
              <span style={{ fontSize: 12, color: particlesEnabled ? "#fff" : "rgba(255,255,255,0.4)" }}>
                Show particles
              </span>
              <span
                style={{
                  width: 32,
                  height: 18,
                  borderRadius: 999,
                  background: particlesEnabled ? "#34d399" : "rgba(255,255,255,0.15)",
                  position: "relative",
                  transition: "background 0.15s",
                  flexShrink: 0,
                }}
              >
                <span
                  style={{
                    position: "absolute",
                    top: 2,
                    left: particlesEnabled ? 16 : 2,
                    width: 14,
                    height: 14,
                    borderRadius: "50%",
                    background: "#fff",
                    transition: "left 0.15s",
                  }}
                />
              </span>
            </button>

            {/* Speed control hidden — particle speed is kept constant (see OceanViewer's
                INITIAL_STATE.particleSpeed). Re-enable this block to expose the slider again.
            <div style={{ opacity: particlesEnabled ? 1 : 0.4 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                <span style={{ fontSize: 11, color: "rgba(255,255,255,0.5)" }}>Speed</span>
                <span style={{ fontSize: 11, color: "rgba(255,255,255,0.5)" }}>{particleSpeed.toFixed(2)}x</span>
              </div>
              <input
                type="range"
                min={0.25}
                max={3}
                step={0.25}
                value={particleSpeed}
                disabled={!particlesEnabled}
                onChange={(e) => onParticleSpeedChange(Number(e.target.value))}
                style={{ width: "100%" }}
              />
            </div>
            */}
          </div>
        </section>
      )}

      {/* DEPTH */}
      {!layers.seaSurfaceHeight && (
        <section>
          <h3 className="text-[10px] font-semibold tracking-widest text-slate-500 uppercase mb-3">
            {/* Select Depth */}
          </h3>
          <Depth depth={depth} onDepthChange={onDepthChange} />
        </section>
      )}

      {/* TIME STEP */}
      <section>
        <TimeStep
          timeIndex={timeIndex}
          availableTimes={availableTimes}
          depth={depth}
          disableDepth={layers.seaSurfaceHeight}
          onTimeIndexChange={onTimeIndexChange}
          onDepthChange={onDepthChange}
        />
      </section>

      {/* MODEL RUN TIME */}
      {modelRunTime && (
        <div style={{ marginTop: "auto", fontSize: 10, color: "rgba(255,255,255,0.3)", textAlign: "center" }}>
          Model run: {new Date(modelRunTime).toLocaleString(undefined, {
            day: "2-digit",
            month: "short",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            timeZone: "UTC",
            timeZoneName: "short",
          })}
        </div>
      )}
    </aside>
  );
}