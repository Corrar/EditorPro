'use client';
/* =====================================================================
   Harness de teste do módulo IA/Chat (só desenvolvimento): carrega mídia
   no store, dispara a 1ª edição via evento e mostra uma timeline mínima
   lida do store, para ver a edição acontecendo ao vivo.
   ===================================================================== */
import { useEffect, useState } from 'react';
import ChatPanel from '@/components/chat/ChatPanel';
import { useEditor } from '@/lib/store';
import { emit, on } from '@/lib/events';
import { clipEnd, projectDuration } from '@/lib/ops';
import { uid } from '@/lib/util';
import type { MediaAsset, MediaRole } from '@/lib/types';

function probe(url: string, kind: 'video' | 'audio'): Promise<{ duration: number; width?: number; height?: number }> {
  return new Promise((resolve) => {
    const el = document.createElement(kind);
    el.preload = 'metadata';
    el.onloadedmetadata = () => {
      const v = el as HTMLVideoElement;
      resolve({ duration: el.duration || 0, width: v.videoWidth, height: v.videoHeight });
    };
    el.onerror = () => resolve({ duration: 0 });
    el.src = url;
  });
}

async function ingest(files: File[], role: MediaRole) {
  for (const f of files) {
    const kind = f.type.startsWith('audio') ? 'audio' : f.type.startsWith('image') ? 'image' : 'video';
    const url = URL.createObjectURL(f);
    const meta = kind === 'image' ? { duration: 0 } : await probe(url, kind);
    const asset: MediaAsset = { id: uid('asset'), kind, role, name: f.name, mime: f.type, size: f.size, url, ...meta };
    useEditor.getState().addAsset(asset);
  }
}

const DEV_CSS = `
        .ep-devchat { height:100dvh; display:grid; grid-template-columns:minmax(0,1fr) 380px; }
        .ep-devchat > main { grid-column:1; grid-row:1; }
        .ep-devchat > section { grid-column:2; grid-row:1; }
        @media (max-width: 760px) {
          .ep-devchat { grid-template-columns:1fr; grid-template-rows:minmax(0,40dvh) minmax(0,60dvh); }
          .ep-devchat > main { grid-row:1; padding:10px !important; }
          .ep-devchat > section { grid-column:1; grid-row:2; border-left:0 !important; border-top:1px solid var(--line); border-radius:18px 18px 0 0; }
        }
      `;

const COLORS: Record<string, string> = { video: '#D9641E', text: '#8B5CF6', audio: '#2ED573' };

export default function DevChat() {
  const project = useEditor((s) => s.project);
  const assets = useEditor((s) => s.assets);
  const playhead = useEditor((s) => s.playhead);
  const live = useEditor((s) => s.live);
  const undo = useEditor((s) => s.undo);
  const [brief, setBrief] = useState('Vídeo dinâmico para TikTok sobre minha padaria artesanal, com legenda amarela, cores quentes e "Pão quentinho toda manhã". Termine com siga para mais!');
  const [toasts, setToasts] = useState<string[]>([]);
  const dur = Math.max(projectDuration(project), 1);

  useEffect(() => on('ep:attach-files', ({ files, role }) => { ingest(files, role ?? 'source'); }), []);
  useEffect(() => on('ep:toast', ({ text }) => setToasts((t) => [...t.slice(-3), text])), []);
  // ?lang=en-US muda o idioma das legendas (teste da transcrição com áudio em inglês)
  useEffect(() => {
    const lang = new URLSearchParams(location.search).get('lang');
    if (lang) useEditor.getState().dispatch([{ op: 'set_captions', segments: [], language: lang }, { op: 'toggle_captions', enabled: false }], { history: false });
  }, []);

  return (
    <div className="ep-root dark ep-devchat" style={{ background: 'var(--canvasBg)' }}>
      <style dangerouslySetInnerHTML={{ __html: DEV_CSS }} />
      <main style={{ minHeight: 0, padding: 20, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div className="ep-card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <b className="ep-title">Harness IA/Chat</b>
          <label className="ep-label">Material bruto <input data-testid="src" type="file" accept="video/*,audio/*" multiple onChange={(e) => ingest(Array.from(e.target.files ?? []), 'source')} /></label>
          <label className="ep-label">Vídeo-exemplo <input data-testid="ref" type="file" accept="video/*" onChange={(e) => ingest(Array.from(e.target.files ?? []), 'reference')} /></label>
          <label className="ep-label">Música <input data-testid="music" type="file" accept="audio/*" onChange={(e) => ingest(Array.from(e.target.files ?? []), 'music')} /></label>
          <textarea className="ep-textarea" style={{ minHeight: 70 }} value={brief} onChange={(e) => setBrief(e.target.value)} data-testid="brief" />
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="ep-btn primary" data-testid="go" onClick={() => emit('ep:start-ai-edit', { brief })}>Editar com IA</button>
            <button className="ep-btn sec" onClick={() => emit('ep:generate-captions', {})}>Gerar legendas</button>
            <button className="ep-btn sec" data-testid="pt-clip" onClick={() => {
              const v = useEditor.getState().project.tracks.find((t) => t.kind === 'video')?.clips ?? [];
              const c = v[1] ?? v[0];
              if (c) useEditor.getState().setChatContext({ label: `Clipe ${v.indexOf(c) + 1}`, clipIds: [c.id] });
            }}>Apontar clipe 2</button>
            <button className="ep-btn sec" data-testid="pt-point" onClick={() => useEditor.getState().setChatContext({ label: 'Ponto em 0:03', point: { x: 0.8, y: 0.2, t: 3 } })}>Apontar ponto</button>
            <button className="ep-btn sec" data-testid="add-comment" onClick={() => useEditor.getState().dispatch({ op: 'add_marker', marker: { id: uid('cm'), t: 1, end: 3, kind: 'comment', label: 'coloca efeito VHS aqui' } })}>+ Comentário</button>
            <button className="ep-btn sec" onClick={undo}>Desfazer</button>
          </div>
          <div className="ep-meta" data-testid="assets">{Object.values(assets).map((a) => `${a.role}:${a.name} (${a.duration.toFixed(1)}s)`).join(' · ') || 'sem mídia'}</div>
        </div>

        <div className="ep-card" data-testid="timeline">
          <div className="ep-meta mono" data-testid="tlinfo">
            duração {projectDuration(project).toFixed(2)}s · playhead {playhead.toFixed(2)}s · {live.running ? `ao vivo ${live.done}/${live.total}` : 'parado'} · legendas {project.captions.segments.length}{project.captions.enabled ? '' : ' (ocultas)'} · {project.aspect}
          </div>
          <div style={{ position: 'relative', marginTop: 12 }}>
            {project.tracks.map((t) => (
              <div key={t.id} style={{ position: 'relative', height: 34, marginBottom: 6, background: 'var(--track)', borderRadius: 8 }}>
                <span style={{ position: 'absolute', left: 6, top: 9, fontSize: 10, color: 'var(--muted)', zIndex: 1 }}>{t.name}</span>
                {t.clips.map((c) => (
                  <div
                    key={c.id}
                    data-clip={c.type}
                    title={c.id}
                    style={{
                      position: 'absolute', top: 3, bottom: 3, left: `${(c.start / dur) * 100}%`, width: `${(c.duration / dur) * 100}%`,
                      background: COLORS[t.kind], opacity: 0.85, borderRadius: 6, transition: 'all .3s',
                      outline: live.highlightClipId === c.id ? '2px solid #fff' : 'none', fontSize: 10, color: '#fff', overflow: 'hidden', whiteSpace: 'nowrap', padding: '8px 6px',
                    }}
                  >
                    {c.type === 'text' ? c.text : c.type === 'video' ? `${c.colorPreset ?? ''} ${c.keyframes?.length ? '🔍' : ''} ${c.transitionIn ? `↪${c.transitionIn.kind}` : ''}` : c.label}
                  </div>
                ))}
              </div>
            ))}
            <div style={{ position: 'relative', height: 22, background: 'var(--track)', borderRadius: 8 }}>
              {project.captions.segments.map((s) => (
                <div key={s.id} data-caption title={s.text} style={{ position: 'absolute', top: 3, bottom: 3, left: `${(s.start / dur) * 100}%`, width: `${((s.end - s.start) / dur) * 100}%`, background: project.captions.style.color, opacity: 0.7, borderRadius: 4 }} />
              ))}
            </div>
            <div style={{ position: 'absolute', top: -4, bottom: -4, left: `${(playhead / dur) * 100}%`, width: 2, background: '#fff', transition: 'left .2s' }} />
          </div>
          <pre className="mono" style={{ fontSize: 10.5, color: 'var(--sub)', marginTop: 12, whiteSpace: 'pre-wrap' }} data-testid="clips">
            {project.tracks.flatMap((t) => t.clips.map((c) => `${t.id} ${c.type} ${c.start.toFixed(2)}–${clipEnd(c).toFixed(2)} ${c.type === 'text' ? c.text : ''}`)).join('\n')}
          </pre>
          <div className="ep-meta mono" data-testid="capstyle">legenda: {project.captions.style.preset} {project.captions.style.color} {project.captions.style.fontSize}px y={project.captions.style.position.y}</div>
          <div className="ep-meta mono" data-testid="markers">{(project.markers ?? []).map((m) => `${m.kind}@${m.t.toFixed(1)}${m.resolved ? '✓' : ''}${m.label ? `:${m.label}` : ''}`).join(' · ') || 'sem marcadores'}</div>
          <div className="ep-meta mono" data-testid="effects">{project.tracks.flatMap((t) => t.clips).map((c) => { const x = c as unknown as Record<string, unknown>; const bits = [x.speedPreset, x.removeBackground ? 'sem-fundo' : '', Array.isArray(x.effects) ? (x.effects as { kind: string }[]).map((e) => e.kind).join('+') : '', Array.isArray(x.audioEffects) ? (x.audioEffects as { kind: string }[]).map((e) => e.kind).join('+') : '', x.emoji, (x.transitionIn as { kind?: string } | undefined)?.kind].filter(Boolean); return bits.length ? `${c.type}:${bits.join(',')}` : ''; }).filter(Boolean).join(' · ') || 'sem efeitos'}</div>
          <div className="ep-meta" data-testid="style">{project.style?.summary ?? 'sem estilo'}</div>
        </div>
        {toasts.length ? <div className="ep-meta" data-testid="toasts">{toasts.join(' | ')}</div> : null}
      </main>
      <section className="ep-chat" style={{ borderLeft: '1px solid var(--line)', background: 'var(--cardBg)', minHeight: 0 }}>
        <ChatPanel />
      </section>
    </div>
  );
}
