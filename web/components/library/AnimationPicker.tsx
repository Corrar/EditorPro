'use client';
/* =====================================================================
   AnimationPicker — entrada / saída / loop, com prévia em loop desenhada
   pelo engine. Modo "texto" (TextAnimation) ou "clipe" (ClipAnimation).
   Sem onSelect: aplica nos clipes selecionados (tipo detectado sozinho).
   ===================================================================== */
import { useMemo, useState } from 'react';
import Icon from '@/components/ui/Icon';
import { useEditor } from '@/lib/store';
import { findClip, type EditOp } from '@/lib/ops';
import { DEFAULT_TEXT_STYLE } from '@/lib/defaults';
import { DEFAULT_TRANSFORM, type Clip, type ClipAnimation, type Project, type ShapeClip, type TextAnimation, type TextClip } from '@/lib/types';
import {
  ANIM_SLOT_LABELS, CLIP_ANIM_GROUP_LABELS, TEXT_ANIM_GROUP_LABELS, clipAnimationOp, clipAnimationsFor, textAnimationOp, textAnimationsFor,
  type AnimSlot,
} from '@/lib/library/animations';
import { MiniCanvas, drawMini, miniProject } from './mini';
import { PillRow, Empty } from './shared';

type Mode = 'text' | 'clip';
const SLOTS: { id: AnimSlot; label: string }[] = (['in', 'out', 'loop'] as AnimSlot[]).map((id) => ({ id, label: ANIM_SLOT_LABELS[id] }));

/** janela da prévia por slot: [duração do clipe, período do loop] */
const WINDOW: Record<AnimSlot, [number, number]> = { in: [1.5, 2.1], out: [1.3, 1.9], loop: [2.4, 2.4] };

function textPreview(slot: AnimSlot, id: TextAnimation): Project {
  const [dur] = WINDOW[slot];
  const clip: TextClip = {
    id: 'pv', type: 'text', text: 'Texto aqui', start: slot === 'out' ? -0.3 : 0.15, duration: dur + (slot === 'out' ? 0.3 : 0),
    style: { ...DEFAULT_TEXT_STYLE, fontFamily: 'Poppins', fontSize: 380, fontWeight: 800, strokeWidth: 0, shadow: true, highlightColor: '#FFD23F' },
    position: { x: 0.5, y: 0.5 },
    animation: slot === 'in' ? id : 'none',
    ...(slot === 'out' ? { animationOut: id } : {}),
    ...(slot === 'loop' ? { animationLoop: id } : {}),
  };
  return miniProject('1:1', [{ kind: 'text', clips: [clip] }], { sceneAsset: null, background: '#232428' });
}

function clipPreview(slot: AnimSlot, id: ClipAnimation): Project {
  const [dur] = WINDOW[slot];
  const anim = { kind: id, duration: slot === 'loop' ? 1.2 : 0.5 };
  const clip: ShapeClip = {
    id: 'pv', type: 'shape', shape: 'rounded-rect', fill: '#F2681F', cornerRadius: 40, start: slot === 'out' ? -0.3 : 0.15, duration: dur + (slot === 'out' ? 0.3 : 0),
    transform: { ...DEFAULT_TRANSFORM, scale: 0.55 },
    ...(slot === 'in' ? { animationIn: anim } : slot === 'out' ? { animationOut: anim } : { animationLoop: anim }),
  };
  return miniProject('1:1', [{ kind: 'overlay', clips: [clip] }], { sceneAsset: null, background: '#232428' });
}

function AnimTile({ name, selected, project, slot, onPick, none }: { name: string; selected: boolean; project: Project | null; slot: AnimSlot; onPick: () => void; none?: boolean }) {
  const [, period] = WINDOW[slot];
  return (
    <button type="button" className={`ep-lib-card sm${selected ? ' on' : ''}`} onClick={onPick} aria-pressed={selected}>
      <span className="ep-lib-thumb square">
        {none || !project ? <span className="ep-lib-none"><Icon name="close" size={22} /></span>
          : <MiniCanvas label={`Prévia: ${name}`} deps={[project]} draw={(ctx, clock) => drawMini(ctx, project, clock % period)} />}
        {selected && <span className="ep-lib-badge"><Icon name="check" size={14} /></span>}
      </span>
      <span className="ep-lib-cardlb">{name}</span>
    </button>
  );
}

export default function AnimationPicker({ mode: modeProp, value, onSelect }: {
  mode?: Mode; value?: Partial<Record<AnimSlot, string>>; onSelect?: (slot: AnimSlot, id: string | null) => void;
}) {
  const [slot, setSlot] = useState<AnimSlot>('in');
  const selection = useEditor((s) => s.selection);
  const project = useEditor((s) => s.project);
  const dispatch = useEditor((s) => s.dispatch);
  const clips = useMemo(() => selection.map((id) => findClip(project, id)?.clip).filter((c): c is Clip => !!c && c.type !== 'audio' && c.type !== 'adjustment'), [selection, project]);
  const [manualMode, setManualMode] = useState<Mode>('text');
  const mode: Mode = modeProp ?? (clips[0] ? (clips[0].type === 'text' ? 'text' : 'clip') : manualMode);
  const targets = clips.filter((c) => (mode === 'text' ? c.type === 'text' : c.type !== 'text'));

  const first = targets[0];
  const current = value?.[slot] ?? (() => {
    if (!first) return undefined;
    if (first.type === 'text') return slot === 'in' ? first.animation : slot === 'out' ? first.animationOut ?? 'none' : first.animationLoop ?? 'none';
    const v = first as Extract<Clip, { animationIn?: unknown }>;
    const a = slot === 'in' ? v.animationIn : slot === 'out' ? v.animationOut : v.animationLoop;
    return a?.kind ?? null;
  })();

  const pickText = (id: TextAnimation) => {
    if (onSelect) return onSelect(slot, id);
    dispatch(targets.map((c) => textAnimationOp(c.id, slot, id)));
  };
  const pickClip = (id: ClipAnimation | null) => {
    if (onSelect) return onSelect(slot, id);
    dispatch(targets.map((c): EditOp => clipAnimationOp(c.id, slot, id)));
  };

  const textList = useMemo(() => textAnimationsFor(slot), [slot]);
  const clipList = useMemo(() => clipAnimationsFor(slot), [slot]);
  const previews = useMemo(() => new Map<string, Project>(
    mode === 'text' ? textList.filter((a) => a.id !== 'none').map((a) => [a.id, textPreview(slot, a.id)]) : clipList.map((a) => [a.id, clipPreview(slot, a.id)]),
  ), [mode, slot, textList, clipList]);

  const groups = mode === 'text'
    ? (Object.keys(TEXT_ANIM_GROUP_LABELS) as (keyof typeof TEXT_ANIM_GROUP_LABELS)[]).map((g) => ({ g, label: TEXT_ANIM_GROUP_LABELS[g], items: textList.filter((a) => a.group === g && a.id !== 'none') }))
    : (Object.keys(CLIP_ANIM_GROUP_LABELS) as (keyof typeof CLIP_ANIM_GROUP_LABELS)[]).map((g) => ({ g, label: CLIP_ANIM_GROUP_LABELS[g], items: clipList.filter((a) => a.group === g) }));

  const disabled = !onSelect && !targets.length;

  return (
    <div className="ep-lib ep-lib-anims">
      {!modeProp && !clips.length && (
        <div className="ep-lib-seg" role="radiogroup" aria-label="Animar">
          <button type="button" role="radio" aria-checked={mode === 'text'} className={mode === 'text' ? 'on' : ''} onClick={() => setManualMode('text')}>Texto</button>
          <button type="button" role="radio" aria-checked={mode === 'clip'} className={mode === 'clip' ? 'on' : ''} onClick={() => setManualMode('clip')}>Clipe / sticker</button>
        </div>
      )}
      <PillRow value={slot} options={SLOTS} onChange={setSlot} label="Tipo de animação" />
      {disabled && <Empty>Selecione um {mode === 'text' ? 'texto' : 'clipe, sticker ou forma'} na timeline para aplicar. Toque nas prévias para ver como fica.</Empty>}
      <div className="ep-lib-grid sm">
        <AnimTile name="Nenhuma" none selected={current === 'none' || current === null} project={null} slot={slot}
          onPick={() => (mode === 'text' ? pickText('none') : pickClip(null))} />
      </div>
      {groups.filter((x) => x.items.length).map((x) => (
        <section key={x.g} className="ep-lib-sect">
          <div className="ep-lib-secttl">{x.label}</div>
          <div className="ep-lib-grid sm">
            {x.items.map((a) => (
              <AnimTile key={a.id} name={a.name} slot={slot} selected={current === a.id} project={previews.get(a.id) ?? null}
                onPick={() => (mode === 'text' ? pickText(a.id as TextAnimation) : pickClip(a.id as ClipAnimation))} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
