/** Folio Sheets' mark (same drawing as app-icon.svg), scaled by its container. */
export function AppIcon({ size = '100%' }: { size?: number | string }) {
  return (
    <svg viewBox="64 64 896 896" width={size} height={size} aria-hidden="true">
      <defs>
        <linearGradient id="folio-sheets-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#2FB673" />
          <stop offset="1" stopColor="#0B6B3A" />
        </linearGradient>
      </defs>
      <rect x="64" y="64" width="896" height="896" rx="200" fill="url(#folio-sheets-bg)" />
      <rect x="272" y="272" width="480" height="480" rx="48" fill="#fff" />
      <rect x="272" y="272" width="480" height="112" rx="48" fill="#BDEBD2" />
      <rect x="272" y="336" width="480" height="48" fill="#BDEBD2" />
      <rect x="424" y="272" width="24" height="480" fill="#7FD3A6" />
      <rect x="576" y="272" width="24" height="480" fill="#7FD3A6" />
      <rect x="272" y="496" width="480" height="24" fill="#7FD3A6" />
      <rect x="272" y="616" width="480" height="24" fill="#7FD3A6" />
    </svg>
  );
}
