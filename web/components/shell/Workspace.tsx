'use client';
/* área do editor (dentro do conteúdo, ao lado da sidebar):
   header · painel da ferramenta · preview · chat · timeline (divisor arrastável) */
import { useCallback, useEffect, useState } from 'react';
import Timeline from '@/components/timeline/Timeline';
import Preview from '@/components/preview/Preview';
import ChatPanel from '@/components/chat/ChatPanel';
import MediaBin from '@/components/media/MediaBin';
import Inspector from '@/components/panels/Inspector';
import Header from './Header';
import { IconClose } from './icons';
import type { Pane } from './MobileNav';
import { TOOLS, type ToolId } from './tools';

const TL_KEY = 'ep_tl_h';

function clampTl(h: number) {
  const max = typeof window !== 'undefined' ? Math.max(200, window.innerHeight - 260) : 600;
  return Math.round(Math.max(150, Math.min(max, h)));
}

export default function Workspace({ tool, sideOpen, onCloseSide, pane }: { tool: ToolId; sideOpen: boolean; onCloseSide: () => void; pane: Pane }) {
  const [tlH, setTlH] = useState(300);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    try { const v = Number(localStorage.getItem(TL_KEY)); if (v) setTlH(clampTl(v)); } catch {}
  }, []);

  const save = (h: number) => { try { localStorage.setItem(TL_KEY, String(h)); } catch {} };

  const onResizeStart = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = tlH;
    let last = startH;
    setDragging(true);
    const move = (ev: PointerEvent) => { last = clampTl(startH + (startY - ev.clientY)); setTlH(last); };
    const up = () => {
      setDragging(false);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      save(last);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }, [tlH]);

  const onResizeKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    e.stopPropagation();
    const h = clampTl(tlH + (e.key === 'ArrowUp' ? 24 : -24));
    setTlH(h);
    save(h);
  };

  const label = TOOLS.find((t) => t.id === tool)!.label;

  return (
    <div
      className={`ep-app${sideOpen ? '' : ' side-closed'}${dragging ? ' resizing' : ''}`}
      data-pane={pane}
      style={{ ['--tl-h' as string]: `${tlH}px` }}
    >
      <Header />
      <aside className="ep-side" aria-label={label}>
        <button type="button" className="ep-sideclose" onClick={onCloseSide} aria-label="Fechar painel" title="Fechar painel"><IconClose size={16} /></button>
        {tool === 'media' ? <MediaBin /> : <Inspector tool={tool} />}
      </aside>
      <main className="ep-stage"><Preview /></main>
      <section className="ep-chat" aria-label="Chat com a IA"><ChatPanel /></section>
      <div
        className="ep-tl-resizer" role="separator" aria-orientation="horizontal" aria-label="Altura da timeline"
        aria-valuenow={tlH} tabIndex={0} onPointerDown={onResizeStart} onKeyDown={onResizeKey}
        onDoubleClick={() => { setTlH(300); save(300); }}
        title="Arraste para ajustar a altura da timeline (duplo clique: padrão)"
      ><i /></div>
      <section className="ep-timeline" aria-label="Timeline"><Timeline /></section>
    </div>
  );
}
