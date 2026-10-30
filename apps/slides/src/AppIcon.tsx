/** Folio Slides' mark (same drawing as app-icon.svg), scaled by its container. */
export function AppIcon({ size = '100%' }: { size?: number | string }) {
  return (
    <svg viewBox="64 64 896 896" width={size} height={size} aria-hidden="true">
      <defs>
        <linearGradient id="folio-slides-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#FF8F4F" />
          <stop offset="1" stopColor="#C4401A" />
        </linearGradient>
      </defs>
      <rect x="64" y="64" width="896" height="896" rx="200" fill="url(#folio-slides-bg)" />
      <path d="M352 232h232l144 144v400a40 40 0 0 1-40 40H352a40 40 0 0 1-40-40V272a40 40 0 0 1 40-40z" fill="#fff" />
      <path d="M584 232v104a40 40 0 0 0 40 40h104z" fill="#FFD2BC" />
      <path d="M520 448v136h136a136 136 0 1 1-136-136z" fill="#F9A27A" />
      <path d="M552 416a136 136 0 0 1 136 136H552z" fill="#E8643A" />
      <rect x="392" y="664" width="256" height="36" rx="18" fill="#F9A27A" />
    </svg>
  );
}
