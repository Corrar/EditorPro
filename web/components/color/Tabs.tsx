'use client';
/* =====================================================================
   Abas Básico e HSL da página de Cor.
   ===================================================================== */
import { useState } from 'react';
import type { ColorGrade, HslAdjust, HslBand } from '@/lib/types';
import { DEFAULT_PIVOT, HSL_BANDS, HSL_CENTERS, HSL_LABELS, num } from '@/lib/color/grade';
import Icon from '@/components/ui/Icon';
import { ColorSlider, Pills, type Phase } from './controls';

type SetGrade = (fn: (g: ColorGrade) => ColorGrade, phase: Phase) => void;
type Scalar = 'exposure' | 'contrast' | 'pivot' | 'saturation' | 'vibrance' | 'temperature' | 'tint' | 'highlights' | 'shadows' | 'mix';

const hueCss = (h: number, s = 85, l = 55) => `hsl(${Math.round(h * 360)}, ${s}%, ${l}%)`;

export function BasicTab({ grade, set }: { grade: ColorGrade; set: SetGrade }) {
  const S = (k: Scalar, label: string, extra: Partial<Parameters<typeof ColorSlider>[0]> = {}) => {
    const def = k === 'pivot' ? DEFAULT_PIVOT : k === 'mix' ? 1 : 0;
    return (
      <ColorSlider
        key={k} label={label} value={num(grade[k], def)} def={def}
        onChange={(v, ph) => set((g) => ({ ...g, [k]: v }), ph)}
        {...extra}
      />
    );
  };
  const stops = (v: number) => (v >= 0 ? '+' : '') + (v * 2).toFixed(2);
  return (
    <div className="ec-basic">
      <section className="ec-group">
        <h4>Luz</h4>
        {S('exposure', 'Exposição', { format: (v) => `${stops(v)} EV`, track: 'linear-gradient(90deg,#1b1b1d,#f4f4f2)' })}
        {S('contrast', 'Contraste')}
        {S('pivot', 'Pivô do contraste', { min: 0.05, max: 0.95, format: (v) => v.toFixed(3) })}
        {S('highlights', 'Realces')}
        {S('shadows', 'Sombras')}
      </section>
      <section className="ec-group">
        <h4>Cor</h4>
        {S('temperature', 'Temperatura', { track: 'linear-gradient(90deg,#3d7bff,#d9d9d6 50%,#ff9a3d)' })}
        {S('tint', 'Tint (verde ↔ magenta)', { track: 'linear-gradient(90deg,#34c759,#d9d9d6 50%,#e04bd8)' })}
        {S('saturation', 'Saturação', { track: 'linear-gradient(90deg,#8a8a8a,#ff6a00 60%,#ff1f6b)' })}
        {S('vibrance', 'Vibrance')}
      </section>
      <section className="ec-group">
        <h4>Mistura</h4>
        {S('mix', 'Intensidade da correção', { min: 0, max: 1, format: (v) => `${Math.round(v * 100)}%` })}
      </section>
    </div>
  );
}

export function HslTab({ grade, set }: { grade: ColorGrade; set: SetGrade }) {
  const [band, setBand] = useState<HslBand>('orange');
  const i = HSL_BANDS.indexOf(band);
  const h = HSL_CENTERS[i];
  const a: HslAdjust = grade.hsl?.[band] ?? { hue: 0, sat: 0, lum: 0 };
  const isOn = (b: HslBand) => { const x = grade.hsl?.[b]; return !!x && (Math.abs(num(x.hue)) > 1e-4 || Math.abs(num(x.sat)) > 1e-4 || Math.abs(num(x.lum)) > 1e-4); };
  const write = (k: keyof HslAdjust, v: number, ph: Phase) =>
    set((g) => ({ ...g, hsl: { ...(g.hsl ?? {}), [band]: { ...(g.hsl?.[band] ?? { hue: 0, sat: 0, lum: 0 }), [k]: v } } }), ph);
  const anyOn = HSL_BANDS.some(isOn);
  return (
    <div className="ec-hsl">
      <div className="ec-row-between">
        <Pills<HslBand>
          label="Faixa de cor" value={band} onChange={setBand}
          options={HSL_BANDS.map((b, j) => ({ id: b, label: HSL_LABELS[b], dot: hueCss(HSL_CENTERS[j]), mark: isOn(b) }))}
        />
      </div>
      <div className="ec-hsl-card" style={{ ['--band' as string]: hueCss(h) }}>
        <div className="ec-row-between">
          <strong className="ec-hsl-name"><span className="ec-dot big" style={{ background: hueCss(h) }} />{HSL_LABELS[band]}</strong>
          <span className="ec-row-gap">
            <button type="button" className="ec-icon-btn" aria-label={`Restaurar ${HSL_LABELS[band]}`} title="Restaurar faixa" disabled={!isOn(band)}
              onClick={() => set((g) => { const n = { ...(g.hsl ?? {}) }; delete n[band]; return { ...g, hsl: n }; }, 'once')}>
              <Icon name="rotate" size={16} />
            </button>
          </span>
        </div>
        <ColorSlider label="Matiz" value={num(a.hue)} onChange={(v, ph) => write('hue', v, ph)}
          format={(v) => `${v >= 0 ? '+' : ''}${Math.round(v * 30)}°`}
          track={`linear-gradient(90deg, ${hueCss(h - 30 / 360)}, ${hueCss(h)} 50%, ${hueCss(h + 30 / 360)})`} />
        <ColorSlider label="Saturação" value={num(a.sat)} onChange={(v, ph) => write('sat', v, ph)}
          track={`linear-gradient(90deg, ${hueCss(h, 0, 55)}, ${hueCss(h, 45, 55)} 50%, ${hueCss(h, 100, 50)})`} />
        <ColorSlider label="Luminância" value={num(a.lum)} onChange={(v, ph) => write('lum', v, ph)}
          track={`linear-gradient(90deg, ${hueCss(h, 70, 12)}, ${hueCss(h, 75, 50)} 50%, ${hueCss(h, 80, 85)})`} />
      </div>
      {anyOn && (
        <button type="button" className="ec-text-btn" onClick={() => set((g) => ({ ...g, hsl: undefined }), 'once')}>Restaurar todas as faixas</button>
      )}
    </div>
  );
}
