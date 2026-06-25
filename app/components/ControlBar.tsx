"use client";

interface Props {
  title?: string;
}

export default function ControlBar({ title = "Niue Ocean Circulation Forecast" }: Props) {
  return (
    <header className="flex items-center gap-3 px-4 py-2 bg-[#1a1f2e] border-b border-[#2d3748] shrink-0">
      <span className="font-semibold text-sm text-white">{title}</span>
      <span className="text-[10px] bg-slate-700 text-slate-300 px-2 py-0.5 rounded-full font-mono">
       
        CROCO
      </span>
    </header>
  );
}
