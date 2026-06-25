import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Ocean Circulation Forecast",
  description: "Select a Pacific location to explore ocean current forecasts",
};

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export default function Home() {
  return (
    <main className="relative flex h-full flex-1 items-center justify-center overflow-hidden px-6">
      <Image
        src={`${basePath}/bg.png`}
        alt=""
        fill
        priority
        className="object-cover"
      />
      <div className="absolute inset-0 bg-gradient-to-b from-[#000a23]/30 to-[#000a23]/55" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_center,rgba(70,170,255,0.2),transparent_55%)]" />

      <div className="relative z-10 flex w-full max-w-5xl flex-col items-center text-center">
        {/* <div className="mb-5 flex h-[90px] w-[90px] items-center justify-center rounded-full bg-[#008cff]/15 backdrop-blur">
          <svg viewBox="0 0 24 24" fill="none" className="h-12 w-12">
            <path
              d="M2 17c1.5-1.5 3-1.5 4.5 0s3 1.5 4.5 0 3-1.5 4.5 0 3 1.5 4.5 0"
              stroke="#31a8ff"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M2 12c1.5-1.5 3-1.5 4.5 0s3 1.5 4.5 0 3-1.5 4.5 0 3 1.5 4.5 0"
              stroke="#31a8ff"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity="0.6"
            />
          </svg>
        </div> */}

        <h1 className="mb-4 text-4xl font-bold text-white sm:text-5xl">
          Ocean Circulation Forecast
        </h1>
        {/* <p className="mb-14 text-lg text-[#a5b8d6]">
          Advanced ocean intelligence for a better tomorrow.
        </p> */}

        <div className="mb-6 text-base text-[#d7e6ff]">
          Select a location to explore forecasts and ocean data
        </div>

        <div className="flex flex-wrap items-center justify-center gap-8">
          <Link
            href="/niue-current"
            className="w-[300px] rounded-3xl border border-white/10 bg-[#0a142d]/55 p-8 backdrop-blur-xl transition hover:-translate-y-2 hover:border-[#2f9fff] hover:shadow-[0_0_30px_rgba(47,159,255,0.25)]"
          >
            <Image
              src={`${basePath}/NIU.png`}
              alt="Niue flag"
              width={160}
              height={107}
              className="mx-auto mb-5 w-40 rounded-xl"
            />
            <div className="mb-2 text-2xl font-semibold text-white">Niue</div>
            <div className="text-[#9bb3d5]">Ocean Forecast</div>
          </Link>
          <Link
            href="/tuv-current"
            className="w-[300px] rounded-3xl border border-white/10 bg-[#0a142d]/55 p-8 backdrop-blur-xl transition hover:-translate-y-2 hover:border-[#2f9fff] hover:shadow-[0_0_30px_rgba(47,159,255,0.25)]"
          >
            <Image
              src={`${basePath}/TUV.png`}
              alt="Tuvalu flag"
              width={160}
              height={107}
              className="mx-auto mb-5 w-40 rounded-xl"
            />
            <div className="mb-2 text-2xl font-semibold text-white">Tuvalu</div>
            <div className="text-[#9bb3d5]">Ocean Forecast</div>
          </Link>
        </div>

        <div className="mt-20 text-base tracking-wide text-[#6f87a8]">
          Understand. Predict. Protect.
        </div>
      </div>
    </main>
  );
}
