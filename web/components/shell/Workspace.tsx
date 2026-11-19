'use client';
/* área do editor: header · painel da ferramenta · preview · chat · timeline.
   Desktop: grade com colunas. 900–1099: painel e chat viram gavetas.
   ≤899: empilhado (preview em cima, timeline embaixo) e painel/chat em bottom-sheets.
   Os módulos (Preview/Timeline/Chat) ocupam contêineres mensuráveis
   (container-type: size) — podem usar ResizeObserver ou container queries. */
import { useCallback, useEffect, useState } from 'react';
import Timeline from '@/components/timeline/Timeline';
import Preview from '@/components/preview/Preview';
import ChatPanel from '@/components/chat/ChatPanel';
import MediaBin from '@/components/media/MediaBin';
import Inspector from '@/components/panels/Inspector';
import { useEditor } from '@/lib/store';
import { ASPECT_SIZES } from '@/lib/types';
import Header from './Header';
import { IconChat, IconClose } from './icons';
import SheetHandle from './Sheet';
import { toolDef, type ToolId } from './tools';

const TL_KEY = 'ep_tl_h';
const PV_KEY = 'ep_pv_h';
const mobileMq = () => typeof window !== 'undefined' && window.matchMedia('(max-width: 899px)').matches;

function clampTl(h: number) {
  const max = typeof window !== 'undefined' ? Math.max(200, window.innerHeight - 260) : 600;
  return Math.round(Math.max(150, Math.min(max, h)));
}
function clampPv(h: number) {
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
  return Math.round(Math.max(120, Math.min(vh - 300, h)));
}

export interface WorkspaceProps {
  tool: ToolId;
  sideOpen: boolean;
  onCloseSide: () => void;
  chatOpen: boolean;
  onChat: (open: boolean) => void;
  onHome?: () => void;
}

export default function Workspace({ tool, sideOpen, onCloseSide, chatOpen, onChat, onHome }: WorkspaceProps) {
  const [tlH, setTlH] = useState(300);
  const [pvH, setPvH] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const aspect = useEditor((s) => s.project.aspect);
  const liveRunning = useEditor((s) => s.live.running);

  useEffect(() => {
    try {
      const v = Number(localStorage.getItem(TL_KEY)); if (v) setTlH(clampTl(v));
      const p = Number(localStorage.getItem(PV_KEY)); if (p) setPvH(clampPv(p));
    } catch {}
  }, []);

  // altura padrão do preview no celular: proporcional ao formato, limitada
  const { width: aw, height: ah } = ASPECT_SIZES[aspect];
  const pvDefault = typeof window !== 'undefined' ? clampPv(Math.min(window.innerHeight * (window.innerWidth < 900 ? 0.53 : 0.5), (window.innerWidth - 16) * (ah / aw))) : 360;

  const save = (k: string, h: number) => { try { localStorage.setItem(k, String(h)); } catch {} };

  /** divisor: no desktop ajusta a timeline; no celular ajusta o preview */
  const onResizeStart = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    const mobile = mobileMq();
    const startY = e.clientY;
    const startH = mobile ? (pvH ?? pvDefault) : tlH;
    let last = startH;
    setDragging(true);
    const move = (ev: PointerEvent) => {
      const dy = ev.clientY - startY;
      if (mobile) { last = clampPv(startH + dy); setPvH(last); } else { last = clampTl(startH - dy); setTlH(last); }
    };
    const up = () => {
      setDragging(false);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      save(mobile ? PV_KEY : TL_KEY, last);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }, [tlH, pvH, pvDefault]);

  const onResizeKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    e.stopPropagation();
    const up = e.key === 'ArrowUp';
    if (mobileMq()) { const h = clampPv((pvH ?? pvDefault) + (up ? -24 : 24)); setPvH(h); save(PV_KEY, h); }
    else { const h = clampTl(tlH + (up ? 24 : -24)); setTlH(h); save(TL_KEY, h); }
  };

  const label = toolDef(tool).label;

  return (
    <div
      className={`ep-app${sideOpen ? '' : ' side-closed'}${chatOpen ? ' chat-open' : ''}${dragging ? ' resizing' : ''}`}
      style={{ ['--tl-h' as string]: `${tlH}px`, ['--pv-h' as string]: `${pvH ?? pvDefault}px` }}
    >
      <Header onHome={onHome} />
      <aside className="ep-side" aria-label={label}>
        <SheetHandle onClose={onCloseSide} label={label} />
        <button type="button" className="ep-sideclose" onClick={onCloseSide} aria-label="Fechar painel" title="Fechar painel"><IconClose size={16} /></button>
        <div className="ep-sidebody">{tool === 'media' ? <MediaBin /> : <Inspector tool={tool} />}</div>
      </aside>
      <main className="ep-stage ep-measure"><Preview /></main>
      <section className="ep-chat" aria-label="Chat com a IA">
        <SheetHandle onClose={() => onChat(false)} label="o chat" />
        <button type="button" className="ep-chatclose" onClick={() => onChat(false)} aria-label="Fechar chat" title="Fechar chat"><IconClose size={16} /></button>
        <div className="ep-chatbody ep-measure"><ChatPanel /></div>
      </section>
      <div
        className="ep-tl-resizer" role="separator" aria-orientation="horizontal" aria-label="Divisor entre preview e timeline"
        aria-valuenow={tlH} tabIndex={0} onPointerDown={onResizeStart} onKeyDown={onResizeKey}
        onDoubleClick={() => { setTlH(300); save(TL_KEY, 300); setPvH(null); try { localStorage.removeItem(PV_KEY); } catch {} }}
        title="Arraste para ajustar (duplo clique: padrão)"
      ><i /></div>
      <section className="ep-timeline ep-measure" aria-label="Timeline"><Timeline /></section>
      <button type="button" className={`ep-aifab${liveRunning ? ' live' : ''}`} onClick={() => onChat(!chatOpen)} aria-label="Abrir chat com a IA" aria-pressed={chatOpen}>
        <IconChat size={18} /><span>IA</span>
      </button>
      {(sideOpen || chatOpen) && <div className="ep-scrim" onClick={() => { onCloseSide(); onChat(false); }} />}
    </div>
  );
}
