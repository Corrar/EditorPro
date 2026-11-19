'use client';
/* =====================================================================
   v2.4 — cursor da IA (pedido do Bruno: "mostre em tempo real a edição…
   utilize um cursor para representar a IA").
   Overlay fixo, sem capturar toques. Enquanto store.live.running, a cada
   op (live.current): passa pelo botão da ferramenta (data-ep-tool) e "clica",
   vai ao alvo (lib/aiCursor: clipe, tempo na timeline, ponto no vídeo) e
   "clica" quando a op é aplicada (live.done avança). Balão com op.explain.
   Alvo invisível → cai no preview. prefers-reduced-motion: pula direto.
   ===================================================================== */
import { useEffect, useRef, useState } from 'react';
import { aiTargetFor, resolveAiTarget, type AiTarget, type ScreenPoint } from '@/lib/aiCursor';
import { useEditor } from '@/lib/store';

const MOVE_MS = 420;
const HOP_MS = 340;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const reduced = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function visibleRect(el: Element | null): DOMRect | null {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth ? r : null;
}

/** botão de ferramenta visível (pode haver vários: rail, barra do celular, abas, menu) */
function toolPoint(tool: string): ScreenPoint | null {
  for (const el of document.querySelectorAll<HTMLElement>(`[data-ep-tool="${CSS.escape(tool)}"]`)) {
    const r = visibleRect(el);
    if (r && getComputedStyle(el).visibility !== 'hidden') return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }
  return null;
}

/** quadro do vídeo na tela (contrato data-ep-preview; senão, o palco do shell) */
function previewPoint(x = 0.5, y = 0.5): ScreenPoint | null {
  const r = visibleRect(document.querySelector('[data-ep-preview]')) ?? visibleRect(document.querySelector('.ep-stage'));
  return r ? { x: r.left + x * r.width, y: r.top + y * r.height } : null;
}

function targetPoint(t: AiTarget): ScreenPoint | null {
  const p = resolveAiTarget(t);
  if (p) return p;
  if (t.kind === 'clip') {
    const r = visibleRect(document.querySelector(`[data-clip-id="${CSS.escape(t.clipId)}"]`));
    if (r) return { x: r.left + Math.min(r.width / 2, 48), y: r.top + r.height / 2 };
  }
  if (t.kind === 'preview') return previewPoint(t.x, t.y);
  if (t.kind === 'tool') return toolPoint(t.tool);
  return previewPoint();
}

function flash(t: AiTarget | null) {
  if (!t || t.kind !== 'clip') return;
  const el = document.querySelector<HTMLElement>(`[data-ep-clip="${CSS.escape(t.clipId)}"]`) ?? document.querySelector<HTMLElement>(`[data-clip-id="${CSS.escape(t.clipId)}"]`);
  if (!el) return;
  el.classList.remove('ep-aiflash'); void el.offsetWidth; el.classList.add('ep-aiflash');
  setTimeout(() => el.classList.remove('ep-aiflash'), 700);
}

export default function AiCursor() {
  const running = useEditor((s) => s.live.running);
  const current = useEditor((s) => s.live.current);
  const done = useEditor((s) => s.live.done);
  const [shown, setShown] = useState(false);
  const [pos, setPos] = useState<ScreenPoint>({ x: -100, y: -100 });
  const [instant, setInstant] = useState(true);
  const [label, setLabel] = useState('');
  const [clicks, setClicks] = useState<{ id: number; x: number; y: number }[]>([]);
  const posRef = useRef(pos);
  const token = useRef(0);
  const target = useRef<AiTarget | null>(null);
  const clickId = useRef(0);

  const click = (p = posRef.current) => {
    const id = ++clickId.current;
    setClicks((c) => [...c.slice(-3), { id, x: p.x, y: p.y }]);
    setTimeout(() => setClicks((c) => c.filter((k) => k.id !== id)), 650);
  };
  const moveTo = async (p: ScreenPoint, ms: number, my: number) => {
    posRef.current = p;
    setInstant(reduced());
    setPos(p);
    if (!reduced()) await sleep(ms);
    return my === token.current;
  };

  // aparece/some com a edição ao vivo
  useEffect(() => {
    if (running) {
      const start = previewPoint(0.5, 0.62) ?? { x: innerWidth / 2, y: innerHeight / 2 };
      if (!shown) { posRef.current = start; setInstant(true); setPos(start); }
      setShown(true);
      return;
    }
    token.current++;
    const t = setTimeout(() => { setShown(false); setLabel(''); }, 700);
    return () => clearTimeout(t);
  }, [running]); // eslint-disable-line react-hooks/exhaustive-deps

  // nova op: ferramenta → alvo
  useEffect(() => {
    if (!running || !current) return;
    const my = ++token.current;
    const t = aiTargetFor(useEditor.getState().project, current);
    target.current = t;
    setLabel(current.explain || 'Editando');
    void (async () => {
      if (t?.tool && t.kind !== 'tool') {
        const tp = toolPoint(t.tool);
        if (tp) {
          if (!(await moveTo(tp, HOP_MS, my))) return;
          click(tp);
          if (!reduced()) await sleep(120);
          if (my !== token.current) return;
        }
      }
      const p = (t && targetPoint(t)) ?? previewPoint();
      if (p) await moveTo(p, MOVE_MS, my);
    })();
  }, [current, running]); // eslint-disable-line react-hooks/exhaustive-deps

  // op aplicada: "clique" no alvo
  useEffect(() => {
    if (!running || !done) return;
    click();
    flash(target.current);
  }, [done]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!shown) return null;
  const flip = pos.x > innerWidth - 200;
  const style = { transform: `translate3d(${Math.round(pos.x)}px, ${Math.round(pos.y)}px, 0)` };
  return (
    <div className={`ep-aicursor-layer${running ? '' : ' leaving'}`} aria-hidden="true">
      <div className={`ep-aicursor-trail${instant ? ' instant' : ''}`} style={style} />
      {clicks.map((c) => <span key={c.id} className="ep-aicursor-click" style={{ left: c.x, top: c.y }} />)}
      <div className={`ep-aicursor${instant ? ' instant' : ''}${flip ? ' flip' : ''}`} style={style}>
        <svg width="22" height="24" viewBox="0 0 22 24" className="ep-aicursor-arrow"><path d="M2 2 L19 11.5 L11.2 13.4 L7.6 21.5 Z" /></svg>
        <span className="ep-aicursor-tag">✦ IA</span>
        {label && <span className="ep-aicursor-bubble" role="status">{label}</span>}
      </div>
    </div>
  );
}
