'use client';
/* diálogo de exportação: MP4/WebM, 540p–4K, 24/30/60 fps, progresso, cancelar, baixar/compartilhar;
   só áudio (WAV/M4A), quadro atual (PNG), SRT/VTT e FCPXML */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useEditor } from '@/lib/store';
import { emit } from '@/lib/events';
import { projectDuration } from '@/lib/ops';
import {
  canExportM4A, canShareFiles, captionCues, detectExportPath, downloadBlob, exportAudio, exportFrame, exportSize,
  exportVideo, safeFileName, shareFile, toFCPXML, toSRT, toVTT, type ExportOptions,
} from '@/lib/export';
import { formatTime } from '@/lib/util';
import { IcAudio, IcCaption, IcClose, IcDownload, IcExport, IcImage, IcProject } from './icons';

type Phase = 'idle' | 'running' | 'done' | 'error';

const QUALITIES: { id: ExportOptions['quality']; label: string; hint: string }[] = [
  { id: 'draft', label: 'Rascunho', hint: '540p' },
  { id: 'hd', label: 'HD', hint: '720p' },
  { id: 'fhd', label: 'Full HD', hint: '1080p' },
  { id: '4k', label: '4K', hint: '2160p' },
];
const FPS = [24, 30, 60];

function extOf(b: Blob): string {
  if (b.type === 'audio/mp4') return 'm4a';
  if (b.type.includes('wav')) return 'wav';
  if (b.type.includes('png')) return 'png';
  return b.type.includes('mp4') ? 'mp4' : 'webm';
}

function fmtSize(bytes: number) {
  if (bytes > 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1e3))} KB`;
}

export default function ExportDialog({ onClose }: { onClose: () => void }) {
  const project = useEditor((s) => s.project);
  const assets = useEditor((s) => s.assets);
  const [format, setFormat] = useState<ExportOptions['format']>('mp4');
  const [quality, setQuality] = useState<ExportOptions['quality']>('hd');
  const [fps, setFps] = useState<number>(() => (FPS.includes(Math.round(project.fps)) ? Math.round(project.fps) : 30));
  const [m4a, setM4a] = useState(false);
  const [job, setJob] = useState<'video' | 'audio'>('video');
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ url: string; blob: Blob; name: string; size: number; type: string; secs: number } | null>(null);
  const [path, setPath] = useState<Awaited<ReturnType<typeof detectExportPath>> | null>(null);
  const [smallDevice, setSmallDevice] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const startedRef = useRef(0);

  const duration = projectDuration(project);
  const size = exportSize(project, quality);
  const cues = useMemo(() => captionCues(project).length, [project]);

  useEffect(() => {
    let alive = true;
    setPath(null);
    detectExportPath(format).then((r) => { if (alive) setPath(r); }).catch(() => {});
    return () => { alive = false; };
  }, [format]);
  useEffect(() => {
    const coarse = matchMedia('(pointer: coarse)').matches;
    const small = Math.min(window.screen?.width ?? 1920, window.screen?.height ?? 1080) < 900;
    setSmallDevice(coarse || small);
  }, []);

  useEffect(() => { canExportM4A().then(setM4a).catch(() => {}); }, []);
  useEffect(() => () => { abortRef.current?.abort(); }, []);
  useEffect(() => () => { if (result) URL.revokeObjectURL(result.url); }, [result]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape' && phase !== 'running') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', h, true);
    return () => window.removeEventListener('keydown', h, true);
  }, [phase, onClose]);

  const run = async (kind: 'video' | 'audio', make: (signal: AbortSignal) => Promise<Blob>) => {
    const ac = new AbortController();
    abortRef.current = ac;
    setPhase('running');
    setProgress(0);
    setError('');
    setResult(null);
    setJob(kind);
    startedRef.current = performance.now();
    try {
      const blob = await make(ac.signal);
      const ext = extOf(blob);
      const url = URL.createObjectURL(blob);
      setResult({ url, blob, name: safeFileName(project.name, ext), size: blob.size, type: ext, secs: (performance.now() - startedRef.current) / 1000 });
      setPhase('done');
      emit('ep:toast', { text: kind === 'video' ? 'Vídeo exportado! Clique em Baixar.' : 'Áudio exportado! Clique em Baixar.', kind: 'ok' });
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') { setPhase('idle'); setStage(''); setProgress(0); return; }
      console.error('[export]', e);
      setError(e instanceof Error ? e.message : String(e));
      setPhase('error');
    } finally {
      abortRef.current = null;
    }
  };

  const onProgress = (f: number, s: string) => { setProgress(f); setStage(s); };
  const start = () => run('video', (signal) => exportVideo(project, assets, { format, quality, fps, signal, onProgress }));
  const startAudio = (fmt: 'wav' | 'm4a') => run('audio', (signal) => exportAudio(project, assets, { format: fmt, signal, onProgress }));
  const [frameBusy, setFrameBusy] = useState(false);
  const saveFrame = async () => {
    setFrameBusy(true);
    try {
      const t = Math.min(useEditor.getState().playhead, Math.max(0, duration - 1 / fps));
      const blob = await exportFrame(project, assets, t, quality === '4k' ? 'fhd' : quality);
      downloadBlob(blob, safeFileName(`${project.name}-quadro`, 'png'));
    } catch (e) {
      emit('ep:toast', { text: `Não deu para salvar o quadro: ${e instanceof Error ? e.message : e}`, kind: 'error' });
    } finally { setFrameBusy(false); }
  };
  const cancel = () => abortRef.current?.abort();
  const close = () => { if (phase === 'running') return; onClose(); };

  return (
    <div className="ep-modal-bg ep-ex-bg" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="ep-modal ep-ex" role="dialog" aria-modal="true" aria-labelledby="ep-ex-title">
        <div className="ep-modal-top">
          <div>
            <div className="ep-title" id="ep-ex-title">Exportar vídeo</div>
            <div className="ep-cardsub">{project.name} · {formatTime(duration, { decimals: true })} · {project.fps} fps</div>
          </div>
          <button className="ep-iconbtn sm" onClick={close} aria-label="Fechar" disabled={phase === 'running'}><IcClose size={16} /></button>
        </div>

        <div className="ep-ex-sect">
          <span className="ep-label">Formato</span>
          <div className="ep-seg">
            <button className={format === 'mp4' ? 'on' : ''} onClick={() => setFormat('mp4')} disabled={phase === 'running'}>MP4</button>
            <button className={format === 'webm' ? 'on' : ''} onClick={() => setFormat('webm')} disabled={phase === 'running'}>WebM</button>
          </div>
        </div>
        <div className="ep-ex-sect">
          <span className="ep-label">Qualidade</span>
          <div className="ep-ex-q">
            {QUALITIES.map((q) => (
              <button key={q.id} className={`ep-ex-qbtn${quality === q.id ? ' on' : ''}`} onClick={() => setQuality(q.id)} disabled={phase === 'running'}>
                <b>{q.label}</b><span>{q.hint}</span>
              </button>
            ))}
          </div>
          <div className="ep-ex-info mono">{size.width}×{size.height} · {fps} fps · {format === 'mp4' ? 'H.264 · MP4' : 'VP9 · WebM'}</div>
        </div>
        <div className="ep-ex-sect">
          <span className="ep-label">Quadros por segundo</span>
          <div className="ep-seg">
            {FPS.map((f) => (
              <button key={f} className={fps === f ? 'on' : ''} onClick={() => setFps(f)} disabled={phase === 'running'}>{f}</button>
            ))}
          </div>
        </div>
        {path?.path === 'mediarecorder' && (
          <div className="ep-ex-warn">Modo compatível: o vídeo é gravado em tempo real ({formatTime(duration)}) e sai em {path.container?.toUpperCase()}. Mantenha esta aba aberta até terminar. Para exportar mais rápido, use Chrome ou Edge.</div>
        )}
        {path?.path === 'none' && (
          <div className="ep-ex-err">Este navegador não consegue gerar vídeo. Use Chrome, Edge, Safari 16.4+ ou Firefox atualizados, ou leve o projeto para outro editor pelos botões abaixo.</div>
        )}
        {smallDevice && (quality === 'fhd' || quality === '4k') && (
          <div className="ep-ex-warn">Em celular, 1080p/4K podem ficar sem memória e travar. Recomendado: HD 720p.</div>
        )}
        {!smallDevice && quality === '4k' && (
          <div className="ep-ex-warn">4K é pesado: pode demorar bastante. Se o aparelho não aguentar, a resolução cai automaticamente.</div>
        )}

        {phase === 'running' && (
          <div className="ep-ex-prog" aria-live="polite">
            <div className="bar"><div className="fill" style={{ width: `${(progress * 100).toFixed(1)}%` }} /></div>
            <div className="row"><span>{stage || 'Preparando…'}</span><b className="mono">{Math.round(progress * 100)}%</b></div>
          </div>
        )}
        {phase === 'error' && <div className="ep-ex-err">Não deu para exportar: {error}</div>}
        {phase === 'done' && result && (
          <div className="ep-ex-done">
            <div className="ok">✓</div>
            <div className="meta">
              <b>{result.name}</b>
              <span>{fmtSize(result.size)} · {result.type.toUpperCase()} · pronto em {result.secs.toFixed(1)} s
                {job === 'video' && format === 'mp4' && result.type !== 'mp4' ? ' · (MP4 indisponível neste navegador, salvo em WebM)' : ''}</span>
            </div>
            <div className="ep-ex-dlrow">
              {canShareFiles() && (
                <button className="ep-btn sec ep-ex-dl" onClick={() => shareFile(result.blob, result.name)}>Compartilhar</button>
              )}
              <a className="ep-btn primary ep-ex-dl" href={result.url} download={result.name} target="_blank" rel="noopener"><IcDownload size={15} /> Baixar</a>
            </div>
          </div>
        )}

        <div className="ep-ex-actions">
          {phase === 'running' ? (
            <button className="ep-btn danger" onClick={cancel}>Cancelar</button>
          ) : (
            <button className="ep-btn primary" onClick={start} disabled={duration <= 0 || path?.path === 'none'}>
              <IcExport size={15} /> {phase === 'done' ? 'Exportar de novo' : 'Exportar vídeo'}
            </button>
          )}
        </div>

        <div className="ep-ex-sep"><span>Outros formatos</span></div>
        <div className="ep-ex-links">
          <div className="ep-ex-pair">
            <button className="ep-ex-link" disabled={duration <= 0 || phase === 'running'} onClick={() => startAudio('wav')}>
              <IcAudio size={18} /><span><b>Só áudio (.wav)</b><i>Sem perdas</i></span>
            </button>
            <button className="ep-ex-link" disabled={duration <= 0 || phase === 'running' || !m4a} onClick={() => startAudio('m4a')}>
              <IcAudio size={18} /><span><b>Só áudio (.m4a)</b><i>{m4a ? 'AAC, menor' : 'Indisponível neste navegador'}</i></span>
            </button>
          </div>
          <button className="ep-ex-link" disabled={duration <= 0 || frameBusy} onClick={saveFrame}>
            <IcImage size={18} /><span><b>{frameBusy ? 'Gerando imagem…' : 'Quadro atual (.png)'}</b><i>Capa/miniatura a partir da posição do cursor</i></span>
          </button>
          <button className="ep-ex-link" disabled={!cues} onClick={() => downloadBlob(toSRT(project), safeFileName(project.name, 'srt'), 'application/x-subrip;charset=utf-8')}>
            <IcCaption size={18} /><span><b>Baixar legendas (.srt)</b><i>{cues ? `${cues} blocos · YouTube, CapCut, Premiere` : 'Sem legendas no projeto'}</i></span>
          </button>
          <button className="ep-ex-link" disabled={!cues} onClick={() => downloadBlob(toVTT(project), safeFileName(project.name, 'vtt'), 'text/vtt;charset=utf-8')}>
            <IcCaption size={18} /><span><b>Legendas web (.vtt)</b><i>Para players HTML5</i></span>
          </button>
          <button className="ep-ex-link" disabled={duration <= 0} onClick={() => downloadBlob(toFCPXML(project, assets), safeFileName(project.name, 'fcpxml'), 'application/xml;charset=utf-8')}>
            <IcProject size={18} /><span><b>Projeto para DaVinci/Final Cut (.fcpxml)</b><i>Cortes, textos e legendas; reconecte os arquivos de mídia ao abrir</i></span>
          </button>
        </div>
      </div>
    </div>
  );
}
