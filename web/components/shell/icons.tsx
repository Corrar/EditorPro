/* ícones de traço (24×24, currentColor) usados pelo shell, mídia e painéis */
import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 20, children, ...rest }: P & { children: React.ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>
      {children}
    </svg>
  );
}

export const IconMedia = (p: P) => <Svg {...p}><rect x="3" y="4" width="18" height="16" rx="3" /><path d="m10 9 5 3-5 3z" /></Svg>;
export const IconText = (p: P) => <Svg {...p}><path d="M5 6V4h14v2M12 4v16M9 20h6" /></Svg>;
export const IconCaptions = (p: P) => <Svg {...p}><rect x="3" y="5" width="18" height="14" rx="3" /><path d="M7 13h4M13 13h4M7 16h7" /></Svg>;
export const IconEffects = (p: P) => <Svg {...p}><path d="m12 3 1.9 4.6L18.5 9l-4.6 1.9L12 15.5l-1.9-4.6L5.5 9l4.6-1.4z" /><path d="M19 15v4M17 17h4M5 17v3M3.5 18.5h3" /></Svg>;
export const IconTransitions = (p: P) => <Svg {...p}><rect x="3" y="6" width="8" height="12" rx="2" /><rect x="13" y="6" width="8" height="12" rx="2" /><path d="M9 12h6m-2-2 2 2-2 2" /></Svg>;
export const IconAudio = (p: P) => <Svg {...p}><path d="M4 10v4M8 7v10M12 4v16M16 8v8M20 11v2" /></Svg>;
export const IconUndo = (p: P) => <Svg {...p}><path d="M9 14 4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" /></Svg>;
export const IconRedo = (p: P) => <Svg {...p}><path d="m15 14 5-5-5-5" /><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" /></Svg>;
export const IconSun = (p: P) => <Svg {...p}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></Svg>;
export const IconMoon = (p: P) => <Svg {...p}><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" /></Svg>;
export const IconExport = (p: P) => <Svg {...p}><path d="M12 15V3m0 0-4 4m4-4 4 4" /><path d="M4 14v4a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3v-4" /></Svg>;
export const IconUpload = (p: P) => <Svg {...p}><path d="M12 16V4m0 0-4 4m4-4 4 4" /><path d="M4 16v2a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3v-2" /></Svg>;
export const IconPlus = (p: P) => <Svg {...p}><path d="M12 5v14M5 12h14" /></Svg>;
export const IconTrash = (p: P) => <Svg {...p}><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" /></Svg>;
export const IconSpark = (p: P) => <Svg {...p}><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" /><circle cx="12" cy="12" r="2.5" /></Svg>;
export const IconFolder = (p: P) => <Svg {...p}><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></Svg>;
export const IconClose = (p: P) => <Svg {...p}><path d="M6 6l12 12M18 6 6 18" /></Svg>;
export const IconCheck = (p: P) => <Svg {...p}><path d="m5 12 5 5 9-10" /></Svg>;
export const IconChat = (p: P) => <Svg {...p}><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" /></Svg>;
export const IconTimeline = (p: P) => <Svg {...p}><path d="M3 7h10M3 12h18M3 17h7" /><path d="M16 4v6" /></Svg>;
export const IconVideo = (p: P) => <Svg {...p}><rect x="3" y="6" width="13" height="12" rx="2" /><path d="m16 10 5-3v10l-5-3" /></Svg>;
export const IconImage = (p: P) => <Svg {...p}><rect x="3" y="4" width="18" height="16" rx="3" /><circle cx="9" cy="10" r="2" /><path d="m21 16-5-5-9 9" /></Svg>;
export const IconMusic = (p: P) => <Svg {...p}><path d="M9 18V5l11-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="17" cy="16" r="3" /></Svg>;
export const IconZoom = (p: P) => <Svg {...p}><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4M11 8v6M8 11h6" /></Svg>;
export const IconHome = (p: P) => <Svg {...p}><path d="m3 11 9-7 9 7v8a2 2 0 0 1-2 2h-4v-6H9v6H5a2 2 0 0 1-2-2z" /></Svg>;
export const IconMute = (p: P) => <Svg {...p}><path d="M11 5 6 9H3v6h3l5 4zM22 9l-6 6M16 9l6 6" /></Svg>;
export const IconCollapse = (p: P) => <Svg {...p}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16" /></Svg>;
export const IconSearch = (p: P) => <Svg {...p}><circle cx="11" cy="11" r="7" /><path d="m21 21-4.5-4.5" /></Svg>;
export const IconLogout = (p: P) => <Svg {...p}><path d="m15 17 5-5-5-5M20 12H9M12 20H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h6" /></Svg>;
export const IconChev = (p: P) => <Svg {...p}><path d="m8 9.5 4-4 4 4M8 14.5l4 4 4-4" /></Svg>;
export const IconCog = (p: P) => <Svg {...p}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 7.5 19l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 3 13.6a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.7 7l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 2.7-1.1V3a2 2 0 1 1 4 0v.1A1.6 1.6 0 0 0 16.5 5l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1.5z" /></Svg>;
export const IconDownload = (p: P) => <Svg {...p}><path d="M12 3v12M7 10l5 5 5-5M5 21h14" /></Svg>;
export const IconGrid = (p: P) => <Svg {...p}><rect x="4" y="4" width="7" height="7" rx="1" /><rect x="13" y="4" width="7" height="7" rx="1" /><rect x="4" y="13" width="7" height="7" rx="1" /><rect x="13" y="13" width="7" height="7" rx="1" /></Svg>;
export const IconShare = (p: P) => <Svg {...p}><path d="M12 15V3m0 0L8 7m4-4 4 4" /><path d="M5 11v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-8" /></Svg>;
export const IconSticker = (p: P) => <Svg {...p}><path d="M14 3H7a4 4 0 0 0-4 4v10a4 4 0 0 0 4 4h7l7-7V7a4 4 0 0 0-4-4z" /><path d="M14 21v-3a4 4 0 0 1 4-4h3" /><path d="M8.5 10h.01M14.5 10h.01M9 14.5a4 4 0 0 0 5 0" /></Svg>;
export const IconFilters = (p: P) => <Svg {...p}><circle cx="9" cy="9" r="5.5" /><circle cx="15" cy="9" r="5.5" /><circle cx="12" cy="15" r="5.5" /></Svg>;
export const IconSliders = (p: P) => <Svg {...p}><path d="M4 7h10M18 7h2M4 17h4M12 17h8" /><circle cx="16" cy="7" r="2" /><circle cx="10" cy="17" r="2" /></Svg>;
export const IconCanvas = (p: P) => <Svg {...p}><rect x="3" y="3" width="18" height="18" rx="3" /><rect x="8" y="6" width="8" height="12" rx="1.5" /></Svg>;
export const IconEdit = (p: P) => <Svg {...p}><circle cx="6" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M20 4 8.1 15.9M14.5 14.5 20 20M8.1 8.1 12 12" /></Svg>;
export const IconMic = (p: P) => <Svg {...p}><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></Svg>;
export const IconCopy = (p: P) => <Svg {...p}><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></Svg>;
export const IconPencil = (p: P) => <Svg {...p}><path d="M4 20h4L19 9l-4-4L4 16z" /><path d="m13.5 6.5 4 4" /></Svg>;
