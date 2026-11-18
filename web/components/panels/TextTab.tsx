'use client';
import { useEditor } from '@/lib/store';
import type { TextClip, TextStyle } from '@/lib/types';
import { formatTime } from '@/lib/util';
import { targetTrackId } from '@/lib/media/place';
import { IconText, IconTrash } from '@/components/shell/icons';
import { ColorField, CommitInput, EmptyHint, Section, Seg, Slider, TextField, Toggle } from './controls';
import { useClipPatch, useSelectedClip } from './hooks';
import { FONTS, TEXT_ANIMATIONS, TEXT_TEMPLATES, WEIGHTS, parseTimeInput } from './presets';

const POSITIONS: { label: string; x: number; y: number }[] = [
  { label: '↖', x: 0.25, y: 0.15 }, { label: '↑', x: 0.5, y: 0.15 }, { label: '↗', x: 0.75, y: 0.15 },
  { label: '←', x: 0.25, y: 0.5 }, { label: '•', x: 0.5, y: 0.5 }, { label: '→', x: 0.75, y: 0.5 },
  { label: '↙', x: 0.25, y: 0.85 }, { label: '↓', x: 0.5, y: 0.85 }, { label: '↘', x: 0.75, y: 0.85 },
];

export function textSampleStyle(s: TextStyle, scale = 0.22): React.CSSProperties {
  return {
    fontFamily: `'${s.fontFamily}', var(--font-ui)`,
    fontWeight: s.fontWeight,
    fontSize: Math.max(10, Math.min(26, s.fontSize * scale)),
    color: s.color,
    textTransform: s.uppercase ? 'uppercase' : 'none',
    background: s.background || 'transparent',
    padding: s.background ? '2px 8px' : 0,
    borderRadius: s.background ? 6 : 0,
    WebkitTextStroke: s.strokeWidth ? `${Math.min(2, s.strokeWidth * 0.25)}px ${s.strokeColor ?? '#000'}` : undefined,
    textShadow: s.shadow ? '0 2px 6px rgba(0,0,0,.55)' : 'none',
    textAlign: s.align,
  };
}

export default function TextTab() {
  const dispatch = useEditor((s) => s.dispatch);
  const select = useEditor((s) => s.select);
  const found = useSelectedClip();
  const clip = found?.clip.type === 'text' ? (found.clip as TextClip) : null;
  const patch = useClipPatch(clip?.id);

  const addTemplate = (id: string) => {
    const tpl = TEXT_TEMPLATES.find((t) => t.id === id)!;
    const st = useEditor.getState();
    const c = tpl.make(Math.round(st.playhead * 100) / 100);
    dispatch({ op: 'add_clip', trackId: targetTrackId(st.project, 'text'), clip: c, explain: `Adicionando ${tpl.label.toLowerCase()}` });
    select([c.id]);
  };

  const setStyle = (k: keyof TextStyle, v: unknown, history: boolean) => {
    if (!clip) return;
    patch({ style: { ...clip.style, [k]: v } }, history);
  };

  return (
    <>
      <Section title="Modelos prontos">
        <div className="ep-tpl-grid">
          {TEXT_TEMPLATES.map((t) => {
            const sample = t.make(0);
            return (
              <button key={t.id} type="button" className="ep-tpl" onClick={() => addTemplate(t.id)} title={`Adicionar ${t.label} no playhead`}>
                <span className="ep-tpl-prev"><span style={textSampleStyle(sample.style)}>{t.label}</span></span>
                <span className="ep-tpl-l">{t.label}</span>
                <span className="ep-tpl-d">{t.desc}</span>
              </button>
            );
          })}
        </div>
      </Section>

      {!clip ? (
        <EmptyHint icon={<IconText />} title="Nenhum texto selecionado" text="Escolha um modelo acima ou clique em um texto na timeline para editar." />
      ) : (
        <>
          <Section
            title="Texto"
            right={
              <button type="button" className="ep-mini danger" onClick={() => { dispatch({ op: 'remove_clip', clipId: clip.id }); select([]); }}>
                <IconTrash size={14} /> Remover
              </button>
            }
          >
            <TextField multiline value={clip.text} onChange={(v, h) => patch({ text: v }, h)} placeholder="Digite o texto" />
          </Section>

          <Section title="Fonte">
            <div className="ep-row2">
              <label className="ep-pfield">
                <span className="ep-label">Família</span>
                <select className="ep-select" value={clip.style.fontFamily} onChange={(e) => setStyle('fontFamily', e.target.value, true)}>
                  {FONTS.map((f) => <option key={f.family} value={f.family}>{f.label}</option>)}
                </select>
              </label>
              <label className="ep-pfield">
                <span className="ep-label">Peso</span>
                <select className="ep-select" value={clip.style.fontWeight} onChange={(e) => setStyle('fontWeight', Number(e.target.value), true)}>
                  {WEIGHTS.map((w) => <option key={w} value={w}>{w}</option>)}
                </select>
              </label>
            </div>
            <Slider label="Tamanho" value={clip.style.fontSize} min={24} max={220} step={1} onChange={(v, h) => setStyle('fontSize', v, h)} format={(v) => `${v}px`} />
            <div className="ep-row2 center">
              <Seg small value={clip.style.align} onChange={(v) => setStyle('align', v, true)} options={[{ id: 'left', label: 'Esq.' }, { id: 'center', label: 'Centro' }, { id: 'right', label: 'Dir.' }]} />
              <Toggle label="MAIÚSCULAS" checked={!!clip.style.uppercase} onChange={(v) => setStyle('uppercase', v, true)} />
            </div>
          </Section>

          <Section title="Cores e estilo">
            <ColorField label="Cor do texto" value={clip.style.color} onChange={(v, h) => setStyle('color', v, h)} />
            <ColorField label="Destaque" value={clip.style.highlightColor} onChange={(v, h) => setStyle('highlightColor', v, h)} />
            <ColorField label="Contorno" value={clip.style.strokeColor} onChange={(v, h) => setStyle('strokeColor', v, h)} />
            <Slider label="Espessura do contorno" value={clip.style.strokeWidth ?? 0} min={0} max={20} step={1} onChange={(v, h) => setStyle('strokeWidth', v, h)} format={(v) => `${v}px`} reset={0} />
            <ColorField label="Caixa atrás" allowNone value={clip.style.background} onChange={(v, h) => setStyle('background', v, h)} />
            <Toggle label="Sombra" checked={!!clip.style.shadow} onChange={(v) => setStyle('shadow', v, true)} />
          </Section>

          <Section title="Posição">
            <div className="ep-posgrid">
              {POSITIONS.map((p) => {
                const on = Math.abs(clip.position.x - p.x) < 0.02 && Math.abs(clip.position.y - p.y) < 0.02;
                return <button key={p.label} type="button" className={on ? 'on' : ''} onClick={() => patch({ position: { x: p.x, y: p.y } })}>{p.label}</button>;
              })}
            </div>
            <Slider label="Horizontal" value={clip.position.x} min={0} max={1} onChange={(v, h) => patch({ position: { ...clip.position, x: v } }, h)} format={(v) => `${Math.round(v * 100)}%`} reset={0.5} />
            <Slider label="Vertical" value={clip.position.y} min={0} max={1} onChange={(v, h) => patch({ position: { ...clip.position, y: v } }, h)} format={(v) => `${Math.round(v * 100)}%`} />
          </Section>

          <Section title="Animação">
            <div className="ep-chips">
              {TEXT_ANIMATIONS.map((a) => (
                <button key={a.id} type="button" className={`ep-chipbtn${clip.animation === a.id ? ' on' : ''}`} onClick={() => patch({ animation: a.id })}>{a.label}</button>
              ))}
            </div>
          </Section>

          <Section title="Tempo">
            <div className="ep-row2">
              <label className="ep-pfield">
                <span className="ep-label">Início</span>
                <CommitInput value={clip.start} format={(v) => formatTime(v, { decimals: true })} parse={parseTimeInput} onCommit={(v) => dispatch({ op: 'move_clip', clipId: clip.id, start: v })} ariaLabel="Início do texto" />
              </label>
              <label className="ep-pfield">
                <span className="ep-label">Duração (s)</span>
                <CommitInput value={clip.duration} format={(v) => v.toFixed(1)} parse={(s) => { const v = parseTimeInput(s); return v && v > 0.1 ? v : null; }} onCommit={(v) => patch({ duration: v })} ariaLabel="Duração do texto" />
              </label>
            </div>
          </Section>
        </>
      )}
    </>
  );
}
