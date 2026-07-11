/**
 * Avalanche network mark (the chain Benzo settles on). Red disc + the Avalanche
 * twin-peak "A"; a faithful in-house rendition, swap for the official brand SVG anytime.
 */
export function AvalancheMark({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" role="img" aria-label="Avalanche" className={className}>
      <circle cx="24" cy="24" r="24" fill="#E84142" />
      <path d="M27.6 13.2 L39.4 33.8 L21.7 33.8 Z" fill="#fff" />
      <path d="M16 22.8 L23.6 33.8 L8.6 33.8 Z" fill="#fff" />
    </svg>
  );
}

/** The Benzo geometric mark - currentColor so it inherits ink/accent. */
export function Logo({ size = 24, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 256 256" fill="currentColor" role="img" aria-label="Benzo" className={className}>
      <path d="M 64 128 L 64.5 128 L 32 95 L 0 64 L 0 0 L 64 0 L 128 64 L 128 64.5 L 161 32 L 192 0 L 256 0 L 256 64 L 192 128 L 128 128 L 128 192 L 96 223 L 63.5 256 L 0 256 L 0 192 Z M 256 192 L 224 223 L 191.5 256 L 128 256 L 128 192 L 192 128 L 256 128 Z" />
    </svg>
  );
}
