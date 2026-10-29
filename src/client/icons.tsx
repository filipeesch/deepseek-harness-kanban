import React from 'react';

type IconProps = { size?: number; className?: string };
const base = (size: number) => ({ width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true, focusable: false });

export function SettingsIcon({ size = 16, className }: IconProps) {
  return <svg {...base(size)} className={className}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4v-.2a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.6-1H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.6v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z" /></svg>;
}
export function TrashIcon({ size = 16, className }: IconProps) {
  return <svg {...base(size)} className={className}><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6" /></svg>;
}
export function CloseIcon({ size = 16, className }: IconProps) {
  return <svg {...base(size)} className={className}><path d="M18 6 6 18M6 6l12 12" /></svg>;
}
export function PlusIcon({ size = 16, className }: IconProps) {
  return <svg {...base(size)} className={className}><path d="M12 5v14M5 12h14" /></svg>;
}
export function CheckSquareIcon({ size = 16, className }: IconProps) {
  return <svg {...base(size)} className={className}><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></svg>;
}
export function InfoIcon({ size = 16, className }: IconProps) {
  return <svg {...base(size)} className={className}><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></svg>;
}
export function PlayIcon({ size = 16, className }: IconProps) {
  return <svg {...base(size)} className={className}><path d="M8 5v14l11-7Z" fill="currentColor" stroke="none" /></svg>;
}
export function AlertIcon({ size = 16, className }: IconProps) {
  return <svg {...base(size)} className={className}><path d="M12 4 2.5 20h19L12 4Z" /><path d="M12 10v4M12 17h.01" /></svg>;
}
export function ClockIcon({ size = 16, className }: IconProps) {
  return <svg {...base(size)} className={className}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>;
}
