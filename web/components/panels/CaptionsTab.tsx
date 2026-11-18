'use client';
import { useEffect, useRef } from 'react';
import { emit } from '@/lib/events';
import { useEditor } from '@/lib/store';
import type { CaptionSegment, CaptionStyle } from '@/lib/types';
import { formatTime, uid } from '@/lib/util';
import { IconCaptions, IconPlus, IconSpark, IconTrash } from '@/components/shell/icons';
import { ColorField, CommitInput, EmptyHint, Section, Slider, TextField, Toggle } from './controls';
import { CAPTION_PRESETS, FONTS, TEXT_ANIMATIONS, parseTimeInput } from './presets';
import { textSampleStyle } from './TextTab';

function CaptionSample({ style }: { style: Partial<CaptionStyle> }) {
  const base = textSampleStyle({
    fontFamily: style.fontFamily ?? 'Poppins', fontSize: style.fontSize ?? 70, fontWeight: style.fontWeight ?? 800,
    color: style.color ?? '#fff', strokeColor: style.strokeColor, strokeWidth: style.strokeWidth, background: style.background,
    shadow: style.shadow, uppercase: style.uppercase, align: 'center',
  }, 0.17);
  const hl = style.highlightColor && style.highlightColor !== style.color ? style.highlightColor : undefined;
  const glow = style.preset === 'neon' ? { textShadow: `0 0 6px ${style.highlightColor}, 0 0 14px ${style.strokeColor}` } : {};
  return (
    <span style={{ ...base, ...glow }}>
      sua <span style={{ color: hl ?? base.color, background: style.preset === 'karaoke' ? 'transparent' : undefined }}>legenda</span>
    </span>
  );
}

const fmt = (v: number) => formatTime(v, { decimals: true });

export default function CaptionsTab() {
  const captions = useEditor((s) => s.project.captions);
  const dispatch = useEditor((s) => s.dispatch);
  const playhead = useEditor((s) => s.playhead);
  const setPlayhead = useEditor((s) => s.setPlayhead);
  const st = captions.style;
  const listRef = useRef<HTMLDivElement>(null);

  const setStyle = (patch: Partial<CaptionStyle>, history = true) => dispatch({ op: 'set_caption_style', style: patch }, { history });
  const upd = (id: string, patch: Partial<Omit<CaptionSegment, 'id'>>, history = true) => dispatch({ op: 'update_caption', segmentId: id, patch }, { history });
  const removeSeg = (id: string) => dispatch({ op: 'set_captions', segments: captions.segments.filter((s) => s.id !== id) });
  const addSeg = () => {
    const start = Math.round(playhead * 10) / 10;
    const seg: CaptionSegment = { id: uid('cap'), start, end: start + 2, text: 'Nova legenda' };
    dispatch({ op: 'set_captions', segments: [...captions.segments, seg] });
  };

  const activeId = captions.segments.find((s) => playhead >= s.start && playhead < s.end)?.id;
  useEffect(() => {
    if (!activeId || !listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(`[data-seg="${activeId}"]`);
    if (el && document.activeElement?.closest('[data-seg]') == null) el.scrollIntoView({ block: 'nearest' });
  }, [activeId]);

  return (
    <>
      <div className="ep-capbar">
        <Toggle label="Mostrar legendas" checked={captions.enabled} onChange={(v) => dispatch({ op: 'toggle_captions', enabled: v })} />
        <button type="button" className="ep-btn primary ep-wide" onClick={() => emit('ep:generate-captions', { language: captions.language })}>
          <IconSpark size={16} /> Gerar legendas com IA
        </button>
      </div>

      <Section title="Estilos">
        <div className="ep-capgrid">
          {CAPTION_PRESETS.map((p) => (
            <button key={p.id} type="button" className={`ep-cap${st.preset === p.id ? ' on' : ''}`} onClick={() => setStyle(p.style)} title={`Aplicar estilo ${p.label}`}>
              <span className="ep-cap-prev"><CaptionSample style={p.style} /></span>
              <span className="ep-cap-l">{p.label}</span>
            </button>
          ))}
        </div>
      </Section>

      <Section title="Ajustar estilo">
        <label className="ep-pfield">
          <span className="ep-label">Fonte</span>
          <select className="ep-select" value={st.fontFamily} onChange={(e) => setStyle({ fontFamily: e.target.value })}>
            {FONTS.map((f) => <option key={f.family} value={f.family}>{f.label}</option>)}
          </select>
        </label>
        <Slider label="Tamanho" value={st.fontSize} min={28} max={150} step={1} onChange={(v, h) => setStyle({ fontSize: v }, h)} format={(v) => `${v}px`} />
        <Slider label="Posição vertical" value={st.position.y} min={0.1} max={0.95} onChange={(v, h) => setStyle({ position: { ...st.position, y: v } }, h)} format={(v) => `${Math.round(v * 100)}%`} />
        <Slider label="Máx. palavras por vez" value={st.maxWords} min={1} max={10} step={1} onChange={(v, h) => setStyle({ maxWords: v }, h)} format={(v) => String(v)} />
        <ColorField label="Cor do texto" value={st.color} onChange={(v, h) => setStyle({ color: v }, h)} />
        <ColorField label="Destaque (palavra ativa)" value={st.highlightColor} onChange={(v, h) => setStyle({ highlightColor: v }, h)} />
        <ColorField label="Contorno" value={st.strokeColor} onChange={(v, h) => setStyle({ strokeColor: v }, h)} />
        <Slider label="Espessura do contorno" value={st.strokeWidth ?? 0} min={0} max={16} step={1} onChange={(v, h) => setStyle({ strokeWidth: v }, h)} format={(v) => `${v}px`} />
        <ColorField label="Caixa atrás" allowNone value={st.background} onChange={(v, h) => setStyle({ background: v }, h)} />
        <div className="ep-row2">
          <Toggle label="MAIÚSCULAS" checked={!!st.uppercase} onChange={(v) => setStyle({ uppercase: v })} />
          <Toggle label="Sombra" checked={!!st.shadow} onChange={(v) => setStyle({ shadow: v })} />
        </div>
        <span className="ep-label" style={{ display: 'block', margin: '10px 0 6px' }}>Animação</span>
        <div className="ep-chips">
          {TEXT_ANIMATIONS.map((a) => (
            <button key={a.id} type="button" className={`ep-chipbtn${st.animation === a.id ? ' on' : ''}`} onClick={() => setStyle({ animation: a.id })}>{a.label}</button>
          ))}
        </div>
      </Section>

      <Section
        title={`Segmentos (${captions.segments.length})`}
        right={<button type="button" className="ep-mini" onClick={addSeg}><IconPlus size={14} /> No playhead</button>}
      >
        {!captions.segments.length ? (
          <EmptyHint icon={<IconCaptions />} title="Sem legendas ainda" text="Clique em “Gerar legendas com IA” para transcrever a fala, ou adicione uma à mão." />
        ) : (
          <div className="ep-seglist" ref={listRef}>
            {captions.segments.map((s) => (
              <div key={s.id} data-seg={s.id} className={`ep-segrow${s.id === activeId ? ' on' : ''}`}>
                <div className="ep-segtimes">
                  <button type="button" className="ep-segjump" title="Ir para este trecho" onClick={() => setPlayhead(s.start)}>▶</button>
                  <CommitInput className="ep-input mono ep-tin" value={s.start} format={fmt} parse={parseTimeInput} onCommit={(v) => upd(s.id, { start: Math.min(v, s.end - 0.1) })} ariaLabel="Início" />
                  <span className="ep-segdash">→</span>
                  <CommitInput className="ep-input mono ep-tin" value={s.end} format={fmt} parse={parseTimeInput} onCommit={(v) => upd(s.id, { end: Math.max(v, s.start + 0.1) })} ariaLabel="Fim" />
                  <button type="button" className="ep-segdel" title="Remover legenda" onClick={() => removeSeg(s.id)}><IconTrash size={14} /></button>
                </div>
                <TextField value={s.text} onChange={(v, h) => upd(s.id, { text: v, words: undefined }, h)} />
              </div>
            ))}
          </div>
        )}
      </Section>
    </>
  );
}
