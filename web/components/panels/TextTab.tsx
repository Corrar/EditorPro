'use client';
import { useEditor } from '@/lib/store';
import Icon from '@/components/ui/Icon';
import { AnimationPicker, FontPicker, TextTemplateGallery } from '@/components/library';
import type { TextAnimation, TextClip, TextStyle } from '@/lib/types';
import { formatTime } from '@/lib/util';
import { targetTrackId } from '@/lib/media/place';
import { IconText, IconTrash } from '@/components/shell/icons';
import { ColorField, CommitInput, EmptyHint, Section, Seg, Slider, TextField, Toggle } from './controls';
import { pct, useClipPatch, useSelectedClip } from './hooks';
import { FONTS, TEXT_ANIMATIONS_ALL, TEXT_TEMPLATES, WEIGHTS, parseTimeInput } from './presets';

const POSITIONS: { label: string; x: number; y: number }[] = [
  { label: '↖', x: 0.25, y: 0.15 }, { label: '↑', x: 0.5, y: 0.15 }, { label: '↗', x: 0.75, y: 0.15 },
  { label: '←', x: 0.25, y: 0.5 }, { label: '•', x: 0.5, y: 0.5 }, { label: '→', x: 0.75, y: 0.5 },
  { label: '↙', x: 0.25, y: 0.85 }, { label: '↓', x: 0.5, y: 0.85 }, { label: '↘', x: 0.75, y: 0.85 },
];

export function textSampleStyle(s: TextStyle, scale = 0.22): React.CSSProperties {
  const grad = s.gradient ? { backgroundImage: `linear-gradient(${s.gradient.angle}deg, ${s.gradient.from}, ${s.gradient.to})`, WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' } : {};
  return {
    fontFamily: `'${s.fontFamily}', var(--font-ui)`,
    fontWeight: s.fontWeight,
    fontStyle: s.italic ? 'italic' : 'normal',
    textDecoration: s.underline ? 'underline' : 'none',
    fontSize: Math.max(10, Math.min(26, s.fontSize * scale)),
    letterSpacing: s.letterSpacing ? s.letterSpacing * scale : undefined,
    color: s.color,
    textTransform: s.uppercase ? 'uppercase' : 'none',
    background: s.background || 'transparent',
    padding: s.background ? '2px 8px' : 0,
    borderRadius: s.background ? Math.max(4, (s.backgroundRadius ?? 6) * scale) : 0,
    WebkitTextStroke: s.strokeWidth ? `${Math.min(3, s.strokeWidth * 0.4)}px ${s.strokeColor ?? '#000'}` : undefined,
    textShadow: s.shadow ? '0 2px 6px rgba(0,0,0,.55)' : 'none',
    textAlign: s.align,
    opacity: s.opacity ?? 1,
    ...(s.background ? {} : grad),
  };
}

function AnimRow({ label, value, onChange, allowNone }: { label: string; value: TextAnimation | undefined; onChange: (v: TextAnimation | undefined) => void; allowNone?: boolean }) {
  return (
    <div className="ep-animrow">
      <span className="ep-label">{label}</span>
      <div className="ep-chips scroll">
        {allowNone && <button type="button" className={`ep-chipbtn${!value || value === 'none' ? ' on' : ''}`} onClick={() => onChange(undefined)}>Nenhuma</button>}
        {TEXT_ANIMATIONS_ALL.filter((a) => !allowNone || a.id !== 'none').map((a) => (
          <button key={a.id} type="button" className={`ep-chipbtn${value === a.id ? ' on' : ''}`} onClick={() => onChange(a.id)}>{a.label}</button>
        ))}
      </div>
    </div>
  );
}

/** editor completo do texto selecionado (também usado pela aba Editar) */
export function TextEditor({ clip }: { clip: TextClip }) {
  const dispatch = useEditor((s) => s.dispatch);
  const select = useEditor((s) => s.select);
  const patch = useClipPatch(clip.id);
  const setStyle = (k: keyof TextStyle, v: unknown, history: boolean) => patch({ style: { ...clip.style, [k]: v } }, history);
  const g = clip.style.gradient;

  return (
    <>
      <Section title="Texto" right={<button type="button" className="ep-mini danger" onClick={() => { dispatch({ op: 'remove_clip', clipId: clip.id }); select([]); }}><IconTrash size={14} /> Remover</button>}>
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
        <Slider label="Tamanho" value={clip.style.fontSize} min={24} max={240} step={1} onChange={(v, h) => setStyle('fontSize', v, h)} format={(v) => `${v}px`} />
        <Slider label="Espaçamento entre letras" value={clip.style.letterSpacing ?? 0} min={-10} max={40} step={1} onChange={(v, h) => setStyle('letterSpacing', v, h)} format={(v) => `${v}px`} reset={0} />
        <Slider label="Entrelinha" value={clip.style.lineHeight ?? 1.2} min={0.8} max={2.2} step={0.05} onChange={(v, h) => setStyle('lineHeight', v, h)} format={(v) => v.toFixed(2)} reset={1.2} />
        <div className="ep-stylebtns">
          <button type="button" className={clip.style.fontWeight >= 700 ? 'on' : ''} onClick={() => setStyle('fontWeight', clip.style.fontWeight >= 700 ? 400 : 800, true)} title="Negrito"><b>B</b></button>
          <button type="button" className={clip.style.italic ? 'on' : ''} onClick={() => setStyle('italic', !clip.style.italic, true)} title="Itálico"><i>I</i></button>
          <button type="button" className={clip.style.underline ? 'on' : ''} onClick={() => setStyle('underline', !clip.style.underline, true)} title="Sublinhado"><u>U</u></button>
          <button type="button" className={clip.style.uppercase ? 'on' : ''} onClick={() => setStyle('uppercase', !clip.style.uppercase, true)} title="Maiúsculas">Aa</button>
          <Seg small value={clip.style.align} onChange={(v) => setStyle('align', v, true)} options={[{ id: 'left', label: '⇤', title: 'Esquerda' }, { id: 'center', label: '≡', title: 'Centro' }, { id: 'right', label: '⇥', title: 'Direita' }]} />
        </div>
      </Section>

      <Section title="Cores e estilo">
        <Toggle label="Gradiente no texto" checked={!!g} onChange={(v) => setStyle('gradient', v ? { from: '#FFD23F', to: '#D9641E', angle: 90 } : undefined, true)} />
        {g ? (
          <>
            <ColorField label="Gradiente — início" value={g.from} onChange={(v, h) => setStyle('gradient', { ...g, from: v }, h)} />
            <ColorField label="Gradiente — fim" value={g.to} onChange={(v, h) => setStyle('gradient', { ...g, to: v }, h)} />
            <Slider label="Ângulo" value={g.angle} min={0} max={360} step={5} onChange={(v, h) => setStyle('gradient', { ...g, angle: v }, h)} format={(v) => `${v}°`} />
          </>
        ) : <ColorField label="Cor do texto" value={clip.style.color} onChange={(v, h) => setStyle('color', v, h)} />}
        <ColorField label="Destaque" value={clip.style.highlightColor} onChange={(v, h) => setStyle('highlightColor', v, h)} />
        <ColorField label="Contorno" value={clip.style.strokeColor} onChange={(v, h) => setStyle('strokeColor', v, h)} />
        <Slider label="Espessura do contorno" value={clip.style.strokeWidth ?? 0} min={0} max={20} step={1} onChange={(v, h) => setStyle('strokeWidth', v, h)} format={(v) => `${v}px`} reset={0} />
        <ColorField label="Caixa atrás" allowNone value={clip.style.background} onChange={(v, h) => setStyle('background', v, h)} />
        {clip.style.background && <Slider label="Raio da caixa" value={clip.style.backgroundRadius ?? 8} min={0} max={80} step={1} onChange={(v, h) => setStyle('backgroundRadius', v, h)} format={(v) => `${v}px`} />}
        <Slider label="Opacidade" value={clip.style.opacity ?? 1} min={0} max={1} onChange={(v, h) => setStyle('opacity', v, h)} format={pct} reset={1} />
        <Toggle label="Sombra" checked={!!clip.style.shadow} onChange={(v) => setStyle('shadow', v, true)} />
      </Section>

      <Section title="Posição">
        <div className="ep-posgrid">
          {POSITIONS.map((p) => {
            const on = Math.abs(clip.position.x - p.x) < 0.02 && Math.abs(clip.position.y - p.y) < 0.02;
            return <button key={p.label} type="button" className={on ? 'on' : ''} onClick={() => patch({ position: { x: p.x, y: p.y } })}>{p.label}</button>;
          })}
        </div>
        <Slider label="Horizontal" value={clip.position.x} min={0} max={1} onChange={(v, h) => patch({ position: { ...clip.position, x: v } }, h)} format={pct} reset={0.5} />
        <Slider label="Vertical" value={clip.position.y} min={0} max={1} onChange={(v, h) => patch({ position: { ...clip.position, y: v } }, h)} format={pct} />
        <Slider label="Rotação" value={clip.rotation ?? 0} min={-180} max={180} step={1} onChange={(v, h) => patch({ rotation: v }, h)} format={(v) => `${v}°`} reset={0} />
        <Slider label="Escala" value={clip.scale ?? 1} min={0.2} max={3} onChange={(v, h) => patch({ scale: v }, h)} format={pct} reset={1} />
      </Section>

      <Section title="Animação">
        <AnimRow label="Entrada" value={clip.animation} onChange={(v) => patch({ animation: v ?? 'none' })} allowNone />
        <AnimRow label="Saída" value={clip.animationOut} onChange={(v) => patch({ animationOut: v })} allowNone />
        <AnimRow label="Loop" value={clip.animationLoop} onChange={(v) => patch({ animationLoop: v })} allowNone />
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
  );
}

export default function TextTab() {
  const dispatch = useEditor((s) => s.dispatch);
  const select = useEditor((s) => s.select);
  const found = useSelectedClip();
  const clip = found?.clip.type === 'text' ? (found.clip as TextClip) : null;

  const addTemplate = (id: string) => {
    const tpl = TEXT_TEMPLATES.find((t) => t.id === id)!;
    const st = useEditor.getState();
    const c = tpl.make(Math.round(st.playhead * 100) / 100);
    dispatch({ op: 'add_clip', trackId: targetTrackId(st.project, 'text'), clip: c, explain: `Adicionando ${tpl.label.toLowerCase()}` });
    select([c.id]);
    // avança o playhead para depois da animação de entrada: o texto aparece já no preview
    st.setPlayhead(c.start + Math.min(0.6, c.duration / 2));
  };
  // modelos da biblioteca: seleciona e avança o playhead para o texto aparecer já animado
  const afterInsert = (ids: string[]) => {
    const st = useEditor.getState();
    const c = ids.map((id) => st.project.tracks.flatMap((t) => t.clips).find((x) => x.id === id)).find(Boolean);
    if (!c) return;
    select(ids);
    st.setPlayhead(c.start + Math.min(0.6, c.duration / 2));
  };

  return (
    <>
      <div className="ep-textadd">
        <button type="button" className="ep-btn primary ep-wide" onClick={() => addTemplate('plain')}><Icon name="add" size={16} /> Adicionar texto</button>
      </div>
      <Section title="Modelos de texto"><TextTemplateGallery onInserted={afterInsert} /></Section>
      {clip ? (
        <>
          <TextEditor key={clip.id} clip={clip} />
          <Section title="Fontes"><FontPicker /></Section>
          <Section title="Animações"><AnimationPicker mode="text" /></Section>
        </>
      ) : <EmptyHint icon={<IconText />} title="Nenhum texto selecionado" text="Escolha um modelo acima ou toque em um texto na timeline para editar." />}
    </>
  );
}
