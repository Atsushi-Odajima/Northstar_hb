export function LogoMark({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <circle cx="32" cy="32" r="30" fill="none" stroke="currentColor" strokeWidth="2" opacity=".35" />
      <path d="M32 6 L36.5 27.5 L58 32 L36.5 36.5 L32 58 L27.5 36.5 L6 32 L27.5 27.5 Z" fill="currentColor" />
      <circle cx="32" cy="32" r="3.2" fill="var(--bg-elev, #fff)" />
    </svg>
  );
}
