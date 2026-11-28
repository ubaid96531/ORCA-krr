import { OrcaHeroIllustration } from "./OrcaMark";

/**
 * Subtle underwater ocean atmosphere rendered behind every workspace tab
 * (and underwater phase of Home): delicate drifting light-wave contour lines,
 * crisp 1px rising ocean bubbles, and a calm pod of 5 miniature gliding Orcas —
 * zero neon glow, GPU transform only.
 */

const AMBIENT_BUBBLES = [
  { left: "6%", size: 8, duration: 15, delay: 0, drift: "a" },
  { left: "13%", size: 5, duration: 19, delay: -6, drift: "b" },
  { left: "21%", size: 10, duration: 17, delay: -11, drift: "a" },
  { left: "29%", size: 6, duration: 22, delay: -3, drift: "b" },
  { left: "37%", size: 4, duration: 16, delay: -9, drift: "a" },
  { left: "46%", size: 9, duration: 21, delay: -14, drift: "b" },
  { left: "54%", size: 5, duration: 18, delay: -4, drift: "a" },
  { left: "63%", size: 11, duration: 24, delay: -8, drift: "b" },
  { left: "71%", size: 6, duration: 16, delay: -13, drift: "a" },
  { left: "78%", size: 8, duration: 20, delay: -2, drift: "b" },
  { left: "86%", size: 5, duration: 17, delay: -10, drift: "a" },
  { left: "93%", size: 9, duration: 23, delay: -5, drift: "b" },
  { left: "17%", size: 4, duration: 14, delay: -7, drift: "b" },
  { left: "67%", size: 4.5, duration: 15, delay: -12, drift: "a" },
  { left: "82%", size: 6.5, duration: 19, delay: -15, drift: "a" },
];

const ORCA_POD = [
  { top: "14%", width: 168, dir: "right" as const, duration: 34, delay: -6, peakOpacity: 0.25 },
  { top: "36%", width: 122, dir: "left" as const, duration: 44, delay: -18, peakOpacity: 0.19 },
  { top: "54%", width: 146, dir: "right" as const, duration: 40, delay: -26, peakOpacity: 0.22 },
  { top: "73%", width: 104, dir: "left" as const, duration: 50, delay: -11, peakOpacity: 0.16 },
  { top: "84%", width: 82, dir: "right" as const, duration: 56, delay: -38, peakOpacity: 0.14 },
];

export function OceanBackdrop({
  opacity = 1,
  showSwimmers = true,
}: {
  opacity?: number;
  showSwimmers?: boolean;
}) {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-0 overflow-hidden"
      style={{ opacity }}
    >
      {/* Subtle underwater undulating light-wave contour ribbons */}
      <svg
        viewBox="0 0 1440 900"
        preserveAspectRatio="none"
        className="absolute inset-0 h-full w-[114%] -ml-[7%]"
      >
        <g className="anim-wave-a">
          <path
            d="M-60,180 C240,120 460,240 760,175 C1060,110 1240,225 1540,165"
            fill="none"
            stroke="#38bdf8"
            strokeOpacity="0.09"
            strokeWidth="1.2"
          />
          <path
            d="M-60,210 C260,152 480,268 780,205 C1080,142 1260,252 1540,192"
            fill="none"
            stroke="#f0f2f5"
            strokeOpacity="0.045"
            strokeWidth="1"
          />
          <path
            d="M-60,640 C280,580 540,700 840,630 C1140,560 1300,680 1540,620"
            fill="none"
            stroke="#38bdf8"
            strokeOpacity="0.08"
            strokeWidth="1.2"
          />
        </g>

        <g className="anim-wave-b">
          <path
            d="M-60,410 C220,468 480,350 780,415 C1080,480 1280,362 1540,420"
            fill="none"
            stroke="#38bdf8"
            strokeOpacity="0.075"
            strokeWidth="1.1"
          />
          <path
            d="M-60,438 C240,492 500,378 800,442 C1100,506 1300,390 1540,446"
            fill="none"
            stroke="#2dd4bf"
            strokeOpacity="0.055"
            strokeWidth="1"
          />
          <path
            d="M-60,790 C260,740 520,845 840,785 C1160,725 1320,825 1540,775"
            fill="none"
            stroke="#f0f2f5"
            strokeOpacity="0.04"
            strokeWidth="1"
          />
        </g>

        <path
          className="anim-wave-a"
          d="M-60,520 C320,485 620,565 960,515 C1200,480 1360,545 1540,510 L1540,550 C1360,585 1200,520 960,555 C620,605 320,525 -60,560 Z"
          fill="#38bdf8"
          fillOpacity="0.018"
        />
        <path
          className="anim-wave-b"
          d="M-60,265 C300,305 640,225 980,275 C1220,310 1360,245 1540,280 L1540,312 C1360,277 1220,342 980,307 C640,257 300,337 -60,297 Z"
          fill="#2dd4bf"
          fillOpacity="0.015"
        />
      </svg>

      {/* Calm pod of 5 ambient gliding Orcas cruising across different ocean depths */}
      {showSwimmers &&
        ORCA_POD.map((whale, idx) => (
          <div
            key={idx}
            className={whale.dir === "right" ? "anim-swim-right" : "anim-swim-left"}
            style={
              {
                position: "absolute",
                left: 0,
                top: whale.top,
                width: `${whale.width}px`,
                animationDuration: `${whale.duration}s`,
                animationDelay: `${whale.delay}s`,
                "--orca-peak": whale.peakOpacity,
              } as React.CSSProperties
            }
          >
            <OrcaHeroIllustration className="w-full h-auto" />
          </div>
        ))}

      {/* Gently rising crisp 1px ocean bubbles */}
      {AMBIENT_BUBBLES.map((b, idx) => (
        <span
          key={idx}
          className={b.drift === "a" ? "anim-bubble-a" : "anim-bubble-b"}
          style={{
            position: "absolute",
            left: b.left,
            bottom: "-20px",
            width: `${b.size}px`,
            height: `${b.size}px`,
            borderRadius: "9999px",
            border: "1px solid rgba(56, 189, 248, 0.24)",
            background: "rgba(56, 189, 248, 0.03)",
            animationDuration: `${b.duration}s`,
            animationDelay: `${b.delay}s`,
          }}
        >
          {b.size >= 7 && (
            <span
              style={{
                position: "absolute",
                top: "18%",
                left: "20%",
                width: "28%",
                height: "28%",
                borderRadius: "9999px",
                backgroundColor: "rgba(240, 242, 245, 0.35)",
              }}
            />
          )}
        </span>
      ))}
    </div>
  );
}
