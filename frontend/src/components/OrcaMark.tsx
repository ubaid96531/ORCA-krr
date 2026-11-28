export function OrcaMark({ size = 26, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <path
        d="M5.5 21.5C3.4 20.4 2.4 18.8 2.2 17.5C4.5 17.7 6.3 18.5 7.4 19.6C9.1 14.3 12.7 11.4 16.2 10.6C16.2 7.6 17.3 4.8 19.4 3.5C19.1 6.4 19.6 8.9 20.6 10.3C24.4 10.6 28.4 13.1 29.6 17.4C29.9 18.5 29.5 19.6 28.5 20.3C26.5 21.7 23.2 22.1 19.8 21.8C19.2 23.8 17.6 25.4 15.6 26.2C16.1 24.4 16 22.7 15.4 21.6C12.3 21.6 9.9 22.2 8.2 23.6C7.3 25.2 6.2 26.5 4.4 27.2C4.5 25.1 5.1 23.2 6.1 21.9C5.9 21.8 5.7 21.6 5.5 21.5Z"
        fill="#f0f2f5"
      />
      <ellipse
        cx="23.5"
        cy="14.9"
        rx="2.3"
        ry="1.2"
        transform="rotate(-14 23.5 14.9)"
        fill="#090b0f"
      />
      <path
        d="M19.8 20.3C22.7 20.5 25.5 20.1 27.4 18.9C25.9 18.2 23.4 18.1 20.7 18.7C19.9 18.9 19.6 19.7 19.8 20.3Z"
        fill="#090b0f"
      />
      <path
        d="M14.1 12.8C15.5 12.2 17.1 12.1 18.4 12.5C17.2 13.7 15.6 14.3 13.9 14.2C13.8 13.7 13.9 13.2 14.1 12.8Z"
        fill="#090b0f"
        fillOpacity="0.45"
      />
    </svg>
  );
}

/**
 * Large multi-layered flat vector Orca illustration for the scroll-driven ocean dive hero.
 * Crafted in crisp obsidian & glacier-white tones with zero neon glow.
 */
export function OrcaHeroIllustration({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 460 230"
      fill="none"
      aria-label="ORCA whale breaching into deep water"
      className={className}
    >
      {/* Back fluke (subtle depth separation) */}
      <path
        d="M78 142 C48 138, 22 124, 12 108 C36 108, 60 116, 84 130 Z"
        fill="#161b24"
        stroke="#f0f2f5"
        strokeOpacity="0.35"
        strokeWidth="1.25"
      />

      {/* Main arched Orca silhouette */}
      <path
        d="M84 148
           C64 164, 44 178, 26 190
           C46 190, 74 176, 98 156
           C132 140, 174 138, 224 146
           C218 164, 206 184, 186 196
           C214 192, 240 176, 256 150
           C296 156, 344 152, 388 136
           C412 128, 434 112, 438 96
           C440 84, 428 66, 398 54
           C358 38, 304 38, 262 52
           C254 32, 248 14, 236 6
           C222 22, 212 48, 210 72
           C164 88, 118 114, 84 148 Z"
        fill="#12161f"
        stroke="#f0f2f5"
        strokeOpacity="0.82"
        strokeWidth="1.75"
        strokeLinejoin="round"
      />

      {/* Arctic slate saddle patch behind dorsal fin */}
      <path
        d="M174 87 C198 76, 222 72, 242 78 C226 94, 202 103, 176 103 C172 97, 171 91, 174 87 Z"
        fill="#273142"
        stroke="#38bdf8"
        strokeOpacity="0.25"
        strokeWidth="1"
      />

      {/* Iconic glacier-white oval eye patch */}
      <path
        d="M342 74 C358 67, 382 67, 392 74 C397 78, 391 86, 376 88 C360 91, 343 87, 338 82 C335 79, 337 76, 342 74 Z"
        fill="#f0f2f5"
      />

      {/* Signature white jaw, throat & swept ventral belly patch */}
      <path
        d="M254 146
           C294 151, 344 148, 386 132
           C407 124, 425 112, 431 101
           C412 104, 384 108, 356 112
           C326 116, 294 124, 264 134
           C234 122, 198 118, 162 126
           C188 134, 222 142, 254 146 Z"
        fill="#f0f2f5"
      />

      {/* Clean pectoral flipper highlight contour */}
      <path
        d="M256 150 C244 172, 218 188, 192 193 C208 181, 220 164, 226 146"
        fill="#12161f"
        stroke="#f0f2f5"
        strokeOpacity="0.65"
        strokeWidth="1.5"
        strokeLinecap="round"
      />

      {/* Crisp hydrodynamic dorsal & nose ridge hairline */}
      <path
        d="M236 12 C243 24, 248 40, 255 56 C296 43, 352 43, 392 58"
        stroke="#38bdf8"
        strokeOpacity="0.45"
        strokeWidth="1.25"
        strokeLinecap="round"
      />
    </svg>
  );
}
