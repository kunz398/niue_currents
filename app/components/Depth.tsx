"use client";

import { useEffect, useRef } from "react";
import type { DepthLevel } from "./OceanViewer";

const DEPTH_LEVELS: DepthLevel[] = [-5, -10, -20, -30, -50, -100, -300, -500, -1000];

const DEPTH_ZONES: Record<number, string> = {
  5: "euphotic zone", 10: "euphotic zone", 20: "euphotic zone", 30: "euphotic zone",
  50: "mesopelagic zone", 100: "mesopelagic zone", 300: "bathypelagic zone",
  500: "bathypelagic zone", 1000: "abyssal zone",
};

const DEPTH_COLORS: [number, number, number][] = [
  [14, 120, 180], [12, 100, 155], [10, 82, 132], [8, 65, 112],
  [6, 50, 95], [4, 38, 75], [3, 28, 58], [2, 20, 45], [1, 12, 30],
];

interface Props {
  depth: DepthLevel;
  onDepthChange: (d: DepthLevel) => void;
}

export default function Depth({ depth, onDepthChange }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const stateRef = useRef({
    t: 0,
    particles: [] as { x: number; y: number; r: number; speed: number; drift: number; alpha: number }[],
    bubbles: [] as { x: number; y: number; r: number; speed: number; wobble: number; wobbleSpeed: number; alpha: number }[],
    fish: [] as { x: number; y: number; speed: number; size: number; alpha: number }[],
  });

  const activeIdx = DEPTH_LEVELS.indexOf(depth);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;

    function init() {
      const W = canvas!.offsetWidth;
      const H = canvas!.offsetHeight;
      canvas!.width = W;
      canvas!.height = H;
      const s = stateRef.current;
      s.particles = Array.from({ length: 60 }, () => ({ x: Math.random() * W, y: Math.random() * H, r: 0.5 + Math.random() * 1.5, speed: 0.05 + Math.random() * 0.12, drift: (Math.random() - 0.5) * 0.04, alpha: 0.03 + Math.random() * 0.08 }));
      s.bubbles = Array.from({ length: 18 }, () => ({ x: 10 + Math.random() * (W - 20), y: H * 0.3 + Math.random() * H * 0.7, r: 1 + Math.random() * 2.5, speed: 0.2 + Math.random() * 0.5, wobble: Math.random() * Math.PI * 2, wobbleSpeed: 0.02 + Math.random() * 0.03, alpha: 0.06 + Math.random() * 0.12 }));
      s.fish = Array.from({ length: 5 }, () => { const df = 0.1 + Math.random() * 0.85; return { x: Math.random() * W, y: df * H, speed: (0.2 + Math.random() * 0.4) * (Math.random() < 0.5 ? 1 : -1), size: 3 + Math.random() * 5, alpha: 0.06 + df * 0.08 }; });
    }

    function draw() {
      const W = canvas!.width;
      const H = canvas!.height;
      const s = stateRef.current;
      const idx = DEPTH_LEVELS.indexOf(depth);
      ctx.clearRect(0, 0, W, H);
      const secH = H / DEPTH_LEVELS.length;
      DEPTH_COLORS.forEach(([r, g, b], i) => { ctx.fillStyle = `rgb(${r},${g},${b})`; ctx.fillRect(0, i * secH, W, secH + 1); });
      ctx.fillStyle = "rgba(125,211,252,0.06)";
      for (let x = 0; x < W; x += 4) { const wh = 3 + Math.sin(x * 0.08 + s.t * 0.04) * 2 + Math.sin(x * 0.13 - s.t * 0.025); ctx.fillRect(x, 0, 3, wh); }
      s.particles.forEach(p => { p.y -= p.speed; p.x += p.drift; if (p.y < 0) { p.y = H; p.x = Math.random() * W; } if (p.x < 0 || p.x > W) p.x = Math.random() * W; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fillStyle = `rgba(180,230,255,${p.alpha})`; ctx.fill(); });
      s.bubbles.forEach(b => { b.y -= b.speed; b.wobble += b.wobbleSpeed; b.x += Math.sin(b.wobble) * 0.4; if (b.y < -5) { b.y = H; b.x = 10 + Math.random() * (W - 20); } ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.strokeStyle = `rgba(180,230,255,${b.alpha})`; ctx.lineWidth = 0.5; ctx.stroke(); });
      s.fish.forEach(f => { f.x += f.speed; if (f.x > W + 20) f.x = -20; if (f.x < -20) f.x = W + 20; const sz = f.size; ctx.save(); ctx.globalAlpha = f.alpha; ctx.translate(f.x, f.y); if (f.speed < 0) ctx.scale(-1, 1); ctx.fillStyle = "rgba(200,235,255,0.9)"; ctx.beginPath(); ctx.ellipse(0, 0, sz, sz * 0.4, 0, 0, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.moveTo(-sz, 0); ctx.lineTo(-sz - sz * 0.7, -sz * 0.4); ctx.lineTo(-sz - sz * 0.7, sz * 0.4); ctx.closePath(); ctx.fill(); ctx.restore(); });
      const selFrac = (idx + 0.5) / DEPTH_LEVELS.length;
      const selY = selFrac * H;
      const grd = ctx.createLinearGradient(0, selY - 30, 0, selY + 30);
      grd.addColorStop(0, "rgba(125,211,252,0)"); grd.addColorStop(0.5, "rgba(125,211,252,0.07)"); grd.addColorStop(1, "rgba(125,211,252,0)");
      ctx.fillStyle = grd; ctx.fillRect(0, selY - 30, W, 60);
      s.t++;
      rafRef.current = requestAnimationFrame(draw);
    }

    init();
    draw();
    const ro = new ResizeObserver(init);
    ro.observe(canvas);
    return () => { cancelAnimationFrame(rafRef.current); ro.disconnect(); };
  }, [depth]);

  const fracForIdx = (i: number) => (i + 0.5) / DEPTH_LEVELS.length;

  const handleBodyClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const frac = (e.clientY - rect.top) / rect.height;
    const idx = Math.max(0, Math.min(DEPTH_LEVELS.length - 1, Math.round(frac * DEPTH_LEVELS.length - 0.5)));
    onDepthChange(DEPTH_LEVELS[idx]);
  };

  const selFrac = fracForIdx(activeIdx < 0 ? 0 : activeIdx);

  return (
    <div className="rounded-xl overflow-hidden" style={{ background: "#0d1b2a" }}>
      <div className="px-3 py-2 border-b border-white/5">
        <div className="text-[9px] tracking-widest text-white/30 uppercase mb-0.5">select depth</div>
        <div className="flex items-baseline gap-1.5">
          <div className="text-lg font-medium tracking-tight" style={{ color: "#7dd3fc" }}>
            -{Math.abs(depth)}<span className="text-[10px] text-white/30 font-normal ml-0.5">m</span>
          </div>
          <span className="text-[9px]" style={{ color: "rgba(255,255,255,0.3)" }}>{DEPTH_ZONES[Math.abs(depth)] ?? ""}</span>
        </div>
      </div>
      <div className="relative cursor-pointer select-none" style={{ height: 240 }} onClick={handleBodyClick}>
        <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
        <div className="absolute right-0 top-0 bottom-0 w-[3px]" style={{ background: "rgba(255,255,255,0.04)" }}>
          <div className="absolute top-0 left-0 right-0 transition-all duration-300" style={{ height: `${selFrac * 100}%`, background: "rgba(125,211,252,0.18)" }} />
        </div>
        <div className="absolute left-0 right-0 h-px pointer-events-none transition-all duration-300" style={{ top: `${selFrac * 100}%`, background: "rgba(125,211,252,0.5)" }} />
        <div className="absolute w-2 h-2 rounded-full pointer-events-none transition-all duration-300" style={{ right: 12, top: `${selFrac * 100}%`, transform: "translateY(-50%)", background: "#7dd3fc" }} />
        {DEPTH_LEVELS.map((d, i) => {
          const frac = fracForIdx(i);
          const isActive = d === depth;
          return (
            <div
              key={d}
              className="absolute flex items-center gap-1.5 cursor-pointer"
              style={{ left: 14, right: 14, top: `${frac * 100}%`, transform: "translateY(-50%)" }}
              onClick={(e) => { e.stopPropagation(); onDepthChange(d); }}
            >
              <div className="flex-shrink-0 h-px transition-all duration-200" style={{ width: isActive ? 16 : 10, background: isActive ? "#7dd3fc" : "rgba(255,255,255,0.15)" }} />
              <span className="text-[10px] whitespace-nowrap transition-colors duration-200" style={{ color: isActive ? "#7dd3fc" : "rgba(255,255,255,0.3)" }}>
                -{Math.abs(d)}m
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}