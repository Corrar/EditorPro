'use client';
/* Posição de menus flutuantes abertos num ponto (clique direito / toque longo / régua).
 * Mesma regra do Popover da barra: mede a altura real, usa o visualViewport, abre abaixo
 * ou acima conforme couber; se não couber, ocupa a altura disponível com rolagem.
 * Fica invisível até medir. */
import { useLayoutEffect, useState, type CSSProperties, type RefObject } from 'react';

export interface FloatBox { top: number; left: number; maxH: number }

const M = 8;

/** cálculo puro (testável): ponto (x,y) em coordenadas da janela, menu w×h, tela visível */
export function placeAtPoint(
  x: number, y: number, w: number, h: number,
  view: { width: number; height: number; offsetLeft?: number; offsetTop?: number },
  dx = 0,
): FloatBox {
  const ox = view.offsetLeft ?? 0;
  const oy = view.offsetTop ?? 0;
  const vw = view.width;
  const vh = view.height;
  const py = y - oy; // ponto relativo à parte visível
  const below = vh - py - M;
  const above = py - M;
  let top: number;
  let maxH: number;
  if (h <= below) { top = py; maxH = below; }
  else if (h <= above) { top = py - h; maxH = above; }
  else if (below >= above) { top = py; maxH = below; }
  else { maxH = above; top = Math.max(M, py - Math.min(h, maxH)); }
  if (maxH < 220) { top = M; maxH = vh - 2 * M; }
  const ww = Math.min(w, vw - 2 * M);
  const left = Math.max(M, Math.min(x - ox + dx, vw - ww - M));
  return { top: top + oy, left: left + ox, maxH };
}

/** estilo pronto p/ um `.ep-tl-menu` aberto em (x,y); `deps` remede quando o conteúdo muda */
export function useFloatAt(
  ref: RefObject<HTMLElement>, open: boolean, x: number, y: number, dx = 0, deps: unknown[] = [],
): CSSProperties {
  const [box, setBox] = useState<FloatBox | null>(null);
  useLayoutEffect(() => {
    if (!open) { setBox(null); return; }
    const place = () => {
      const el = ref.current;
      if (!el) return;
      const vv = window.visualViewport;
      const view = vv
        ? { width: vv.width, height: vv.height, offsetLeft: vv.offsetLeft, offsetTop: vv.offsetTop }
        : { width: window.innerWidth, height: window.innerHeight };
      const b = placeAtPoint(x, y, el.offsetWidth, el.scrollHeight, view, dx);
      setBox((p) => (p && Math.abs(p.top - b.top) < 0.5 && Math.abs(p.left - b.left) < 0.5 && Math.abs(p.maxH - b.maxH) < 0.5 ? p : b));
    };
    place();
    const vv = window.visualViewport;
    vv?.addEventListener('resize', place);
    return () => vv?.removeEventListener('resize', place);
  }, [open, x, y, dx, ref, ...deps]); // eslint-disable-line react-hooks/exhaustive-deps
  return {
    top: box?.top ?? 0,
    left: box?.left ?? 0,
    maxWidth: 'calc(100vw - 16px)',
    maxHeight: box?.maxH,
    overflowY: 'auto',
    overscrollBehavior: 'contain',
    visibility: box ? 'visible' : 'hidden',
  };
}
