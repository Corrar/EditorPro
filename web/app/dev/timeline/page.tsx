'use client';
/* Harness de desenvolvimento da timeline (sessão timeline). Projeto mock com
   mídias sintéticas, reprodução simulada, mídia arrastável e edição da IA. */
import { useEffect, useState } from 'react';
import Timeline from '@/components/timeline/Timeline';
import { useEditor } from '@/lib/store';
import { on } from '@/lib/events';
import { applyOps, projectDuration, type EditOp } from '@/lib/ops';
import { createProject, makeAudioClip, makeImageClip, makeTextClip, makeVideoClip } from '@/lib/defaults';
import type { MediaAsset } from '@/lib/types';

function frames(hue: number, n: number, label: string): string[] {
  const c = document.createElement('canvas');
  c.width = 90;
  c.height = 160;
  const g = c.getContext('2d')!;
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const h = (hue + i * 9) % 360;
    const grd = g.createLinearGradient(0, 0, 90, 160);
    grd.addColorStop(0, `hsl(${h} 70% 62%)`);
    grd.addColorStop(1, `hsl(${(h + 40) % 360} 60% 32%)`);
    g.fillStyle = grd;
    g.fillRect(0, 0, 90, 160);
    g.fillStyle = 'rgba(255,255,255,.85)';
    g.beginPath();
    g.arc(45 + Math.sin(i / 2) * 18, 70 + Math.cos(i / 3) * 20, 16, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = 'rgba(0,0,0,.55)';
    g.font = 'bold 15px sans-serif';
    g.fillText(`${label}${i + 1}`, 8, 150);
    out.push(c.toDataURL('image/jpeg', 0.7));
  }
  return out;
}

function wave(seconds: number, perSec = 50, beat = 2): number[] {
  const out: number[] = [];
  for (let i = 0; i < seconds * perSec; i++) {
    const t = i / perSec;
    const env = 0.35 + 0.35 * Math.abs(Math.sin(t * Math.PI * beat)) + 0.2 * Math.sin(t * 0.7) ** 2;
    out.push(Math.min(1, env * (0.6 + 0.4 * Math.random())));
  }
  return out;
}

function buildMock() {
  const assets: MediaAsset[] = [
    { id: 'a_praia', kind: 'video', role: 'source', name: 'praia.mp4', mime: 'video/mp4', size: 1, duration: 20, width: 1080, height: 1920, thumbnails: frames(20, 12, 'P') },
    { id: 'a_entrev', kind: 'video', role: 'source', name: 'entrevista.mp4', mime: 'video/mp4', size: 1, duration: 30, width: 1080, height: 1920 },
    { id: 'a_cidade', kind: 'video', role: 'broll', name: 'cidade-noite.mov', mime: 'video/mp4', size: 1, duration: 12, width: 1080, height: 1920, thumbnails: frames(220, 10, 'C') },
    { id: 'a_logo', kind: 'image', role: 'broll', name: 'logo.png', mime: 'image/png', size: 1, duration: 0, width: 512, height: 512, thumbnails: frames(30, 1, 'L') },
    { id: 'a_trilha', kind: 'audio', role: 'music', name: 'trilha-energia.mp3', mime: 'audio/mpeg', size: 1, duration: 60, waveform: wave(60) },
    { id: 'a_voz', kind: 'audio', role: 'source', name: 'narração.wav', mime: 'audio/wav', size: 1, duration: 25 },
  ];
  const A = Object.fromEntries(assets.map((a) => [a.id, a]));
  const base = createProject({ name: 'Mock da timeline' });
  const ops: EditOp[] = [
    { op: 'add_clip', trackId: 'track_video_1', clip: { ...makeVideoClip(A.a_praia, 0, { duration: 4.5, in: 1, label: 'gancho' }), id: 'c_v1' } },
    { op: 'add_clip', trackId: 'track_video_1', clip: { ...makeVideoClip(A.a_entrev, 4.5, { duration: 6, in: 3, transitionIn: { kind: 'crossfade', duration: 0.4 } }), id: 'c_v2' } },
    { op: 'add_clip', trackId: 'track_video_1', clip: { ...makeVideoClip(A.a_praia, 10.5, { duration: 5, in: 9, speed: 1.5 }), id: 'c_v3' } },
    { op: 'add_clip', trackId: 'track_video_1', clip: { ...makeImageClip(A.a_logo, 15.5, 2.5), id: 'c_img' } },
    { op: 'add_track', track: { id: 'track_video_2', kind: 'video', name: 'Sobreposição' } },
    { op: 'add_clip', trackId: 'track_video_2', clip: { ...makeVideoClip(A.a_cidade, 6, { duration: 3, in: 2, label: 'b-roll' }), id: 'c_b1' } },
    { op: 'add_clip', trackId: 'track_text_1', clip: { ...makeTextClip('Você sabia?', 0.3, 2.2), id: 'c_t1' } },
    { op: 'add_clip', trackId: 'track_text_1', clip: { ...makeTextClip('3 dicas rápidas', 5, 2.5), id: 'c_t2' } },
    { op: 'add_clip', trackId: 'track_text_1', clip: { ...makeTextClip('Siga para mais!', 15.6, 2.4), id: 'c_t3' } },
    { op: 'add_clip', trackId: 'track_audio_1', clip: { ...makeAudioClip(A.a_trilha, 0, { duration: 18, in: 4, fadeIn: 0.8, fadeOut: 1.5 }), id: 'c_m1' } },
    { op: 'add_track', track: { id: 'track_audio_2', kind: 'audio', name: 'Narração' } },
    { op: 'add_clip', trackId: 'track_audio_2', clip: { ...makeAudioClip(A.a_voz, 1, { duration: 12 }), id: 'c_n1' } },
    {
      op: 'set_captions',
      segments: [
        { id: 's1', start: 0.4, end: 1.9, text: 'Você sabia disso?' },
        { id: 's2', start: 2.0, end: 4.3, text: 'Esse truque muda tudo' },
        { id: 's3', start: 4.6, end: 7.2, text: 'Primeira dica: luz natural' },
        { id: 's4', start: 7.4, end: 10.1, text: 'Segunda: corte nas pausas' },
        { id: 's5', start: 10.6, end: 13.0, text: 'Terceira: música no ritmo' },
      ],
    },
  ];
  const { project, errors } = applyOps(base, ops);
  if (errors.length) console.warn(errors);
  return { project, assets };
}

const AI_OPS: EditOp[] = [
  { op: 'split_clip', clipId: 'c_v2', at: 7.5, newId: 'c_v2b', explain: 'Cortando a pausa da entrevista em 0:07' },
  { op: 'trim_clip', clipId: 'c_v2b', start: 8.2, explain: 'Removendo o silêncio depois do corte' },
  { op: 'add_clip', trackId: 'track_text_1', clip: { ...makeTextClip('Dica de ouro ✨', 8.4, 1.8), id: 'c_ai_t' }, explain: 'Adicionando texto de destaque' },
  { op: 'update_clip', clipId: 'c_v3', patch: { label: 'zoom' }, explain: 'Marcando zoom no trecho da praia' },
  { op: 'move_clip', clipId: 'c_b1', start: 11, explain: 'Movendo o b-roll para a segunda dica' },
];

export default function TimelineHarness() {
  const [dark, setDark] = useState(false);
  const [ready, setReady] = useState(false);
  const [toast, setToast] = useState('');
  const [tlH, setTlH] = useState<string>('400px');
  const assets = useEditor((s) => s.assets);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    setDark(q.get('theme') === 'dark');
    if (q.get('h')) setTlH(`${q.get('h')}px`);
    else if (window.innerWidth < 700) setTlH('55vh');
    const { project, assets } = buildMock();
    const st = useEditor.getState();
    if (q.get('empty') !== '1') st.loadProject(project);
    for (const a of assets) st.addAsset(a);
    if (q.get('zoom')) st.setZoom(+q.get('zoom')!);
    setReady(true);
    (window as unknown as { __ep: typeof useEditor }).__ep = useEditor;
    return on('ep:toast', (d) => {
      setToast(d.text);
      setTimeout(() => setToast(''), 2200);
    });
  }, []);

  // reprodução simulada (o engine real faz isso no app)
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const st = useEditor.getState();
      const dt = (now - last) / 1000;
      last = now;
      if (st.playing) {
        const d = projectDuration(st.project);
        if (st.playhead >= d) st.setPlaying(false);
        else st.setPlayhead(st.playhead + dt);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className={`ep-root${dark ? ' dark' : ''}`} style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--canvasBg)' }}>
      <header style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, padding: '8px 12px', borderBottom: '1px solid var(--line)' }}>
        <div className="ep-logo"><div className="mark"><span /><i /></div><b>Timeline · harness</b></div>
        <span style={{ flex: 1 }} />
        <div style={{ display: 'flex', gap: 6, overflowX: 'auto', maxWidth: '100%' }} data-testid="media">
          {Object.values(assets).map((a) => (
            <span
              key={a.id}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData('application/x-ep-asset', a.id);
                e.dataTransfer.effectAllowed = 'copy';
              }}
              className="ep-badge g"
              style={{ cursor: 'grab' }}
              data-asset={a.id}
            >
              {a.name}
            </span>
          ))}
        </div>
        <button className="ep-pillbtn" onClick={() => useEditor.getState().applyLive(AI_OPS, { delayMs: 1400 })}>Simular IA</button>
        <button className="ep-pillbtn" onClick={() => setDark(!dark)}>{dark ? 'Tema claro' : 'Tema escuro'}</button>
      </header>
      <div style={{ flex: 1, minHeight: 0, display: 'grid', placeItems: 'center', color: 'var(--muted)', fontSize: 12.5, textAlign: 'center', padding: 8 }}>
        Área do preview (mock) — use Espaço para reproduzir
      </div>
      <section className="ep-timeline" style={{ height: tlH, flex: 'none' }}>{ready && <Timeline />}</section>
      {toast && <div className="ep-toasts"><div className="ep-toast"><span className="dot" style={{ background: 'var(--green)' }} />{toast}</div></div>}
    </div>
  );
}
