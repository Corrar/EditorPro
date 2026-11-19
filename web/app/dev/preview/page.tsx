'use client';
/* =====================================================================
   Harness de desenvolvimento do módulo engine/preview/export.
   /dev/preview — carregue vídeos/imagens/áudio e monta um projeto demo com
   transições, textos, legendas e música. Exposto em window.__ep p/ testes.
   ===================================================================== */
import { useEffect, useState } from 'react';
import Preview from '@/components/preview/Preview';
import { useEditor } from '@/lib/store';
import { emit } from '@/lib/events';
import type { EditOp } from '@/lib/ops';
import type { CaptionPreset, MediaAsset, TransitionKind } from '@/lib/types';
import { DEFAULT_CAPTION_STYLE, makeAdjustmentClip, makeAudioClip, makeImageClip, makeShapeClip, makeStickerClip, makeTextClip, makeVideoClip } from '@/lib/defaults';
import { exportVideo, exportAudio, exportFrame, toFCPXML, toSRT, toVTT, hasWebCodecs, makePreviewProxy, probeVideoInfo } from '@/lib/export';
import { uid } from '@/lib/util';

async function probe(file: File): Promise<MediaAsset> {
  const url = URL.createObjectURL(file);
  const kind: MediaAsset['kind'] = file.type.startsWith('image') ? 'image' : file.type.startsWith('audio') ? 'audio' : 'video';
  const base: MediaAsset = { id: uid('asset'), kind, role: kind === 'audio' ? 'music' : 'source', name: file.name, mime: file.type, size: file.size, duration: 0, url };
  if (kind === 'image') {
    const img = new Image();
    img.src = url;
    await img.decode().catch(() => {});
    return { ...base, width: img.naturalWidth, height: img.naturalHeight };
  }
  const el = document.createElement(kind === 'audio' ? 'audio' : 'video');
  el.preload = 'metadata';
  el.src = url;
  await new Promise((r) => { el.onloadedmetadata = r; el.onerror = r; });
  const v = el as HTMLVideoElement;
  return { ...base, duration: Number.isFinite(el.duration) ? el.duration : 0, width: v.videoWidth || undefined, height: v.videoHeight || undefined };
}

interface DemoOpts { transition?: TransitionKind; captionPreset?: CaptionPreset; captions?: boolean }

function buildDemo(assets: MediaAsset[], o: DemoOpts = {}) {
  const st = useEditor.getState();
  st.newProject({ name: 'Demo do engine', aspect: '9:16' });
  const vids = assets.filter((a) => a.kind === 'video');
  const imgs = assets.filter((a) => a.kind === 'image');
  const music = assets.find((a) => a.kind === 'audio');
  const v1 = vids[0], v2 = vids[1] ?? vids[0];
  const ops: EditOp[] = [];
  if (v1) {
    ops.push({ op: 'add_clip', trackId: 'track_video_1', clip: makeVideoClip(v1, 0, {
      id: 'clipA', duration: 2, in: 0, colorPreset: 'cinematic',
      keyframes: [{ t: 0, transform: { scale: 1 } }, { t: 2, transform: { scale: 1.15 }, easing: 'easeInOut' }],
    }) });
    ops.push({ op: 'add_clip', trackId: 'track_video_1', clip: makeVideoClip(v2, 2, {
      id: 'clipB', duration: 1.5, in: 1, transitionIn: { kind: o.transition ?? 'slide-left', duration: 0.6 },
      filters: [{ kind: 'saturation', value: 0.3 }],
    }) });
    if (imgs[0]) {
      ops.push({ op: 'add_clip', trackId: 'track_video_1', clip: makeImageClip(imgs[0], 3.5, 1.5, {
        id: 'clipC', transitionIn: { kind: 'glitch', duration: 0.4 },
        keyframes: [{ t: 0, transform: { scale: 1.2, x: -0.03 } }, { t: 1.5, transform: { scale: 1, x: 0.03 } }],
      }) });
    } else {
      ops.push({ op: 'add_clip', trackId: 'track_video_1', clip: makeVideoClip(v1, 3.5, {
        id: 'clipC', duration: 1.5, in: 5, transitionIn: { kind: 'glitch', duration: 0.4 }, colorPreset: 'vintage', fadeOut: 0.4,
      }) });
    }
  }
  ops.push({ op: 'add_clip', trackId: 'track_text_1', clip: makeTextClip('EditorPro', 0.2, 1.8, {
    id: 'txt1', position: { x: 0.5, y: 0.18 }, animation: 'pop',
    style: { ...makeTextClip('', 0).style, uppercase: true, fontSize: 120, color: '#FFFFFF', strokeColor: '#D9641E', strokeWidth: 8 },
  }) });
  ops.push({ op: 'add_clip', trackId: 'track_text_1', clip: makeTextClip('Edição ao vivo com IA, direto no navegador', 2.2, 2.6, {
    id: 'txt2', position: { x: 0.5, y: 0.32 }, animation: 'slide-up',
    style: { ...makeTextClip('', 0).style, fontSize: 64, fontWeight: 700, background: 'rgba(217,100,30,0.92)', strokeWidth: 0, shadow: false },
  }) });
  if (music) ops.push({ op: 'add_clip', trackId: 'track_audio_1', clip: makeAudioClip(music, 0, { id: 'mus', duration: 5, volume: 0.6, fadeIn: 0.5, fadeOut: 1, duckUnderVoice: true }) });
  if (o.captions !== false) {
    const w = (text: string, start: number, end: number) => ({ text, start, end });
    ops.push({ op: 'set_captions', segments: [
      { id: 'seg1', start: 0.3, end: 2.4, text: 'Esse é o melhor editor de vídeo', emphasis: ['melhor'],
        words: [w('Esse', 0.3, 0.55), w('é', 0.55, 0.7), w('o', 0.7, 0.8), w('melhor', 0.8, 1.3), w('editor', 1.35, 1.8), w('de', 1.8, 1.95), w('vídeo', 1.95, 2.4)] },
      { id: 'seg2', start: 2.6, end: 4.8, text: 'e ele edita tudo ao vivo pra você', emphasis: ['vivo'] },
    ] });
    ops.push({ op: 'set_caption_style', style: { ...DEFAULT_CAPTION_STYLE, preset: o.captionPreset ?? 'karaoke', maxWords: 3 } });
  }
  st.dispatch(ops);
  st.setPlayhead(0);
}

/** demo com os recursos estilo CapCut: curvas, reverso, chroma, máscara, PiP, sticker, forma, ajuste, fundo desfocado */
function buildCapcutDemo(assets: MediaAsset[]) {
  const st = useEditor.getState();
  st.newProject({ name: 'Demo CapCut', aspect: '9:16' });
  const by = (re: RegExp) => assets.find((a) => re.test(a.name));
  const a = by(/^a\./) ?? assets.find((x) => x.kind === 'video')!;
  const b = by(/^b\./) ?? a;
  const green = by(/green/);
  const music = assets.find((x) => x.kind === 'audio');
  const ts = makeTextClip('', 0).style;
  const ops: EditOp[] = [
    { op: 'set_project', patch: { canvas: { type: 'blur', blur: 0.7 } } },
    { op: 'add_clip', trackId: 'track_video_1', clip: makeVideoClip(a, 0, {
      id: 'cA', duration: 2, in: 0, speedPreset: 'bullet', effects: [{ kind: 'vhs', intensity: 0.6 }],
      animationIn: { kind: 'zoom-out', duration: 0.5 }, audioEffects: [{ kind: 'robot', amount: 0.7 }] }) },
    { op: 'add_clip', trackId: 'track_video_1', clip: makeVideoClip(b, 2, {
      id: 'cB', duration: 2, in: 1, fit: 'contain', transitionIn: { kind: 'circle-open', duration: 0.6 },
      filters: [{ kind: 'shadows', value: 0.4 }, { kind: 'highlights', value: -0.3 }, { kind: 'sharpen', value: 0.5 }] }) },
    { op: 'add_clip', trackId: 'track_video_1', clip: makeVideoClip(a, 4, {
      id: 'cC', duration: 2, in: 3, reverse: true, flipH: true, transitionIn: { kind: 'wipe-left', duration: 0.5 },
      mask: { shape: 'heart', x: 0.5, y: 0.45, w: 0.8, h: 0.5, rotation: 0, feather: 0.25 } }) },
    { op: 'add_track', track: { id: 'track_pip', kind: 'video', name: 'PiP' } },
    { op: 'add_track', track: { id: 'track_ov', kind: 'overlay', name: 'Sobreposição' } },
    { op: 'add_track', track: { id: 'track_fx', kind: 'effect', name: 'Ajuste' } },
  ];
  if (green) ops.push({ op: 'add_clip', trackId: 'track_pip', clip: makeVideoClip(green, 0.5, {
    id: 'cG', duration: 5, in: 0, chromaKey: { color: '#00ff00', similarity: 0.4, smoothness: 0.1 }, pitch: 5,
    transform: { x: 0.18, y: -0.2, scale: 0.55, rotation: 0, opacity: 1 },
    animationIn: { kind: 'slide-left', duration: 0.5 }, animationLoop: { kind: 'swing', duration: 2 } }) });
  ops.push(
    { op: 'add_clip', trackId: 'track_ov', clip: makeStickerClip(1, { emoji: '🔥' }, 4, { id: 'sF', transform: { x: -0.3, y: -0.36, scale: 0.22, rotation: 0, opacity: 1 }, animationLoop: { kind: 'bounce', duration: 0.8 } }) },
    { op: 'add_clip', trackId: 'track_ov', clip: makeShapeClip('star', 2, 4, { id: 'shS', fill: '#FFD23F', stroke: '#D9641E', strokeWidth: 8, transform: { x: 0.3, y: 0.3, scale: 0.18, rotation: 15, opacity: 0.9 }, animationLoop: { kind: 'spin', duration: 3 } }) },
    { op: 'add_clip', trackId: 'track_fx', clip: makeAdjustmentClip(3, 2, { id: 'adj', colorPreset: 'moody', effects: [{ kind: 'light-leak', intensity: 0.7 }] }) },
    { op: 'add_clip', trackId: 'track_text_1', clip: makeTextClip('Estilo CapCut', 0.2, 2.6, {
      id: 'tA', position: { x: 0.5, y: 0.14 }, animation: 'wave', animationOut: 'slide-right', animationLoop: 'wave',
      style: { ...ts, fontSize: 110, italic: true, underline: true, letterSpacing: 6, uppercase: true,
        gradient: { from: '#FFD23F', to: '#D9641E', angle: 90 }, strokeColor: '#1C1F22', strokeWidth: 6 } }) },
    { op: 'add_clip', trackId: 'track_text_1', clip: makeTextClip('máscaras, chroma e ajustes', 3, 2.8, {
      id: 'tB', position: { x: 0.5, y: 0.2 }, animation: 'blur', rotation: -4,
      keyframes: [{ t: 0, transform: { scale: 0.9 } }, { t: 2.8, transform: { scale: 1.1 } }],
      style: { ...ts, fontSize: 60, background: 'rgba(28,31,34,0.85)', backgroundRadius: 40, strokeWidth: 0, shadow: false } }) },
  );
  if (music) ops.push({ op: 'add_clip', trackId: 'track_audio_1', clip: makeAudioClip(music, 0, { id: 'mus', duration: 6, volume: 0.5, audioEffects: [{ kind: 'echo', amount: 0.5 }], duckUnderVoice: true }) });
  st.dispatch(ops);
  st.setPlayhead(0);
}

declare global {
  interface Window { __ep?: Record<string, unknown> }
}

export default function DevPreviewPage() {
  const [assets, setAssets] = useState<MediaAsset[]>([]);
  const [dark, setDark] = useState(true);
  const project = useEditor((s) => s.project);
  const live = useEditor((s) => s.live.running);

  useEffect(() => {
    window.__ep = {
      useEditor, exportVideo, exportAudio, exportFrame, toFCPXML, toSRT, toVTT, hasWebCodecs, makePreviewProxy, probeVideoInfo, buildDemo, buildCapcutDemo, emit, assetsList: () => Object.values(useEditor.getState().assets),
      color: () => import('@/lib/color'),
      blobToBase64: async (b: Blob) => {
        const buf = new Uint8Array(await b.arrayBuffer());
        let s = '';
        for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
        return btoa(s);
      },
    };
  }, []);

  // integra com o evento de anexar arquivos (o shell faria a ingestão)
  useEffect(() => {
    const h = async (e: Event) => {
      const files = (e as CustomEvent<{ files: File[] }>).detail.files;
      await load(files);
    };
    window.addEventListener('ep:attach-files', h);
    return () => window.removeEventListener('ep:attach-files', h);
  });

  const load = async (files: File[]) => {
    const list = await Promise.all(files.map(probe));
    list.forEach((a) => useEditor.getState().addAsset(a));
    const all = [...assets, ...list];
    setAssets(all);
    buildDemo(all);
  };

  const fakeLive = () => {
    const st = useEditor.getState();
    st.applyLive([
      { op: 'update_clip', clipId: 'txt1', patch: { animation: 'bounce' }, explain: 'Deixando o título com quique' },
      { op: 'set_caption_style', style: { preset: 'neon' }, explain: 'Trocando legenda para neon' },
      { op: 'update_clip', clipId: 'clipB', patch: { colorPreset: 'warm' }, explain: 'Esquentando as cores do 2º clipe' },
    ], { delayMs: 1600 });
  };

  return (
    <div className={`ep-root ep-devpv${dark ? ' dark' : ''}`}>
      <style dangerouslySetInnerHTML={{ __html: `
        .ep-devpv { height:100vh; height:100dvh; display:grid; grid-template-columns:300px minmax(0,1fr); background:var(--canvasBg); }
        .ep-devpv > aside { padding:18px; border-right:1px solid var(--line); display:flex; flex-direction:column; gap:10px; overflow:auto; }
        @media (max-width: 800px) {
          .ep-devpv { grid-template-columns:minmax(0,1fr); grid-template-rows:auto minmax(0,1fr); }
          .ep-devpv > aside { padding:10px; flex-direction:row; flex-wrap:wrap; border-right:0; border-bottom:1px solid var(--line); max-height:30vh; }
          .ep-devpv > aside p, .ep-devpv > aside .ep-badges { display:none; }
          .ep-devpv > aside .ep-btn { padding:8px 12px; }
        }
      ` }} />
      <aside>
        <div className="ep-title">Harness · Engine</div>
        <p className="ep-cardsub">Carregue mídias para montar um projeto demo (transições, textos, legendas e música).</p>
        <input data-testid="files" type="file" multiple accept="video/*,image/*,audio/*" onChange={(e) => load(Array.from(e.target.files ?? []))} />
        <div className="ep-badges">
          <span className="ep-badge g">{assets.length} mídias</span>
          <span className="ep-badge">{project.tracks.reduce((n, t) => n + t.clips.length, 0)} clipes</span>
          <span className="ep-badge">{project.width}×{project.height}</span>
        </div>
        <button className="ep-btn sec" onClick={() => buildDemo(assets)}>Remontar demo</button>
        <button className="ep-btn sec" onClick={() => buildCapcutDemo(assets)}>Demo CapCut</button>
        <button className="ep-btn sec" onClick={fakeLive} disabled={live}>Simular IA editando</button>
        <button className="ep-btn sec" onClick={() => {
          const st = useEditor.getState();
          const next = st.project.aspect === '9:16' ? '16:9' : '9:16';
          st.dispatch({ op: 'set_aspect', aspect: next });
        }}>Alternar 9:16 / 16:9</button>
        <button className="ep-btn primary" onClick={() => emit('ep:open-export', {})}>Exportar…</button>
        <button className="ep-btn sec" onClick={() => setDark(!dark)}>Tema claro/escuro</button>
      </aside>
      <main className="ep-stage" style={{ minHeight: 0, gridColumn: 'auto', gridRow: 'auto' }}><Preview /></main>
    </div>
  );
}
