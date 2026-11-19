'use client';
/* pílula "1080p ▾" do topo do editor no celular: define o padrão do Exportar */
import { useEffect, useRef, useState } from 'react';
import Icon from '@/components/ui/Icon';
import { RES_LABEL, useExportPref, type ExportPrefQuality } from './exportPref';

const QS: { id: ExportPrefQuality; hint: string }[] = [
  { id: 'hd', hint: 'Mais leve — recomendado no celular' },
  { id: 'fhd', hint: 'Padrão das redes (Reels, TikTok, Shorts)' },
  { id: '4k', hint: 'Máxima nitidez — exige aparelho forte' },
];

export default function ResolutionPill() {
  const { quality, fps, set } = useExportPref();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const off = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('pointerdown', off); window.addEventListener('keydown', k);
    return () => { window.removeEventListener('pointerdown', off); window.removeEventListener('keydown', k); };
  }, [open]);
  return (
    <div className="ep-respill-wrap" ref={ref}>
      <button type="button" className={`ep-respill${open ? ' on' : ''}`} onClick={() => setOpen((v) => !v)} aria-haspopup="dialog" aria-expanded={open} aria-label={`Resolução de exportação: ${RES_LABEL[quality]}, ${fps} fps`}>
        {RES_LABEL[quality]}<Icon name="expand" size={14} />
      </button>
      {open && (
        <div className="ep-respop" role="dialog" aria-label="Resolução de exportação">
          <div className="ep-respop-h">Resolução</div>
          {QS.map((q) => (
            <button key={q.id} type="button" className={`ep-respop-row${quality === q.id ? ' on' : ''}`} onClick={() => set({ quality: q.id })}>
              <b>{RES_LABEL[q.id]}</b><span>{q.hint}</span>{quality === q.id && <Icon name="check" size={18} />}
            </button>
          ))}
          <div className="ep-respop-h">Taxa de quadros</div>
          <div className="ep-respop-fps" role="radiogroup" aria-label="Quadros por segundo">
            {([24, 30, 60] as const).map((f) => (
              <button key={f} type="button" role="radio" aria-checked={fps === f} className={fps === f ? 'on' : ''} onClick={() => set({ fps: f })}>{f} fps</button>
            ))}
          </div>
          <p className="ep-respop-note">Vale como padrão ao tocar em Exportar.</p>
        </div>
      )}
    </div>
  );
}
