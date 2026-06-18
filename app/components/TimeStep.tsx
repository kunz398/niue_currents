"use client";

import { useState, useEffect, useRef, useCallback, type CSSProperties } from "react";
import type { DepthLevel } from "./OceanViewer";

const DEPTH_LEVELS: DepthLevel[] = [-5, -10, -20, -30, -50, -100, -300, -500, -1000];

const WAVE_POINTS: number[] = (() => {
  const pts: number[] = [];
  for (let i = 0; i <= 120; i++) {
    const t = (i / 120) * Math.PI * 5;
    pts.push(
      Math.sin(t) * 0.28 +
      Math.sin(t * 0.61) * 0.14 +
      Math.cos(t * 1.37) * 0.09 +
      Math.sin(t * 2.1 + 0.5) * 0.05
    );
  }
  return pts;
})();

function fmtTime(iso: string): string {
  const d = new Date(iso);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${hh}:${mm} UTC - ${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function shortDate(iso: string): string {
  const d = new Date(iso);
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]}`;
}

function getBuoyY(frac: number, H: number): number {
  const idx = Math.min(Math.round(frac * 120), 120);
  return H / 2 - WAVE_POINTS[idx] * H * 0.38;
}

function drawWave(ctx: CanvasRenderingContext2D, W: number, H: number, frac: number) {
  ctx.clearRect(0, 0, W, H);

  ctx.fillStyle = "rgba(8,28,52,0.9)";
  ctx.beginPath();
  ctx.rect(0, 0, W, H);
  ctx.fill();

  const pastX = frac * W;

  // full wave fill
  ctx.beginPath();
  for (let i = 0; i <= 120; i++) {
    const x = (i / 120) * W;
    const y = H / 2 - WAVE_POINTS[i] * H * 0.38;
    if (i === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  }
  ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.closePath();
  ctx.fillStyle = "rgba(30,80,130,0.25)";
  ctx.fill();

  // elapsed fill
  ctx.beginPath();
  for (let i = 0; i <= 120; i++) {
    const x = (i / 120) * W;
    if (x > pastX) break;
    const y = H / 2 - WAVE_POINTS[i] * H * 0.38;
    if (i === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  }
  ctx.lineTo(pastX, H); ctx.lineTo(0, H); ctx.closePath();
  ctx.fillStyle = "rgba(125,211,252,0.12)";
  ctx.fill();

  // full wave line
  ctx.beginPath();
  for (let i = 0; i <= 120; i++) {
    const x = (i / 120) * W;
    const y = H / 2 - WAVE_POINTS[i] * H * 0.38;
    if (i === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  }
  ctx.strokeStyle = "rgba(125,211,252,0.35)";
  ctx.lineWidth = 1;
  ctx.stroke();

  // elapsed wave line
  ctx.beginPath();
  for (let i = 0; i <= 120; i++) {
    const x = (i / 120) * W;
    if (x > pastX + 1) break;
    const y = H / 2 - WAVE_POINTS[i] * H * 0.38;
    if (i === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  }
  ctx.strokeStyle = "#7dd3fc";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // centre dashed line
  ctx.strokeStyle = "rgba(125,211,252,0.15)";
  ctx.lineWidth = 0.5;
  ctx.setLineDash([2, 3]);
  ctx.beginPath(); ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2); ctx.stroke();
  ctx.setLineDash([]);
}

function drawTicks(ctx: CanvasRenderingContext2D, W: number, H: number, frac: number) {
  ctx.clearRect(0, 0, W, H);
  const NUM = 16;
  for (let i = 0; i <= NUM; i++) {
    const x = (i / NUM) * W;
    const isQuarter = i % 4 === 0;
    ctx.strokeStyle = isQuarter ? "rgba(125,211,252,0.4)" : "rgba(255,255,255,0.15)";
    ctx.lineWidth = isQuarter ? 1 : 0.5;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, isQuarter ? H : H * 0.6);
    ctx.stroke();
  }
  const R = 2.5;
  const px = Math.min(Math.max(frac * W, R), W - R);
  ctx.fillStyle = "#7dd3fc";
  ctx.beginPath();
  ctx.arc(px, H * 0.3, R, 0, Math.PI * 2);
  ctx.fill();
}

interface Props {
  timeIndex: number;
  availableTimes: string[];
  depth: DepthLevel;
  disableDepth?: boolean;
  onTimeIndexChange: (i: number) => void;
  onDepthChange: (d: DepthLevel) => void;
}

const CANVAS_H = 64;
const SPEEDS = [0.5, 1, 2, 4];

export default function TimeStep({ timeIndex, availableTimes, depth, disableDepth = false, onTimeIndexChange, onDepthChange }: Props) {
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);

  const waveRef = useRef<HTMLCanvasElement>(null);
  const tickRef = useRef<HTMLCanvasElement>(null);
  const ribbonRef = useRef<HTMLDivElement>(null);
  const animRef = useRef<number>(0);
  const lastTsRef = useRef<number | null>(null);
  const dragging = useRef(false);

  // keep mutable refs in sync with props/state for use in rAF
  const timeIdxRef = useRef(timeIndex);
  const totalRef = useRef(availableTimes.length);
  const depthRef = useRef(depth);
  const playingRef = useRef(false);
  const speedRef = useRef(1);
  const disableDepthRef = useRef(disableDepth);
  const onTimeRef = useRef(onTimeIndexChange);
  const onDepthRef = useRef(onDepthChange);

  useEffect(() => { timeIdxRef.current = timeIndex; }, [timeIndex]);
  useEffect(() => { totalRef.current = availableTimes.length; }, [availableTimes]);
  useEffect(() => { depthRef.current = depth; }, [depth]);
  useEffect(() => { playingRef.current = playing; }, [playing]);
  useEffect(() => { speedRef.current = speed; }, [speed]);
  useEffect(() => { disableDepthRef.current = disableDepth; }, [disableDepth]);
  useEffect(() => { onTimeRef.current = onTimeIndexChange; }, [onTimeIndexChange]);
  useEffect(() => { onDepthRef.current = onDepthChange; }, [onDepthChange]);

  const total = availableTimes.length;
  const frac = total > 1 ? timeIndex / (total - 1) : 0;
  const currentIso = availableTimes[timeIndex] ?? "";
  const depthIdx = DEPTH_LEVELS.indexOf(depth);

  // draw canvases when frac changes
  useEffect(() => {
    const wc = waveRef.current;
    const tc = tickRef.current;
    if (!wc || !tc) return;
    const wCtx = wc.getContext("2d");
    const tCtx = tc.getContext("2d");
    if (wCtx) drawWave(wCtx, wc.width, wc.height, frac);
    if (tCtx) drawTicks(tCtx, tc.width, tc.height, frac);
  }, [frac]);

  // initialise + resize canvases
  useEffect(() => {
    const fracSnap = { current: frac };
    function resize() {
      const wc = waveRef.current;
      const tc = tickRef.current;
      if (!wc || !tc) return;
      wc.width = wc.offsetWidth;
      wc.height = wc.offsetHeight;
      tc.width = tc.offsetWidth;
      tc.height = tc.offsetHeight;
      const wCtx = wc.getContext("2d");
      const tCtx = tc.getContext("2d");
      if (wCtx) drawWave(wCtx, wc.width, wc.height, fracSnap.current);
      if (tCtx) drawTicks(tCtx, tc.width, tc.height, fracSnap.current);
    }
    fracSnap.current = frac;
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // playback loop: advance timeIndex every msPerStep ms; on end advance depth
  useEffect(() => {
    if (!playing) {
      cancelAnimationFrame(animRef.current);
      lastTsRef.current = null;
      return;
    }
    const msPerStep = 400 / speed;

    function loop(ts: number) {
      if (!playingRef.current) return;
      if (lastTsRef.current === null) lastTsRef.current = ts;
      const elapsed = ts - lastTsRef.current;
      if (elapsed >= msPerStep) {
        lastTsRef.current = ts;
        const cur = timeIdxRef.current;
        const tot = totalRef.current;
        if (cur >= tot - 1) {
          if (!disableDepthRef.current) {
            const di = DEPTH_LEVELS.indexOf(depthRef.current);
            const next = (di + 1) % DEPTH_LEVELS.length;
            onDepthRef.current(DEPTH_LEVELS[next]);
          }
          onTimeRef.current(0);
        } else {
          onTimeRef.current(cur + 1);
        }
      }
      animRef.current = requestAnimationFrame(loop);
    }

    lastTsRef.current = null;
    animRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animRef.current);
  }, [playing, speed]);

  // drag on ribbon
  const getFrac = useCallback((clientX: number) => {
    const rect = ribbonRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  }, []);

  useEffect(() => {
    // Native pointer-move events can fire far more often than the index can
    // usefully change (each step reloads a wind/raster slice over the
    // network) — coalesce to at most once per animation frame so a fast drag
    // doesn't queue up many more loadWindData/raster calls than the screen
    // can even show, which is what made fast scrubbing feel laggy.
    let rafId = 0;
    let pendingX: number | null = null;

    const commit = () => {
      rafId = 0;
      if (pendingX === null) return;
      onTimeRef.current(Math.round(getFrac(pendingX) * (totalRef.current - 1)));
      pendingX = null;
    };

    const onMove = (e: MouseEvent | TouchEvent) => {
      if (!dragging.current) return;
      pendingX = "touches" in e ? e.touches[0]?.clientX ?? 0 : e.clientX;
      if (!rafId) rafId = requestAnimationFrame(commit);
    };
    const onUp = () => {
      dragging.current = false;
      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = 0;
      }
      pendingX = null;
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("touchmove", onMove, { passive: true });
    window.addEventListener("touchend", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onUp);
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [getFrac]);

  const skipAmt = Math.max(1, Math.floor(total / 16));
  function skipBack() { onTimeIndexChange(Math.max(0, timeIndex - skipAmt)); }
  function skipFwd()  { onTimeIndexChange(Math.min(total - 1, timeIndex + skipAmt)); }

  const buoyY = getBuoyY(frac, CANVAS_H);

  // bottom label indices
  const labelIdxs = [0, 0.25, 0.5, 0.75, 1].map(p => Math.round(p * (total - 1)));

  return (
    <div style={{ background: "#0d1b2a", borderRadius: 12, overflow: "hidden" }}>

      {/* Header */}
      <div style={{ padding: "7px 12px 6px", borderBottom: "0.5px solid rgba(255,255,255,0.06)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ fontSize: 13, fontWeight: 500, color: "#e2f0ff", lineHeight: 1.3 }}>
            {currentIso ? fmtTime(currentIso) : "Loading..."}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 3 }}>
          <span style={{ fontSize: 10, fontWeight: 500, color: "#7dd3fc", background: "rgba(125,211,252,0.12)", borderRadius: 20, padding: "1px 6px" }}>
            T+{timeIndex}
          </span>
          {!disableDepth && (
            <span style={{ fontSize: 9, color: "rgba(255,255,255,0.28)" }}>-{Math.abs(depth)}m</span>
          )}
        </div>
      </div>

      {/* Ribbon */}
      <div style={{ padding: "7px 12px 0" }}>
        <div style={{ fontSize: 8, letterSpacing: "0.08em", textTransform: "uppercase", color: "rgba(255,255,255,0.18)", marginBottom: 3 }}>
          drag to scroll through time
        </div>
        <div
          ref={ribbonRef}
          style={{ position: "relative", height: CANVAS_H, borderRadius: 6, overflow: "hidden", cursor: "crosshair" }}
          onMouseDown={(e) => { dragging.current = true; onTimeIndexChange(Math.round(getFrac(e.clientX) * (total - 1))); }}
          onTouchStart={(e) => { dragging.current = true; onTimeIndexChange(Math.round(getFrac(e.touches[0].clientX) * (total - 1))); }}
        >
          <canvas ref={waveRef} style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} />
          {/* cursor line */}
          <div style={{ position: "absolute", top: 0, bottom: 0, left: `${frac * 100}%`, width: 1.5, background: "#7dd3fc", pointerEvents: "none" }} />
          {/* buoy */}
          <div style={{
            position: "absolute",
            left: `${frac * 100}%`,
            top: buoyY,
            width: 10, height: 10,
            borderRadius: "50%",
            background: "#7dd3fc",
            border: "2px solid #0d1b2a",
            transform: "translate(-50%, -50%)",
            pointerEvents: "none",
          }} />
        </div>

        {/* ticks */}
        <div style={{ position: "relative", height: 14, marginTop: 2 }}>
          <canvas ref={tickRef} style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} />
        </div>

        {/* bottom date labels */}
        <div style={{ display: "flex", justifyContent: "space-between", padding: "2px 2px 5px" }}>
          {labelIdxs.map((li, i) => (
            <span key={i} style={{ fontSize: 9, color: "rgba(255,255,255,0.22)" }}>
              {availableTimes[li] ? shortDate(availableTimes[li]) : ""}
            </span>
          ))}
        </div>
      </div>

      {!disableDepth && (
        <div style={{ padding: "0 12px 7px" }}>
          <div style={{ fontSize: 8, letterSpacing: "0.06em", textTransform: "uppercase", color: "rgba(255,255,255,0.2)", marginBottom: 3 }}>
            depth level
          </div>
          <div style={{ display: "flex", gap: 3, alignItems: "center" }}>
            {DEPTH_LEVELS.map((d, i) => (
              <div
                key={d}
                title={`${Math.abs(d)}m`}
                style={{
                  flex: 1, height: i === depthIdx ? 5 : 3, borderRadius: 2,
                  background: i < depthIdx
                    ? "#7dd3fc"
                    : i === depthIdx
                      ? "rgba(125,211,252,0.7)"
                      : "rgba(255,255,255,0.08)",
                  transition: "all 0.3s",
                }}
              />
            ))}
          </div>
        </div>
      )}

      {/* Playback controls */}
      <div style={{ display: "flex", alignItems: "center", gap: 5, padding: "6px 12px 8px", borderTop: "0.5px solid rgba(255,255,255,0.06)" }}>

        {/* Skip back */}
        <button onClick={skipBack} style={chipBtn}>
          <svg width="10" height="10" viewBox="0 0 10 10" fill="#7dd3fc">
            <polygon points="9,1 4,5 9,9" />
            <rect x="1" y="1" width="2" height="8" />
          </svg>
        </button>

        {/* Play / Pause */}
        <button
          onClick={() => setPlaying(p => !p)}
          style={{ ...chipBtn, width: 28, height: 28, background: "rgba(125,211,252,0.18)" }}
        >
          <svg width="11" height="11" viewBox="0 0 12 12" fill="#7dd3fc">
            {playing
              ? <><rect x="2" y="1" width="3" height="10" /><rect x="7" y="1" width="3" height="10" /></>
              : <polygon points="2,1 11,6 2,11" />
            }
          </svg>
        </button>

        {/* Skip forward */}
        <button onClick={skipFwd} style={chipBtn}>
          <svg width="10" height="10" viewBox="0 0 10 10" fill="#7dd3fc">
            <polygon points="1,1 6,5 1,9" />
            <rect x="7" y="1" width="2" height="8" />
          </svg>
        </button>

        {/* Speed chips */}
        <div style={{ display: "flex", gap: 3, marginLeft: "auto" }}>
          {SPEEDS.map(s => (
            <button
              key={s}
              onClick={() => setSpeed(s)}
              style={{
                fontSize: 9, padding: "2px 5px", borderRadius: 20, border: "none",
                cursor: "pointer",
                background: speed === s ? "rgba(125,211,252,0.15)" : "rgba(255,255,255,0.06)",
                color: speed === s ? "#7dd3fc" : "rgba(255,255,255,0.3)",
              }}
            >
              {s}x
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

const chipBtn: CSSProperties = {
  width: 24, height: 24, borderRadius: "50%",
  background: "rgba(255,255,255,0.06)", border: "none",
  cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
  flexShrink: 0,
};
