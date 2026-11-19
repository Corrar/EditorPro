'use client';
/* =====================================================================
   Seções reutilizáveis do painel do clipe (estilo CapCut). Cada uma edita
   o clipe via update_clip (useClipPatch). Usadas pela aba "Editar" e pelas
   ferramentas Efeitos / Filtros / Ajustes / Áudio.
   ===================================================================== */
import { useRef, useState } from 'react';
import { emit } from '@/lib/events';
import { ingestFile } from '@/lib/media/ingest';
import { freezeFrameOps } from '@/lib/media/place';
import { analyzeBeats, captureFrame, extractAudio } from '@/lib/media/tools';
import { useEditor } from '@/lib/store';
import type { AudioEffectKind, BlendMode, ChromaKey, ClipAnimation, FitMode, Mask, Transform, VisualEffect } from '@/lib/types';
import { DEFAULT_TRANSFORM } from '@/lib/types';
import { uid } from '@/lib/util';
import { IconCopy, IconTrash, IconZoom } from '@/components/shell/icons';
import Icon from '@/components/ui/Icon';
import { useCatalogs } from './catalog';
import { ColorField, Section, Seg, Slider, Toggle } from './controls';
import { clearPropKfs, propAnimated, propKfAt, removePropKf, setPropKf, type KfProp } from './kf';
import { interpolateTransform } from '@/lib/engine/easing';
import { effectDisplayName } from '@/lib/fx/catalog';
import { ShaderCode } from './ShaderCode';
import { pct, secs, signed, useClipPatch } from './hooks';
import {
  ADJUST_DEFS, AUDIO_EFFECTS, COLOR_PRESETS, SPEED_PRESETS,
  cropForRatio, filterValue, filtersToCss, punchInKeyframes, retimeForCurve, retimeForSpeed, setFilter,
} from './presets';
import type { FilterableClip, SoundClip, VisualClip } from './clipkit';
import type { Clip, VideoClip, ImageClip, AudioClip } from '@/lib/types';

const toast = (text: string, kind: 'ok' | 'error' | 'info' = 'ok') => emit('ep:toast', { text, kind });
const errMsg = (e: unknown) => (e instanceof Error ? e.message : 'Algo deu errado');

/** miniatura do asset do clipe (p/ prévias de filtros/efeitos) */
export function useClipThumb(c: Clip | null | undefined): string | undefined {
  return useEditor((s) => {
    if (!c || !('assetId' in c) || !c.assetId) return undefined;
    const th = s.assets[c.assetId]?.thumbnails;
    return th?.[Math.floor((th.length - 1) / 2)];
  });
}

/* ---------- Editar: dividir/duplicar/excluir/substituir/reverso/congelar ---------- */
export function EditSection({ clip }: { clip: Clip }) {
  const dispatch = useEditor((s) => s.dispatch);
  const select = useEditor((s) => s.select);
  const playhead = useEditor((s) => s.playhead);
  const asset = useEditor((s) => ('assetId' in clip && clip.assetId ? s.assets[clip.assetId] : undefined));
  const patch = useClipPatch(clip.id);
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const inside = playhead > clip.start + 0.02 && playhead < clip.start + clip.duration - 0.02;

  const split = () => { const newId = uid('clip'); dispatch({ op: 'split_clip', clipId: clip.id, at: playhead, newId }); select([newId]); };
  const dup = () => { const newId = uid('clip'); dispatch({ op: 'duplicate_clip', clipId: clip.id, newId }); select([newId]); };
  const del = () => { dispatch({ op: 'remove_clip', clipId: clip.id }); select([]); };
  const replace = async (f: File | undefined) => {
    if (!f) return;
    setBusy('Substituindo…');
    try {
      const a = await ingestFile(f, asset?.role);
      const isImg = a.kind === 'image';
      if ((clip.type === 'video' && a.kind !== 'video') || (clip.type === 'image' && !isImg) || (clip.type === 'audio' && a.kind !== 'audio')) throw new Error('Escolha um arquivo do mesmo tipo do clipe');
      const p: Record<string, unknown> = { assetId: a.id, label: a.name };
      if (clip.type === 'video' || clip.type === 'audio') { p.in = 0; if (a.duration) p.duration = Math.min(clip.duration, a.duration / (clip.speed || 1)); }
      patch(p);
      toast('Mídia substituída');
    } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(null); }
  };
  const freeze = async () => {
    if (clip.type !== 'video' || !asset || !inside) return;
    setBusy('Capturando quadro…');
    try {
      const frame = await captureFrame(asset, clip.in + (playhead - clip.start) * (clip.speed || 1));
      dispatch(freezeFrameOps(useEditor.getState().project, clip.id, playhead, frame, 2));
      toast('Quadro congelado por 2s');
    } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(null); }
  };
  const extract = async () => {
    if (clip.type !== 'video' || !asset) return;
    setBusy('Extraindo áudio…');
    try {
      const a = await extractAudio(asset);
      const st = useEditor.getState();
      const trackId = st.project.tracks.find((t) => t.kind === 'audio' && !t.locked)?.id ?? uid('track_audio');
      dispatch([
        { op: 'add_clip', trackId, clip: { id: uid('clip'), type: 'audio', assetId: a.id, start: clip.start, duration: clip.duration, in: clip.in, speed: clip.speed, volume: clip.volume, label: a.name } },
        { op: 'update_clip', clipId: clip.id, patch: { muted: true } },
      ]);
      toast('Áudio extraído para a trilha de áudio');
    } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(null); }
  };

  return (
    <Section title="Editar">
      <div className="ep-actgrid">
        <button type="button" className="ep-act" onClick={split} disabled={!inside} title={inside ? 'Dividir no playhead' : 'Coloque o playhead dentro do clipe'}><span><Icon name="cut" /></span>Dividir</button>
        <button type="button" className="ep-act" onClick={dup}><span><IconCopy size={18} /></span>Duplicar</button>
        {'assetId' in clip && clip.type !== 'sticker' && <button type="button" className="ep-act" onClick={() => input.current?.click()}><span><Icon name="replace" /></span>Substituir</button>}
        {clip.type === 'video' && <button type="button" className={`ep-act${clip.reverse ? ' on' : ''}`} onClick={() => patch({ reverse: !clip.reverse })}><span><Icon name="reverse" /></span>Reverso</button>}
        {clip.type === 'video' && <button type="button" className="ep-act" onClick={freeze} disabled={!inside || !!busy}><span><Icon name="freeze" /></span>Congelar</button>}
        {clip.type === 'video' && <button type="button" className="ep-act" onClick={extract} disabled={!!busy}><span><Icon name="music" /></span>Extrair áudio</button>}
        <button type="button" className="ep-act danger" onClick={del}><span><IconTrash size={18} /></span>Excluir</button>
      </div>
      {busy && <p className="ep-pnote"><span className="ep-spin xs" /> {busy}</p>}
      <input ref={input} type="file" hidden accept={clip.type === 'audio' ? 'audio/*' : clip.type === 'image' ? 'image/*' : 'video/*'} onChange={(e) => { void replace(e.target.files?.[0]); e.target.value = ''; }} />
    </Section>
  );
}

/* ---------- Velocidade: normal + curvas ---------- */
export function SpeedSection({ clip }: { clip: VideoClip | AudioClip }) {
  const patch = useClipPatch(clip.id);
  const [mode, setMode] = useState<'normal' | 'curve'>(clip.speedCurve?.length ? 'curve' : 'normal');
  const curve = clip.speedCurve;
  const setPoint = (i: number, speed: number, h: boolean) => {
    if (!curve) return;
    const next = curve.map((p, j) => (j === i ? { ...p, speed } : p));
    patch({ ...retimeForCurve(clip, next), speedPreset: undefined }, h);
  };
  return (
    <Section title="Velocidade" onReset={() => { setMode('normal'); patch({ ...(curve?.length ? retimeForCurve(clip, undefined) : retimeForSpeed(clip, 1)), speedPreset: undefined, reverse: undefined }); }}>
      <Seg value={mode} onChange={(m) => { setMode(m); if (m === 'normal' && curve) patch({ ...retimeForCurve(clip, undefined), speedPreset: undefined }); }} options={[{ id: 'normal', label: 'Normal' }, { id: 'curve', label: 'Curva' }]} />
      {mode === 'normal' ? (
        <div style={{ marginTop: 12 }}>
          <div className="ep-chips">
            {[0.5, 1, 1.5, 2, 3, 5].map((s) => (
              <button key={s} type="button" className={`ep-chipbtn${Math.abs(clip.speed - s) < 1e-3 ? ' on' : ''}`} onClick={() => patch(retimeForSpeed(clip, s))}>{s}×</button>
            ))}
          </div>
          <Slider label="Velocidade" value={clip.speed} min={0.1} max={10} step={0.05} onChange={(v, h) => patch(retimeForSpeed(clip, v), h)} format={(v) => `${v.toFixed(2)}×`} reset={1} />
          <p className="ep-pnote">Duração resultante: {clip.duration.toFixed(1)}s</p>
        </div>
      ) : (
        <div style={{ marginTop: 12 }}>
          <div className="ep-curvegrid">
            {SPEED_PRESETS.map((p) => (
              <button key={p.id} type="button" className={`ep-curve${clip.speedPreset === p.id ? ' on' : ''}`} onClick={() => patch({ ...retimeForCurve(clip, p.points), speedPreset: p.id })}>
                <CurveGlyph points={p.points} />
                <span>{p.label}</span>
              </button>
            ))}
          </div>
          {curve?.length ? (
            <div className="ep-curveedit">
              <CurveGlyph points={curve} big />
              {curve.map((p, i) => (
                <Slider key={i} label={`Ponto ${i + 1} (${Math.round(p.t * 100)}%)`} value={p.speed} min={0.1} max={10} step={0.05} onChange={(v, h) => setPoint(i, v, h)} format={(v) => `${v.toFixed(1)}×`} />
              ))}
              <button type="button" className="ep-mini" onClick={() => patch({ ...retimeForCurve(clip, undefined), speedPreset: undefined })}>Remover curva</button>
            </div>
          ) : <p className="ep-pnote">Escolha uma curva acima — dá para ajustar cada ponto depois.</p>}
        </div>
      )}
    </Section>
  );
}

function CurveGlyph({ points, big }: { points: { t: number; speed: number }[]; big?: boolean }) {
  const max = 10;
  const y = (s: number) => 36 - (Math.log(s * 10) / Math.log(max * 10)) * 32;
  const d = [...points].sort((a, b) => a.t - b.t).map((p, i) => `${i ? 'L' : 'M'}${(p.t * 96 + 2).toFixed(1)},${y(p.speed).toFixed(1)}`).join(' ');
  return (
    <svg className={`ep-curvesvg${big ? ' big' : ''}`} viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true">
      <line x1="0" x2="100" y1={y(1)} y2={y(1)} className="mid" />
      <path d={d} />
      {big && points.map((p, i) => <circle key={i} cx={p.t * 96 + 2} cy={y(p.speed)} r="2.4" />)}
    </svg>
  );
}

/* ---------- Volume + efeitos de voz ---------- */
export function VolumeSection({ clip }: { clip: SoundClip }) {
  const patch = useClipPatch(clip.id);
  const dispatch = useEditor((s) => s.dispatch);
  const track = useEditor((s) => s.project.tracks.find((t) => t.clips.some((c) => c.id === clip.id)));
  const asset = useEditor((s) => s.assets[clip.assetId]);
  const [busy, setBusy] = useState(false);
  const fx = clip.audioEffects ?? [];
  const toggleFx = (k: AudioEffectKind) => patch({ audioEffects: fx.some((e) => e.kind === k) ? fx.filter((e) => e.kind !== k) : [...fx, { kind: k, amount: 0.6 }] });
  const beats = async () => {
    if (!asset) return;
    setBusy(true);
    try {
      const b = await analyzeBeats(asset);
      const st = useEditor.getState();
      const sp = clip.speed || 1;
      const ops = (st.project.markers ?? []).filter((m) => m.kind === 'beat').map((m) => ({ op: 'remove_marker' as const, markerId: m.id }));
      const add = b.map((t) => clip.start + (t - clip.in) / sp).filter((t) => t >= clip.start && t <= clip.start + clip.duration)
        .map((t) => ({ op: 'add_marker' as const, marker: { id: uid('mk'), t: Math.round(t * 1000) / 1000, kind: 'beat' as const, color: '#D9641E' } }));
      dispatch([...ops, ...add]);
      toast(add.length ? `${add.length} batidas marcadas na timeline` : 'Não encontrei batidas claras', add.length ? 'ok' : 'info');
    } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); }
  };
  return (
    <>
      <Section title="Volume" onReset={() => patch(clip.type === 'video' ? { volume: 1, muted: false, fadeIn: 0, fadeOut: 0, pitch: 0 } : { volume: 1, fadeIn: 0, fadeOut: 0, pitch: 0 })}>
        <Slider label="Volume" value={clip.type === 'video' && clip.muted ? 0 : clip.volume} min={0} max={2} onChange={(v, h) => patch(clip.type === 'video' ? { volume: v, muted: false } : { volume: v }, h)} format={pct} reset={1} />
        <Slider label="Fade de entrada" value={clip.fadeIn ?? 0} min={0} max={Math.max(0.1, Math.min(5, clip.duration / 2))} step={0.05} onChange={(v, h) => patch({ fadeIn: v }, h)} format={secs} reset={0} />
        <Slider label="Fade de saída" value={clip.fadeOut ?? 0} min={0} max={Math.max(0.1, Math.min(5, clip.duration / 2))} step={0.05} onChange={(v, h) => patch({ fadeOut: v }, h)} format={secs} reset={0} />
        <Slider label="Tom (semitons)" value={clip.pitch ?? 0} min={-12} max={12} step={1} onChange={(v, h) => patch({ pitch: v }, h)} format={(v) => (v > 0 ? `+${v}` : String(v))} reset={0} />
        {clip.type === 'video' ? (
          <Toggle label="Mudo" checked={!!clip.muted} onChange={(v) => patch({ muted: v })} />
        ) : (
          <>
            <Toggle label="Abaixar quando houver fala" hint="Ducking automático sob a voz" checked={!!clip.duckUnderVoice} onChange={(v) => patch({ duckUnderVoice: v })} />
            {track && <Toggle label="Silenciar trilha" hint={track.name} checked={!!track.muted} onChange={(v) => dispatch({ op: 'update_track', trackId: track.id, patch: { muted: v } })} />}
          </>
        )}
      </Section>
      <Section title="Efeitos de voz" onReset={fx.length ? () => patch({ audioEffects: [] }) : undefined}>
        <div className="ep-chips">
          {AUDIO_EFFECTS.map((e) => (
            <button key={e.id} type="button" className={`ep-chipbtn${fx.some((x) => x.kind === e.id) ? ' on' : ''}`} onClick={() => toggleFx(e.id)}>{e.label}</button>
          ))}
        </div>
        {fx.map((e, i) => (
          <Slider key={e.kind} label={AUDIO_EFFECTS.find((a) => a.id === e.kind)?.label ?? e.kind} value={e.amount} min={0} max={1} format={pct}
            onChange={(v, h) => patch({ audioEffects: fx.map((x, j) => (j === i ? { ...x, amount: v } : x)) }, h)} />
        ))}
      </Section>
      {clip.type === 'audio' && (
        <Section title="Batidas">
          <button type="button" className="ep-btn sec ep-wide" onClick={beats} disabled={busy}>{busy ? <><span className="ep-spin xs" /> Analisando…</> : <><Icon name="music" size={16} /> Detectar batidas e marcar na timeline</>}</button>
          {!!asset?.beats?.length && <p className="ep-pnote" style={{ marginTop: 8 }}>{asset.beats.length} batidas nesta música.</p>}
        </Section>
      )}
    </>
  );
}

/* ---------- Animação: entrada / saída / loop ---------- */
export function AnimationSection({ clip }: { clip: VisualClip }) {
  const clipAnimations = useCatalogs((c) => c.clipAnimations);
  const patch = useClipPatch(clip.id);
  const [slot, setSlot] = useState<'animationIn' | 'animationOut' | 'animationLoop'>('animationIn');
  const cur = clip[slot];
  const maxD = Math.max(0.2, Math.min(slot === 'animationLoop' ? 3 : 2, clip.duration / (slot === 'animationLoop' ? 1 : 2)));
  return (
    <Section title="Animação" onReset={() => patch({ animationIn: undefined, animationOut: undefined, animationLoop: undefined })}>
      <Seg value={slot} onChange={setSlot} options={[{ id: 'animationIn', label: 'Entrada' }, { id: 'animationOut', label: 'Saída' }, { id: 'animationLoop', label: 'Loop' }]} />
      <div className="ep-animgrid">
        <button type="button" className={`ep-anim${!cur ? ' on' : ''}`} onClick={() => patch({ [slot]: undefined })}><i className="a-none" />Nenhuma</button>
        {clipAnimations.map((a) => (
          <button key={a.id} type="button" className={`ep-anim${cur?.kind === a.id ? ' on' : ''}`} onClick={() => patch({ [slot]: { kind: a.id as ClipAnimation, duration: cur?.duration ?? Math.min(0.5, maxD) } })}>
            <i className={`a-${a.id}`} />{a.label}
          </button>
        ))}
      </div>
      {cur && <Slider label="Duração" value={Math.min(cur.duration, maxD)} min={0.1} max={maxD} step={0.05} onChange={(v, h) => patch({ [slot]: { ...cur, duration: v } }, h)} format={secs} />}
    </Section>
  );
}

/* ---------- Recortar: proporção + espelhar + girar ---------- */
export function CropSection({ clip }: { clip: VideoClip | ImageClip | VisualClip }) {
  const patch = useClipPatch(clip.id);
  const asset = useEditor((s) => ('assetId' in clip && clip.assetId ? s.assets[clip.assetId] : undefined));
  const crop = clip.crop ?? { x: 0, y: 0, w: 1, h: 1 };
  const tf: Transform = { ...DEFAULT_TRANSFORM, ...('transform' in clip ? clip.transform : {}) };
  const ratios: { label: string; r: number | null }[] = [{ label: 'Livre', r: null }, { label: '1:1', r: 1 }, { label: '9:16', r: 9 / 16 }, { label: '16:9', r: 16 / 9 }, { label: '4:5', r: 4 / 5 }];
  const setCrop = (k: 'x' | 'y' | 'w' | 'h', v: number, h: boolean) => {
    const c = { ...crop, [k]: v };
    c.w = Math.min(c.w, 1 - c.x); c.h = Math.min(c.h, 1 - c.y);
    patch({ crop: c }, h);
  };
  return (
    <Section title="Recortar" onReset={() => patch({ crop: undefined, flipH: undefined, flipV: undefined })}>
      <div className="ep-chips">
        {ratios.map((r) => (
          <button key={r.label} type="button" className="ep-chipbtn" onClick={() => patch({ crop: r.r ? cropForRatio(asset?.width ?? 1080, asset?.height ?? 1920, r.r) : undefined })}>{r.label}</button>
        ))}
      </div>
      <div className="ep-cropbox" style={{ aspectRatio: `${asset?.width ?? 9} / ${asset?.height ?? 16}`, backgroundImage: asset?.thumbnails?.[0] ? `url(${asset.thumbnails[0]})` : undefined }}>
        <i style={{ left: `${crop.x * 100}%`, top: `${crop.y * 100}%`, width: `${crop.w * 100}%`, height: `${crop.h * 100}%` }} />
      </div>
      <div className="ep-row2">
        <Slider label="Esquerda" value={crop.x} min={0} max={0.9} onChange={(v, h) => setCrop('x', v, h)} format={pct} />
        <Slider label="Topo" value={crop.y} min={0} max={0.9} onChange={(v, h) => setCrop('y', v, h)} format={pct} />
        <Slider label="Largura" value={crop.w} min={0.1} max={1} onChange={(v, h) => setCrop('w', v, h)} format={pct} />
        <Slider label="Altura" value={crop.h} min={0.1} max={1} onChange={(v, h) => setCrop('h', v, h)} format={pct} />
      </div>
      <div className="ep-actgrid sm">
        <button type="button" className={`ep-act${clip.flipH ? ' on' : ''}`} onClick={() => patch({ flipH: !clip.flipH })}><span><Icon name="flip" /></span>Espelhar</button>
        <button type="button" className={`ep-act${clip.flipV ? ' on' : ''}`} onClick={() => patch({ flipV: !clip.flipV })}><span><Icon name="flip" className="ep-rot90" /></span>Inverter</button>
        <button type="button" className="ep-act" onClick={() => patch({ transform: { ...tf, rotation: ((Math.round(tf.rotation / 90) * 90 + 90 + 180) % 360) - 180 } })}><span><Icon name="rotate" /></span>Girar 90°</button>
      </div>
    </Section>
  );
}

/* ---------- Máscara ---------- */
export function MaskSection({ clip }: { clip: VisualClip }) {
  const masks = useCatalogs((c) => c.masks);
  const patch = useClipPatch(clip.id);
  const m = clip.mask;
  const set = (p: Partial<Mask>, h = true) => m && patch({ mask: { ...m, ...p } }, h);
  return (
    <Section title="Máscara" onReset={m ? () => patch({ mask: undefined }) : undefined}>
      <div className="ep-chips">
        <button type="button" className={`ep-chipbtn${!m ? ' on' : ''}`} onClick={() => patch({ mask: undefined })}>Nenhuma</button>
        {masks.map((s) => (
          <button key={s.id} type="button" className={`ep-chipbtn${m?.shape === s.id ? ' on' : ''}`} onClick={() => patch({ mask: { x: 0.5, y: 0.5, w: 0.6, h: 0.6, rotation: 0, feather: 0.1, ...m, shape: s.id } })}>{s.label}</button>
        ))}
      </div>
      {m && (
        <div style={{ marginTop: 12 }}>
          <Slider label="Posição X" value={m.x} min={0} max={1} onChange={(v, h) => set({ x: v }, h)} format={pct} reset={0.5} />
          <Slider label="Posição Y" value={m.y} min={0} max={1} onChange={(v, h) => set({ y: v }, h)} format={pct} reset={0.5} />
          <Slider label="Largura" value={m.w} min={0.05} max={1.5} onChange={(v, h) => set({ w: v }, h)} format={pct} />
          <Slider label="Altura" value={m.h} min={0.05} max={1.5} onChange={(v, h) => set({ h: v }, h)} format={pct} />
          <Slider label="Rotação" value={m.rotation} min={-180} max={180} step={1} onChange={(v, h) => set({ rotation: v }, h)} format={(v) => `${v}°`} reset={0} />
          <Slider label="Suavizar borda" value={m.feather} min={0} max={1} onChange={(v, h) => set({ feather: v }, h)} format={pct} />
          <Toggle label="Inverter máscara" checked={!!m.invert} onChange={(v) => set({ invert: v })} />
        </div>
      )}
    </Section>
  );
}

/* ---------- Chroma key ---------- */
function pickColorFromThumb(thumb: string, fx: number, fy: number): Promise<string> {
  return new Promise((res) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      const ctx = c.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(Math.floor(fx * (img.width - 1)), Math.floor(fy * (img.height - 1)), 1, 1).data;
      res(`#${[d[0], d[1], d[2]].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase()}`);
    };
    img.src = thumb;
  });
}

export function ChromaSection({ clip }: { clip: VisualClip }) {
  const patch = useClipPatch(clip.id);
  const thumb = useClipThumb(clip);
  const [picking, setPicking] = useState(false);
  const ck = clip.chromaKey;
  const set = (p: Partial<ChromaKey>, h = true) => patch({ chromaKey: { color: '#00FF00', similarity: 0.35, smoothness: 0.1, ...ck, ...p } }, h);
  return (
    <Section title="Chroma key" onReset={ck ? () => patch({ chromaKey: undefined }) : undefined}>
      {!ck ? (
        <div className="ep-chips">
          <button type="button" className="ep-chipbtn" onClick={() => set({ color: '#00FF00' })}><i className="ep-dot" style={{ background: '#00C853' }} /> Fundo verde</button>
          <button type="button" className="ep-chipbtn" onClick={() => set({ color: '#0047FF' })}><i className="ep-dot" style={{ background: '#0047FF' }} /> Fundo azul</button>
        </div>
      ) : (
        <>
          {thumb && (
            <div className={`ep-pickbox${picking ? ' picking' : ''}`} onClick={async (e) => {
              if (!picking) return;
              const r = e.currentTarget.getBoundingClientRect();
              set({ color: await pickColorFromThumb(thumb, (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height) });
              setPicking(false);
            }}>
              <img src={thumb} alt="" />
              <span>{picking ? 'Toque na cor do fundo' : ''}</span>
            </div>
          )}
          <button type="button" className={`ep-btn sec ep-wide${picking ? ' on' : ''}`} onClick={() => setPicking((v) => !v)} disabled={!thumb}><Icon name="picker" size={16} /> Conta-gotas</button>
          <ColorField label="Cor removida" value={ck.color} onChange={(v, h) => set({ color: v }, h)} />
          <Slider label="Similaridade" value={ck.similarity} min={0} max={1} onChange={(v, h) => set({ similarity: v }, h)} format={pct} />
          <Slider label="Suavidade" value={ck.smoothness} min={0} max={1} onChange={(v, h) => set({ smoothness: v }, h)} format={pct} />
        </>
      )}
    </Section>
  );
}

/* ---------- Remover fundo + Mesclagem + Encaixe ---------- */
export function BackgroundSection({ clip }: { clip: VisualClip }) {
  const patch = useClipPatch(clip.id);
  return (
    <Section title="Remover fundo">
      <Toggle label="Recortar a pessoa do fundo" hint="Segmentação no navegador (pode ser pesada em celulares)" checked={!!clip.removeBackground} onChange={(v) => patch({ removeBackground: v })} />
    </Section>
  );
}

export function BlendSection({ clip }: { clip: VisualClip }) {
  const blends = useCatalogs((c) => c.blends);
  const patch = useClipPatch(clip.id);
  const tfc = useTransformControls(clip);
  return (
    <Section title="Composição" onReset={() => { patch({ blendMode: 'normal', keyframes: clearPropKfs(clip.keyframes, 'opacity') }, true); tfc.setBase('opacity', 1); }}>
      <Slider label="Opacidade" min={0} max={1} format={pct} reset={1} {...tfc.slider('opacity')} />
      <div className="ep-chips">
        {blends.map((b) => (
          <button key={b.id} type="button" className={`ep-chipbtn${(clip.blendMode ?? 'normal') === b.id ? ' on' : ''}`} onClick={() => patch({ blendMode: b.id as BlendMode })}>{b.label}</button>
        ))}
      </div>
    </Section>
  );
}

/** sliders de transform com keyframe por propriedade (diamante) */
export function useTransformControls(clip: VisualClip) {
  const patch = useClipPatch(clip.id);
  const playhead = useEditor((s) => s.playhead);
  const tf: Transform = { ...DEFAULT_TRANSFORM, ...clip.transform };
  const local = playhead - clip.start;
  const inside = local >= 0 && local <= clip.duration;
  const kfs = clip.keyframes;
  const cur = interpolateTransform(tf, kfs, Math.max(0, Math.min(clip.duration, local)));
  const setBase = (k: KfProp, v: number, h = true) => patch({ transform: { ...tf, [k]: v } }, h);
  const slider = (k: KfProp) => {
    const animated = propAnimated(kfs, k);
    return {
      value: animated ? cur[k] : tf[k],
      // propriedade animada: editar grava o keyframe no quadro atual (como no DaVinci)
      onChange: (v: number, h: boolean) => (animated && inside ? patch({ keyframes: setPropKf(kfs, k, local, v) }, h) : setBase(k, v, h)),
      kf: {
        at: inside && propKfAt(kfs, k, local),
        animated,
        disabled: !inside,
        toggle: () => patch({ keyframes: propKfAt(kfs, k, local) ? removePropKf(kfs, k, local) : setPropKf(kfs, k, local, cur[k]) }),
      },
    };
  };
  return { slider, setBase, tf, inside };
}

export function FitSection({ clip }: { clip: VisualClip }) {
  const patch = useClipPatch(clip.id);
  return (
    <Section title="Encaixe no quadro">
      <Seg value={(clip.fit ?? 'cover') as FitMode} onChange={(v) => patch({ fit: v })} options={[{ id: 'cover', label: 'Preencher' }, { id: 'contain', label: 'Caber' }, { id: 'fill', label: 'Esticar' }]} />
    </Section>
  );
}

/* ---------- Movimento (transform + punch-in) ---------- */
export function MotionSection({ clip }: { clip: VisualClip }) {
  const patch = useClipPatch(clip.id);
  const tfc = useTransformControls(clip);
  const defScale = clip.type === 'video' || clip.type === 'image' ? 1 : tfc.tf.scale;
  const reset = () => patch({ transform: { ...DEFAULT_TRANSFORM, scale: defScale, opacity: tfc.tf.opacity }, keyframes: (clip.keyframes ?? []).map((k) => ({ ...k, transform: k.transform.opacity !== undefined ? { opacity: k.transform.opacity } : {} })).filter((k) => Object.keys(k.transform).length) }, true);
  return (
    <Section title="Transformar" onReset={reset}>
      {(clip.type === 'video' || clip.type === 'image') && (
        <button type="button" className="ep-btn primary ep-wide" onClick={() => patch({ keyframes: punchInKeyframes(clip, tfc.inside ? useEditor.getState().playhead : clip.start) })}>
          <IconZoom size={16} /> Zoom punch-in aqui
        </button>
      )}
      {!!clip.keyframes?.length && (
        <div className="ep-kfinfo"><span>{clip.keyframes.length} keyframe{clip.keyframes.length === 1 ? '' : 's'} · toque no ◆ para marcar/remover no cursor</span><button type="button" className="ep-mini" onClick={() => patch({ keyframes: [] })}>Limpar</button></div>
      )}
      <Slider label="Escala" min={0.1} max={3} format={pct} reset={clip.type === 'video' || clip.type === 'image' ? 1 : undefined} {...tfc.slider('scale')} />
      <Slider label="Posição X" min={-1} max={1} format={signed} reset={0} {...tfc.slider('x')} />
      <Slider label="Posição Y" min={-1} max={1} format={signed} reset={0} {...tfc.slider('y')} />
      <Slider label="Rotação" min={-180} max={180} step={1} format={(v) => `${Math.round(v)}°`} reset={0} {...tfc.slider('rotation')} />
      <Slider label="Opacidade" min={0} max={1} format={pct} reset={1} {...tfc.slider('opacity')} />
    </Section>
  );
}

/** opacidade sozinha (item "Opacidade" do celular, como no CapCut) */
export function OpacitySection({ clip }: { clip: VisualClip }) {
  const tfc = useTransformControls(clip);
  return (
    <Section title="Opacidade" collapsible={false}>
      <Slider label="Opacidade" min={0} max={1} format={pct} reset={1} {...tfc.slider('opacity')} />
    </Section>
  );
}

/* ---------- Filtros (presets de cor) ---------- */
export function FilterSection({ clip }: { clip: FilterableClip }) {
  const patch = useClipPatch(clip.id);
  const thumb = useClipThumb(clip);
  return (
    <Section title="Filtros" onReset={clip.colorPreset && clip.colorPreset !== 'none' ? () => patch({ colorPreset: undefined }) : undefined}>
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
      {thumb && <div className="ep-lut-preview" title="Prévia aproximada"><span style={{ backgroundImage: `url(${thumb})`, filter: filtersToCss(clip.filters, clip.colorPreset) }} /></div>}
    </Section>
  );
}

/* ---------- Ajustes finos ---------- */
export function AdjustSection({ clip }: { clip: FilterableClip }) {
  const patch = useClipPatch(clip.id);
  return (
    <Section title="Ajustes" onReset={clip.filters?.length ? () => patch({ filters: [] }) : undefined}>
      {ADJUST_DEFS.map((d) => (
        <Slider key={d.kind} label={d.label} min={d.min} max={d.max} value={filterValue(clip.filters, d.kind)}
          onChange={(v, h) => patch({ filters: setFilter(clip.filters, d.kind, v) }, h)} format={d.min < 0 ? signed : pct} reset={0} />
      ))}
    </Section>
  );
}

/* ---------- Efeitos visuais ---------- */
export function EffectsSection({ clip }: { clip: VisualClip | FilterableClip }) {
  const effects = useCatalogs((c) => c.effects);
  const patch = useClipPatch(clip.id);
  const thumb = useClipThumb(clip);
  const fx: VisualEffect[] = clip.effects ?? [];
  const toggle = (k: VisualEffect['kind']) => patch({ effects: fx.some((e) => e.kind === k) ? fx.filter((e) => e.kind !== k) : [...fx, { kind: k, intensity: 0.6, speed: 1 }] });
  return (
    <Section title="Efeitos" onReset={fx.length ? () => patch({ effects: [] }) : undefined}>
      <div className="ep-fxgrid">
        {effects.filter((e) => e.id !== 'custom').map((e) => {
          const on = fx.some((x) => x.kind === e.id);
          return (
            <button key={e.id} type="button" className={`ep-fx${on ? ' on' : ''} fx-${e.id}`} onClick={() => toggle(e.id)} aria-pressed={on}>
              <span className="ep-fx-img" style={{ backgroundImage: thumb ? `url(${thumb})` : undefined, filter: e.css }} />
              <span className="ep-fx-l">{e.label}</span>
            </button>
          );
        })}
      </div>
      {fx.map((e, i) => (
        <div key={`${e.kind}-${i}`} className="ep-fxctl">
          <b>{e.kind === 'custom' ? effectDisplayName(e) : effects.find((v) => v.id === e.kind)?.label ?? e.kind}</b>
          <Slider label="Intensidade" value={e.intensity} min={0} max={1} onChange={(v, h) => patch({ effects: fx.map((x, j) => (j === i ? { ...x, intensity: v } : x)) }, h)} format={pct} />
          <Slider label="Velocidade" value={e.speed ?? 1} min={0} max={2} onChange={(v, h) => patch({ effects: fx.map((x, j) => (j === i ? { ...x, speed: v } : x)) }, h)} format={(v) => `${v.toFixed(1)}×`} reset={1} />
          {e.kind === 'custom' && (
            <>
              {(e.params ?? []).slice(0, 8).map((pv, k) => (
                <Slider key={k} label={`Parâmetro ${k + 1}`} value={pv} min={Math.min(0, pv)} max={Math.max(1, pv)} onChange={(v, h) => patch({ effects: fx.map((x, j) => (j === i ? { ...x, params: (x.params ?? []).map((q, m) => (m === k ? v : q)) } : x)) }, h)} format={(v) => v.toFixed(2)} />
              ))}
              {e.color && <ColorField label="Cor" value={e.color} onChange={(c) => patch({ effects: fx.map((x, j) => (j === i ? { ...x, color: c } : x)) })} />}
              <ShaderCode code={e.code ?? ''} stage="effect" />
              <button type="button" className="ep-btn sec ep-wide" onClick={() => patch({ effects: fx.filter((_, j) => j !== i) })}>Remover efeito</button>
            </>
          )}
        </div>
      ))}
    </Section>
  );
}
