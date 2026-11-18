'use client';
/* alça arrastável dos bottom-sheets (celular). Arrastar ajusta a altura
   (--sheet-h no elemento pai); soltar abaixo de 22% da tela fecha. */
import { useRef } from 'react';

export default function SheetHandle({ onClose, label }: { onClose: () => void; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const start = (e: React.PointerEvent) => {
    const host = ref.current?.parentElement;
    if (!host) return;
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    const vh = window.visualViewport?.height ?? window.innerHeight;
    const startY = e.clientY;
    const startH = host.getBoundingClientRect().height;
    host.classList.add('dragging');
    let h = startH;
    const move = (ev: PointerEvent) => {
      h = Math.max(80, Math.min(vh - 24, startH + (startY - ev.clientY)));
      host.style.setProperty('--sheet-h', `${h}px`);
    };
    const up = () => {
      host.classList.remove('dragging');
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      if (h < vh * 0.22) { host.style.removeProperty('--sheet-h'); onClose(); return; }
      // encaixa em ~metade ou quase tela cheia
      const snap = h > vh * 0.68 ? vh * 0.92 : vh * 0.55;
      host.style.setProperty('--sheet-h', `${Math.round(snap)}px`);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };
  return (
    <div ref={ref} className="ep-sheethandle" onPointerDown={start} role="button" aria-label={`Arraste para redimensionar ${label}; arraste para baixo para fechar`} tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
      <i />
      <button type="button" className="ep-sheetclose" onPointerDown={(e) => e.stopPropagation()} onClick={onClose} aria-label={`Fechar ${label}`}>✕</button>
    </div>
  );
}
