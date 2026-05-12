"use client";

import type { DepthLevel, LayerState, ProbePoint } from "./OceanViewer";
import DepthProfile from "./charts/DepthProfile";
import TimeSeries from "./charts/TimeSeries";
import TSDiagram from "./charts/TSDiagram";

interface Props {
  layers: LayerState;
  probePoint: ProbePoint | null;
  depth: DepthLevel;
  currentTime: string | null;
  availableTimes: string[];
}

export default function BottomPanel({
  layers,
  probePoint,
  depth,
  currentTime,
  availableTimes,
}: Props) {
  // Pick primary variable for profile/timeseries
  const primaryLayer = layers.velocity
    ? "u"
    : !layers.temperature && layers.salinity
    ? "salinity"
    : "temperature";
  const layer = primaryLayer;
  const label =
    primaryLayer === "salinity"
      ? "Salinity (PSU)"
      : primaryLayer === "u"
      ? "U-velocity (m/s)"
      : "Temp (°C)";
  const depthSubtitle =
    primaryLayer === "salinity"
      ? "Salinity vs depth"
      : primaryLayer === "u"
      ? "U & V velocity vs depth"
      : "Temp vs depth";
  const timeSubtitle =
    primaryLayer === "salinity"
      ? "Surface salinity · 72h"
      : primaryLayer === "u"
      ? "Surface velocity · 72h"
      : "Surface temp · 72h";


  return (
    <div className="h-56 shrink-0 bg-[#0f1117] border-t border-[#2d3748] grid grid-cols-3 divide-x divide-[#2d3748]">
      {/* Depth Profile */}
      <div className="flex flex-col min-h-0">
        <div className="px-3 pt-2 pb-1 shrink-0">
          <p className="text-[9px] font-semibold tracking-widest text-slate-500 uppercase">
            Depth Profile
          </p>
          <p className="text-xs font-medium text-slate-300">
            {primaryLayer === "u" ? (
              <><span style={{ color: "#ef4444" }}>U</span> &amp; <span style={{ color: "#60a5fa" }}>V</span> velocity vs depth</>
            ) : depthSubtitle}
          </p>
        </div>
        <div className="flex-1 min-h-0 overflow-hidden">
          <DepthProfile
            probePoint={probePoint}
            currentTime={currentTime}
            layer={layer}
            label={label}
          />
        </div>
      </div>

      {/* Time Series */}
      <div className="flex flex-col min-h-0">
        <div className="px-3 pt-2 pb-1 shrink-0">
          <p className="text-[9px] font-semibold tracking-widest text-slate-500 uppercase">
            Time Series
          </p>
          <p className="text-xs font-medium text-slate-300">{timeSubtitle}</p>
        </div>
        <div className="flex-1 min-h-0 overflow-hidden">
          <TimeSeries
            probePoint={probePoint}
            depth={depth}
            availableTimes={availableTimes}
            layer={layer}
            label={label}
          />
        </div>
      </div>

      {/* T-S Diagram */}
      <div className="flex flex-col min-h-0">
        <div className="px-3 pt-2 pb-1 shrink-0">
          <p className="text-[9px] font-semibold tracking-widest text-slate-500 uppercase">
            T-S Diagram
          </p>
          <p className="text-xs font-medium text-slate-300">Water mass · all depths</p>
        </div>
        <div className="flex-1 min-h-0 overflow-hidden">
          <TSDiagram probePoint={probePoint} currentTime={currentTime} />
        </div>
      </div>
    </div>
  );
}
