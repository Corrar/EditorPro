'use client';
/* =====================================================================
   Harness da biblioteca profissional — /dev/library (dono: sessão biblioteca).
   Preview do engine + todas as galerias. Botões montam um projeto de teste
   (cena gerada em canvas + legendas). Exposto em window.__epLib p/ testes.
   ===================================================================== */
import { useEffect, useState } from 'react';
import Preview from '@/components/preview/Preview';
import LibraryHub from '@/components/library/LibraryHub';
import { useEditor } from '@/lib/store';
import { on } from '@/lib/events';
import { makeImageClip, makeTextClip } from '@/lib/defaults';
import { previewScene } from '@/components/library/mini';
import type { CaptionSegment, MediaAsset } from '@/lib/types';
import * as lib from '@/lib/library';

declare global {
  interface Window { __epLib?: Record<string, unknown> }
}

async function sceneAsset(): Promise<MediaAsset> {
  const c = previewScene()!;
  const blob: Blob = await new Promise((r) => c.toBlob((b) => r(b!), 'image/png'));
  const url = URL.createObjectURL(blob);
  return { id: 'asset_scene', kind: 'image', role: 'source', name: 'cena.png', mime: 'image/png', size: blob.size, duration: 0, width: c.width, height: c.height, url, thumbnails: [c.toDataURL('image/jpeg', 0.6)] };
}

function demoSegments(): CaptionSegment[] {
  const phrases = ['Esse truque vai mudar o seu vídeo', 'Dinheiro rápido com ideia simples', 'Comente se você gostou da dica'];
  let t = 0.3;
  return phrases.map((text, i) => {
    const words = text.split(' ').map((w, j) => ({ id: `w${i}_${j}`, text: w, start: t + j * 0.38, end: t + (j + 1) * 0.38 }));
    const seg = { id: `s${i}`, start: t, end: words[words.length - 1].end, text, words };
    t = seg.end + 0.25;
    return seg;
  });
}

async function buildDemo(aspect: '9:16' | '16:9' = '9:16') {
  const st = useEditor.getState();
  st.newProject({ name: 'Teste da biblioteca', aspect });
  const a = await sceneAsset();
  useEditor.getState().addAsset(a);
  useEditor.getState().dispatch([
    { op: 'add_clip', trackId: 'track_video_1', clip: makeImageClip(a, 0, 10, { id: 'clip_scene' }) },
    { op: 'add_clip', trackId: 'track_text_1', clip: makeTextClip('Texto de teste', 6, 3, { id: 'clip_text' }) },
    { op: 'set_captions', segments: demoSegments() },
  ], { history: false });
  useEditor.getState().setPlayhead(1);
}

export default function LibraryHarness() {
  const [dark, setDark] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const project = useEditor((s) => s.project);
  const selection = useEditor((s) => s.selection);
  const playhead = useEditor((s) => s.playhead);

  useEffect(() => {
    window.__epLib = { useEditor, lib, buildDemo };
    void buildDemo();
    return on('ep:toast', ({ text }) => { setToast(text); setTimeout(() => setToast(null), 2600); });
  }, []);

  const clips = project.tracks.flatMap((t) => t.clips.map((c) => ({ ...c, track: t.name })));

  return (
    <div className={`ep-root ep-devlib${dark ? ' dark' : ''}`} style={{ minHeight: '100dvh', background: 'var(--bg)', color: 'var(--ink)' }}>
      <style>{`
        .ep-devlib { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,460px); gap:20px; padding:16px; box-sizing:border-box; }
        .ep-devlib-left { display:flex; flex-direction:column; gap:12px; min-width:0; }
        .ep-devlib-pv { height:min(62vh, 640px); display:flex; flex-direction:column; border-radius:24px; overflow:hidden; }
        .ep-devlib-right { min-width:0; }
        .ep-devlib-bar { display:flex; gap:8px; flex-wrap:wrap; }
        .ep-devlib-clips { font-size:12px; color:var(--muted); display:flex; flex-direction:column; gap:3px; max-height:180px; overflow:auto; }
        .ep-devlib-clips button { text-align:left; border:0; background:var(--tile); border-radius:10px; padding:6px 10px; font:inherit; color:var(--ink); cursor:pointer; }
        .ep-devlib-clips button.on { background:var(--tintG); }
        .ep-devlib-toast { position:fixed; left:50%; bottom:20px; transform:translateX(-50%); background:var(--inverse); color:var(--inverseInk); padding:12px 18px; border-radius:999px; font-size:14px; font-weight:600; z-index:50; }
        @media (max-width: 899px) { .ep-devlib { grid-template-columns:minmax(0,1fr); padding:12px; } .ep-devlib-pv { height:46vh; } }
      `}</style>
      <div className="ep-devlib-left">
        <div className="ep-devlib-bar">
          <button className="ep-pill2" onClick={() => buildDemo('9:16')}>Projeto 9:16</button>
          <button className="ep-pill2" onClick={() => buildDemo('16:9')}>Projeto 16:9</button>
          <button className="ep-pill2" onClick={() => useEditor.getState().undo()}>Desfazer</button>
          <button className="ep-pill2" onClick={() => setDark(!dark)}>{dark ? 'Claro' : 'Escuro'}</button>
        </div>
        <div className="ep-devlib-pv"><Preview /></div>
        <div className="ep-devlib-clips" data-testid="clips">
          <span>Playhead {playhead.toFixed(2)}s · {clips.length} clipes · legendas: {project.captions.style.preset}</span>
          {clips.map((c) => (
            <button key={c.id} className={selection.includes(c.id) ? 'on' : ''} onClick={() => useEditor.getState().select([c.id])}>
              {c.track} · {c.type}{c.groupId ? ' · grupo' : ''} · {c.start.toFixed(2)}s · {c.label ?? ('text' in c ? c.text : c.id)}
            </button>
          ))}
        </div>
      </div>
      <div className="ep-devlib-right"><LibraryHub /></div>
      {toast && <div className="ep-devlib-toast" role="status">{toast}</div>}
    </div>
  );
}
