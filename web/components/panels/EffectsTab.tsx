'use client';
import { useEditor } from '@/lib/store';
import type { ImageClip, Transform, VideoClip } from '@/lib/types';
import { DEFAULT_TRANSFORM } from '@/lib/types';
import { IconEffects, IconZoom } from '@/components/shell/icons';
import { EmptyHint, Section, Slider } from './controls';
import { pct, secs, signed, useClipPatch, useSelectedClip } from './hooks';
import { COLOR_PRESETS, FILTER_DEFS, filterValue, filtersToCss, punchInKeyframes, retimeForSpeed, setFilter } from './presets';

const SPEEDS = [0.5, 1, 1.5, 2, 3];

export default function EffectsTab() {
  const found = useSelectedClip();
  const clip = found && (found.clip.type === 'video' || found.clip.type === 'image') ? (found.clip as VideoClip | ImageClip) : null;
  const patch = useClipPatch(clip?.id);
  const asset = useEditor((s) => (clip ? s.assets[clip.assetId] : undefined));
  const playhead = useEditor((s) => s.playhead);

  if (!clip) {
    return <EmptyHint icon={<IconEffects />} title="Selecione um clipe" text="Clique em um vídeo ou imagem na timeline para aplicar cor, filtros, zoom e velocidade." />;
  }

  const thumb = asset?.thumbnails?.[Math.floor((asset.thumbnails.length - 1) / 2)];
  const tf: Transform = { ...DEFAULT_TRANSFORM, ...clip.transform };
  const setTf = (k: keyof Transform, v: number, h: boolean) => patch({ transform: { ...tf, [k]: v } }, h);
  const inside = playhead >= clip.start && playhead < clip.start + clip.duration;
  const video = clip.type === 'video' ? clip : null;
  const hasAdj = clip.filters?.length > 0;

  return (
    <>
      <Section title="Cor">
        <div className="ep-lutgrid">
          {COLOR_PRESETS.map((p) => {
            const on = (clip.colorPreset ?? 'none') === p.id;
            return (
              <button key={p.id} type="button" className={`ep-lut${on ? ' on' : ''}`} onClick={() => patch({ colorPreset: p.id })} title={p.label}>
                <span className="ep-lut-img" style={{ backgroundImage: thumb ? `url(${thumb})` : undefined, filter: p.css }} />
                <span className="ep-lut-l">{p.label}</span>
              </button>
            );
          })}
        </div>
        {thumb && (
          <div className="ep-lut-preview" title="Prévia aproximada">
            <span style={{ backgroundImage: `url(${thumb})`, filter: filtersToCss(clip.filters, clip.colorPreset) }} />
          </div>
        )}
      </Section>

      <Section
        title="Ajustes"
        right={hasAdj ? <button type="button" className="ep-mini" onClick={() => patch({ filters: [] })}>Zerar</button> : undefined}
      >
        {FILTER_DEFS.map((d) => (
          <Slider
            key={d.kind} label={d.label} min={d.min} max={d.max}
            value={filterValue(clip.filters, d.kind)}
            onChange={(v, h) => patch({ filters: setFilter(clip.filters, d.kind, v) }, h)}
            format={d.min < 0 ? signed : pct} reset={0}
          />
        ))}
      </Section>

      <Section title="Movimento">
        <button
          type="button" className="ep-btn primary ep-wide"
          onClick={() => patch({ keyframes: punchInKeyframes(clip, inside ? playhead : clip.start) })}
          title={inside ? 'Zoom rápido a partir do playhead' : 'O playhead está fora do clipe: o zoom entra no começo dele'}
        >
          <IconZoom size={16} /> Zoom punch-in aqui
        </button>
        {!!clip.keyframes?.length && (
          <div className="ep-kfinfo">
            <span>{clip.keyframes.length} keyframes neste clipe</span>
            <button type="button" className="ep-mini" onClick={() => patch({ keyframes: [] })}>Limpar</button>
          </div>
        )}
        <Slider label="Escala" value={tf.scale} min={0.3} max={3} onChange={(v, h) => setTf('scale', v, h)} format={pct} reset={1} />
        <Slider label="Posição X" value={tf.x} min={-1} max={1} onChange={(v, h) => setTf('x', v, h)} format={signed} reset={0} />
        <Slider label="Posição Y" value={tf.y} min={-1} max={1} onChange={(v, h) => setTf('y', v, h)} format={signed} reset={0} />
        <Slider label="Rotação" value={tf.rotation} min={-180} max={180} step={1} onChange={(v, h) => setTf('rotation', v, h)} format={(v) => `${v}°`} reset={0} />
        <Slider label="Opacidade" value={tf.opacity} min={0} max={1} onChange={(v, h) => setTf('opacity', v, h)} format={pct} reset={1} />
      </Section>

      {video && (
        <Section title="Velocidade e som">
          <div className="ep-chips">
            {SPEEDS.map((s) => (
              <button key={s} type="button" className={`ep-chipbtn${Math.abs(video.speed - s) < 1e-3 ? ' on' : ''}`} onClick={() => patch(retimeForSpeed(video, s))}>{s}×</button>
            ))}
          </div>
          <Slider label="Velocidade" value={video.speed} min={0.25} max={4} step={0.05} onChange={(v, h) => patch(retimeForSpeed(video, v), h)} format={(v) => `${v.toFixed(2)}×`} reset={1} />
          <Slider label="Volume" value={video.muted ? 0 : video.volume} min={0} max={2} onChange={(v, h) => patch({ volume: v, muted: false }, h)} format={pct} reset={1} />
          <Slider label="Fade de entrada" value={video.fadeIn ?? 0} min={0} max={Math.min(3, video.duration / 2)} step={0.05} onChange={(v, h) => patch({ fadeIn: v }, h)} format={secs} reset={0} />
          <Slider label="Fade de saída" value={video.fadeOut ?? 0} min={0} max={Math.min(3, video.duration / 2)} step={0.05} onChange={(v, h) => patch({ fadeOut: v }, h)} format={secs} reset={0} />
        </Section>
      )}
    </>
  );
}
