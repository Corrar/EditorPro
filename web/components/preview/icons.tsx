/* ícones inline (traço 2px, herdam currentColor) */
type P = { size?: number };
const S = ({ size = 18, children }: P & { children: React.ReactNode }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
);
export const IcPlay = (p: P) => <S {...p}><path d="M7 4.5v15l12-7.5z" fill="currentColor" stroke="none" /></S>;
export const IcPause = (p: P) => <S {...p}><rect x="6" y="4.5" width="4" height="15" rx="1.2" fill="currentColor" stroke="none" /><rect x="14" y="4.5" width="4" height="15" rx="1.2" fill="currentColor" stroke="none" /></S>;
export const IcRewind = (p: P) => <S {...p}><path d="M6 5v14" /><path d="M19 5.5v13L9 12z" fill="currentColor" stroke="none" /></S>;
export const IcFull = (p: P) => <S {...p}><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></S>;
export const IcSafe = (p: P) => <S {...p}><rect x="3" y="3" width="18" height="18" rx="3" strokeDasharray="3 3" /><rect x="7" y="7" width="10" height="10" rx="1.5" /></S>;
export const IcExport = (p: P) => <S {...p}><path d="M12 15V3M7 8l5-5 5 5" /><path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" /></S>;
export const IcUpload = (p: P) => <S {...p}><path d="M12 16V4M7 9l5-5 5 5" /><path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" /></S>;
export const IcFilm = (p: P) => <S {...p}><rect x="3" y="4" width="18" height="16" rx="3" /><path d="M3 9h18M3 15h18M8 4v16M16 4v16" /></S>;
export const IcClose = (p: P) => <S {...p}><path d="M6 6l12 12M18 6L6 18" /></S>;
export const IcDownload = (p: P) => <S {...p}><path d="M12 4v12M7 11l5 5 5-5" /><path d="M5 20h14" /></S>;
export const IcCaption = (p: P) => <S {...p}><rect x="3" y="5" width="18" height="14" rx="3" /><path d="M7 13h4M13 13h4M7 16h7" /></S>;
export const IcProject = (p: P) => <S {...p}><path d="M4 6h7l2 2h7v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" /></S>;
export const IcSpark = (p: P) => <S {...p}><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" fill="currentColor" stroke="none" /></S>;
