'use client';
import { useEditor } from '@/lib/store';
import type { ImageClip, TransitionKind, VideoClip } from '@/lib/types';
import { IconTransitions } from '@/components/shell/icons';
import { EmptyHint, Section, Slider } from './controls';
import { secs, useClipPatch, useSelectedClip } from './hooks';
import { useCatalogs } from './catalog';

export default function TransitionsTab() {
  const transitions = useCatalogs((c) => c.transitions);
  const found = useSelectedClip();
  const dispatch = useEditor((s) => s.dispatch);
  const clip = found && (found.clip.type === 'video' || found.clip.type === 'image') ? (found.clip as VideoClip | ImageClip) : null;
  const patch = useClipPatch(clip?.id);

  if (!clip || !found) {
    return <EmptyHint icon={<IconTransitions />} title="Selecione um clipe" text="A transição é aplicada na entrada do clipe selecionado (vinda do clipe anterior)." />;
  }

  const current: TransitionKind = clip.transitionIn?.kind ?? 'cut';
  const duration = clip.transitionIn?.duration ?? 0.4;
  const isFirst = found.track.clips[0]?.id === clip.id;
  const maxDur = Math.max(0.1, Math.min(1.5, clip.duration / 2));

  const apply = (kind: TransitionKind) => patch({ transitionIn: kind === 'cut' ? undefined : { kind, duration: Math.min(duration, maxDur) } });

  const applyAll = () => {
    const ops = found.track.clips.slice(1).map((c) => ({
      op: 'update_clip' as const, clipId: c.id,
      patch: { transitionIn: current === 'cut' ? undefined : { kind: current, duration: Math.min(duration, c.duration / 2) } },
    }));
    if (ops.length) dispatch(ops);
  };

  return (
    <>
      <Section title="Transição de entrada">
        {isFirst && <p className="ep-pnote">Este é o primeiro clipe da trilha: a transição entra a partir do fundo.</p>}
        <div className="ep-trgrid">
          {transitions.map((t) => (
            <button key={t.kind} type="button" className={`ep-tr${current === t.kind ? ' on' : ''}`} onClick={() => apply(t.kind)} title={t.label}>
              <span className={`ep-tr-prev k-${t.kind}`}><i className="a" /><i className="b" /></span>
              <span className="ep-tr-l">{t.label}</span>
            </button>
          ))}
        </div>
      </Section>
      {current !== 'cut' && (
        <Section title="Duração">
          <Slider label="Duração da transição" value={Math.min(duration, maxDur)} min={0.1} max={maxDur} step={0.05} onChange={(v, h) => patch({ transitionIn: { kind: current, duration: v } }, h)} format={secs} />
        </Section>
      )}
      {found.track.clips.length > 2 && (
        <button type="button" className="ep-btn sec ep-wide" onClick={applyAll}>
          Aplicar “{transitions.find((t) => t.kind === current)?.label}” em todos os cortes da trilha
        </button>
      )}
    </>
  );
}
