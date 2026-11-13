import { useId } from 'react';

// Inzira mark: a winding road from a start point to a destination pin.
export default function Logo({ size = 36 }) {
  const id = `lg${useId().replace(/:/g, '')}`;
  const road = 'M14 51 C14 39 31 45 33 34 C35 23 44 29 47 18';
  return (
    <svg className="logo" width={size} height={size} viewBox="0 0 64 64" role="img" aria-label="Inzira">
      <defs><linearGradient id={id} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#1f5fd1" /><stop offset="1" stopColor="#14a39a" /></linearGradient></defs>
      <rect width="64" height="64" rx="16" fill={`url(#${id})`} />
      <path d={road} fill="none" stroke="#fff" strokeWidth="7" strokeLinecap="round" />
      <path d={road} fill="none" stroke="#1f5fd1" strokeOpacity=".55" strokeWidth="1.6" strokeLinecap="round" strokeDasharray="2.5 4" />
      <circle cx="14" cy="51" r="4.5" fill="#fff" />
      <circle cx="47" cy="17" r="9" fill="#fff" /><circle cx="47" cy="17" r="3.6" fill="#14a39a" />
    </svg>
  );
}
