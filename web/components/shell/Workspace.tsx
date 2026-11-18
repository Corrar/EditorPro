'use client';
/* layout do editor: rail + painel lateral + preview + chat + timeline (com divisor arrastável) */
import { useCallback, useEffect, useRef, useState } from 'react';
import Timeline from '@/components/timeline/Timeline';
import Preview from '@/components/preview/Preview';
import ChatPanel from '@/components/chat/ChatPanel';
import MediaBin from '@/components/media/MediaBin';
import Inspector from '@/components/panels/Inspector';
import { IconChat, IconClose, IconTimeline } from './icons';
import Logo from './Logo';
import Topbar from './Topbar';
import { TOOLS, type ToolId } from './tools';

type Pane = 'timeline' | 'chat' | 'side';
const TL_KEY = 'ep_tl_h';

function clampTl(h: number) {
  const max = typeof window !== 'undefined' ? Math.max(200, window.innerHeight - 260) : 600;
  return Math.round(Math.max(150, Math.min(max, h)));
}

export default function Workspace({ dark, onTheme, onHome }: { dark: boolean; onTheme: () => void; onHome: () => void }) {
  const [tool, setTool] = useState<ToolId>('media');
  const [sideOpen, setSideOpen] = useState(true);
  const [pane, setPane] = useState<Pane>('timeline');
  const [tlH, setTlH] = useState(300);
  const [dragging, setDragging] = useState(false);
  const appRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try { const v = Number(localStorage.getItem(TL_KEY)); if (v) setTlH(clampTl(v)); } catch {}
    if (window.matchMedia('(max-width: 1100px)').matches) setSideOpen(false);
  }, []);

  const pickTool = (id: ToolId) => {
    const mobile = window.matchMedia('(max-width: 720px)').matches;
    if (mobile) { setTool(id); setPane('side'); return; }
    if (id === tool) setSideOpen((v) => !v);
    else { setTool(id); setSideOpen(true); }
  };

  const onResizeStart = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = tlH;
    setDragging(true);
    let last = startH;
    const move = (ev: PointerEvent) => { last = clampTl(startH + (startY - ev.clientY)); setTlH(last); };
    const up = () => {
      setDragging(false);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      try { localStorage.setItem(TL_KEY, String(last)); } catch {}
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
    try { localStorage.setItem(TL_KEY, String(h)); } catch {}
  };

  const toolDef = TOOLS.find((t) => t.id === tool)!;

  return (
    <div
      ref={appRef}
      className={`ep-app${sideOpen ? '' : ' side-closed'}${dragging ? ' resizing' : ''}`}
      data-pane={pane}
      style={{ ['--tl-h' as string]: `${tlH}px` }}
    >
      <nav className="ep-rail" aria-label="Ferramentas">
        <div className="ep-raillogo"><Logo word={false} onClick={onHome} /></div>
        <button type="button" className={`ep-railbtn mob${pane === 'timeline' ? ' active' : ''}`} onClick={() => setPane('timeline')}>
          <IconTimeline /><span>Timeline</span>
        </button>
        {TOOLS.map(({ id, label, Icon }) => {
          const active = id === tool && (sideOpen || pane === 'side');
          return (
            <button
              key={id} type="button" aria-pressed={active}
              className={`ep-railbtn${id === tool ? ' cur' : ''}${active ? ' active' : ''}`}
              onClick={() => pickTool(id)} title={label}
            >
              <Icon /><span>{label}</span>
            </button>
          );
        })}
        <button type="button" className={`ep-railbtn mob${pane === 'chat' ? ' active' : ''}`} onClick={() => setPane('chat')}>
          <IconChat /><span>Chat IA</span>
        </button>
      </nav>

      <Topbar dark={dark} onTheme={onTheme} onHome={onHome} />

      <aside className="ep-side" aria-label={toolDef.label}>
        <button type="button" className="ep-sideclose" onClick={() => setSideOpen(false)} aria-label="Fechar painel" title="Fechar painel"><IconClose size={16} /></button>
        {tool === 'media' ? <MediaBin /> : <Inspector tool={tool} />}
      </aside>

      <main className="ep-stage"><Preview /></main>
      <section className="ep-chat" aria-label="Chat com a IA"><ChatPanel /></section>
      <div
        className="ep-tl-resizer" role="separator" aria-orientation="horizontal" aria-label="Altura da timeline"
        aria-valuenow={tlH} tabIndex={0} onPointerDown={onResizeStart} onKeyDown={onResizeKey}
        onDoubleClick={() => { setTlH(300); try { localStorage.setItem(TL_KEY, '300'); } catch {} }}
        title="Arraste para ajustar a altura da timeline (duplo clique: padrão)"
      ><i /></div>
      <section className="ep-timeline" aria-label="Timeline"><Timeline /></section>
    </div>
  );
}
