/** Folio PDF's mark (same drawing as app-icon.svg), scaled by its container. */
export function AppIcon({ size = '100%' }: { size?: number | string }) {
  return (
    <svg viewBox="64 64 896 896" width={size} height={size} aria-hidden="true">
      <defs>
        <linearGradient id="folio-pdf-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#F2555A" />
          <stop offset="1" stopColor="#B42430" />
        </linearGradient>
      </defs>
      <rect x="64" y="64" width="896" height="896" rx="200" fill="url(#folio-pdf-bg)" />
      <path d="M352 232h232l144 144v400a40 40 0 0 1-40 40H352a40 40 0 0 1-40-40V272a40 40 0 0 1 40-40z" fill="#fff" />
      <path d="M584 232v104a40 40 0 0 0 40 40h104z" fill="#F9C4C6" />
      <rect x="392" y="504" width="256" height="36" rx="18" fill="#F49A9E" />
      <rect x="392" y="588" width="208" height="36" rx="18" fill="#F49A9E" />
      <rect x="392" y="672" width="160" height="36" rx="18" fill="#F49A9E" />
    </svg>
  );
}
