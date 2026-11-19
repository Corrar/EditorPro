'use client';
/* diálogo de exportação: MP4/WebM, 540p–4K, 24/30/60 fps, progresso, cancelar, baixar/compartilhar;
   só áudio (WAV/M4A), quadro atual (PNG), SRT/VTT e FCPXML */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useEditor } from '@/lib/store';
import { emit } from '@/lib/events';
import { projectDuration } from '@/lib/ops';
import {
  canExportM4A, canShareFiles, shareFiles, captionCues, detectExportPath, downloadBlob, exportAudio, exportFrame, exportSize,
  exportVideo, safeFileName, toFCPXML, toSRT, toVTT, type ExportOptions,
  SPEED_LABELS, estimateProjectExport, type ExportSpeed,
} from '@/lib/export';
import { formatTime } from '@/lib/util';
import Icon from '@/components/ui/Icon';

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

export interface ExportInitial { quality?: ExportOptions['quality']; fps?: number }

export default function ExportDialog({ onClose, initial }: { onClose: () => void; initial?: ExportInitial }) {
  const project = useEditor((s) => s.project);
  const assets = useEditor((s) => s.assets);
  const [format, setFormat] = useState<ExportOptions['format']>('mp4');
  // valores iniciais vindos do shell (pílula "1080p ▾"); sem eles, os padrões
  const [quality, setQuality] = useState<ExportOptions['quality']>(() =>
    initial?.quality && ['draft', 'hd', 'fhd', '4k', 'full'].includes(initial.quality) ? initial.quality : 'hd');
  const [fps, setFps] = useState<number>(() => {
    if (initial?.fps && FPS.includes(Math.round(initial.fps))) return Math.round(initial.fps);
    return FPS.includes(Math.round(project.fps)) ? Math.round(project.fps) : 30;
  });
  const [m4a, setM4a] = useState(false);
  const [job, setJob] = useState<'video' | 'audio'>('video');
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ url: string; blob: Blob; name: string; size: number; type: string; secs: number; cover?: { blob: Blob; name: string } } | null>(null);
  const [path, setPath] = useState<Awaited<ReturnType<typeof detectExportPath>> | null>(null);
  const [smallDevice, setSmallDevice] = useState(false);
  /* rapidez × qualidade do encoder */
  const [speed, setSpeed] = useState<ExportSpeed>('equilibrado');
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

  const warnsRef = useRef<string[]>([]);
  const onWarning = (m: string) => { if (!warnsRef.current.includes(m)) warnsRef.current.push(m); };
  const run = async (kind: 'video' | 'audio', make: (signal: AbortSignal) => Promise<Blob>) => {
    warnsRef.current = [];
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
      // capa escolhida na timeline acompanha o vídeo (compartilhar/baixar)
      let cover: { blob: Blob; name: string } | undefined;
      if (kind === 'video' && project.coverTime !== undefined) {
        try {
          setStage('Gerando capa');
          cover = { blob: await exportFrame(project, assets, coverT(), quality === '4k' ? 'fhd' : quality), name: safeFileName(`${project.name}-capa`, 'png') };
        } catch { /* sem capa */ }
      }
      setResult({ url, blob, name: safeFileName(project.name, ext), size: blob.size, type: ext, secs: (performance.now() - startedRef.current) / 1000, cover });
      setPhase('done');
      const w = warnsRef.current;
      if (w.length) emit('ep:toast', { text: `${kind === 'video' ? 'Vídeo' : 'Áudio'} exportado, com aviso: ${w.slice(0, 2).join(' · ')}`, kind: 'info' });
      else emit('ep:toast', { text: kind === 'video' ? 'Vídeo exportado! Clique em Baixar.' : 'Áudio exportado! Clique em Baixar.', kind: 'ok' });
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
  const start = () => run('video', (signal) => exportVideo(project, assets, { format, quality, fps, speed, signal, onProgress, onWarning }));
  const startAudio = (fmt: 'wav' | 'm4a') => run('audio', (signal) => exportAudio(project, assets, { format: fmt, signal, onProgress, onWarning }));
  const [frameBusy, setFrameBusy] = useState(false);
  /** tempo da capa: Project.coverTime (escolhida na timeline) ou o 1º quadro */
  const coverT = () => Math.min(Math.max(0, project.coverTime ?? 0), Math.max(0, duration - 1 / fps));
  const [coverBusy, setCoverBusy] = useState(false);
  const saveCover = async () => {
    setCoverBusy(true);
    try {
      const blob = await exportFrame(project, assets, coverT(), quality === '4k' ? 'fhd' : quality);
      downloadBlob(blob, safeFileName(`${project.name}-capa`, 'png'));
    } catch (e) {
      emit('ep:toast', { text: `Não deu para gerar a capa: ${e instanceof Error ? e.message : e}`, kind: 'error' });
    } finally { setCoverBusy(false); }
  };
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

  const busy = phase === 'running';
  const fmtLabel = format === 'mp4' ? 'H.264 · MP4' : 'VP9 · WebM';

  return (
    <div className="ep-modal-bg ep-ex-bg" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="ep-sheet2 ep-ex" role="dialog" aria-modal="true" aria-labelledby="ep-ex-title">
        <div className="ep-sheet2-head">
          <div className="ep-ex-title">
            <b id="ep-ex-title">Exportar</b>
            <span>{project.name} · {formatTime(duration, { decimals: true })}</span>
          </div>
          <button className="ep-circle" onClick={close} aria-label="Fechar" disabled={busy}><Icon name="close" size={18}/></button>
        </div>

        <div className="ep-ex-sect">
          <span className="ep-ex-h">Formato</span>
          <div className="ep-ex-seg" role="radiogroup" aria-label="Formato">
            {(['mp4', 'webm'] as const).map((f) => (
              <button key={f} role="radio" aria-checked={format === f} className={format === f ? 'on' : ''} onClick={() => setFormat(f)} disabled={busy}>{f === 'mp4' ? 'MP4' : 'WebM'}</button>
            ))}
          </div>
        </div>

        <span className="ep-ex-h">Qualidade</span>
        <div className="ep-tiles ep-ex-tiles" role="radiogroup" aria-label="Qualidade">
          {QUALITIES.map((q) => (
            <button key={q.id} role="radio" aria-checked={quality === q.id} className={`ep-tile${quality === q.id ? ' on' : ''}`} onClick={() => setQuality(q.id)} disabled={busy}>
              <span className="ep-ex-res mono">{q.hint}</span>
              <span className="lb">{q.label}</span>
            </button>
          ))}
        </div>

        <div className="ep-ex-sect">
          <span className="ep-ex-h">Quadros por segundo</span>
          <div className="ep-ex-seg" role="radiogroup" aria-label="Quadros por segundo">
            {FPS.map((f) => (
              <button key={f} role="radio" aria-checked={fps === f} className={fps === f ? 'on' : ''} onClick={() => setFps(f)} disabled={busy}>{f}</button>
            ))}
          </div>
        </div>
        <div className="ep-ex-sect">
          <span className="ep-ex-h">Velocidade</span>
          <div className="ep-ex-seg" role="radiogroup" aria-label="Velocidade da exportação">
            {(Object.keys(SPEED_LABELS) as ExportSpeed[]).map((k) => (
              <button key={k} role="radio" aria-checked={speed === k} className={speed === k ? 'on' : ''} onClick={() => setSpeed(k)} disabled={busy}>{SPEED_LABELS[k]}</button>
            ))}
          </div>
        </div>
        <div className="ep-ex-info mono">{size.width}×{size.height} · {fps} fps · {fmtLabel} · ≈ {formatTime(estimateProjectExport(project, duration, { quality, fps, speed, mobile: smallDevice }))}</div>

        {path?.path === 'mediarecorder' && (
          <div className="ep-ex-note">Modo compatível: o vídeo é gravado em tempo real ({formatTime(duration)}) e sai em {path.container?.toUpperCase()}. Deixe esta aba aberta até terminar.</div>
        )}
        {path?.path === 'none' && (
          <div className="ep-ex-note err">Este navegador não consegue gerar vídeo. Use Chrome, Edge, Safari 16.4+ ou Firefox atualizados, ou leve o projeto para outro editor abaixo.</div>
        )}
        {smallDevice && (quality === 'fhd' || quality === '4k') && (
          <div className="ep-ex-note">No celular, 1080p/4K podem ficar sem memória. Recomendado: HD 720p.</div>
        )}
        {!smallDevice && quality === '4k' && (
          <div className="ep-ex-note">4K é pesado e pode demorar. Se o aparelho não aguentar, a resolução cai sozinha.</div>
        )}

        {busy && (
          <div className="ep-ex-prog" aria-live="polite">
            <div className="row"><span>{(stage || 'Preparando…').split(' · ')[0]}</span><b className="mono">{Math.round(progress * 100)}%</b></div>
            {stage.includes(' · ') && <div className="warn">{stage.split(' · ').slice(1).join(' · ')}</div>}
            <div className="bar"><div className="fill" style={{ width: `${(progress * 100).toFixed(1)}%` }} /></div>
          </div>
        )}
        {phase === 'error' && <div className="ep-ex-note err">Não deu para exportar: {error}</div>}
        {phase === 'done' && result && (
          <div className="ep-ex-done">
            <div className="ok" aria-hidden="true">✓</div>
            <div className="meta">
              <b>{result.name}</b>
              <span>{fmtSize(result.size)} · {result.type.toUpperCase()} · pronto em {result.secs.toFixed(1)} s{result.cover ? ' · com capa' : ''}
                {job === 'video' && format === 'mp4' && result.type !== 'mp4' ? ' · MP4 indisponível aqui, salvo em WebM' : ''}</span>
            </div>
            <div className="ep-ex-dlrow">
              {canShareFiles() && (
                <button className="ep-ex-pill" onClick={() => shareFiles(result.cover ? [{ blob: result.blob, name: result.name }, result.cover] : [{ blob: result.blob, name: result.name }])}>Compartilhar</button>
              )}
              <a className="ep-ex-pill accent" href={result.url} download={result.name} target="_blank" rel="noopener" onClick={() => { if (result.cover) setTimeout(() => downloadBlob(result.cover!.blob, result.cover!.name), 400); }}><Icon name="download" size={16}/> Baixar</a>
            </div>
          </div>
        )}

        {busy ? (
          <button className="ep-ex-cta cancel" onClick={cancel}>Cancelar exportação</button>
        ) : (
          <button className="ep-cta accent ep-ex-cta" onClick={start} disabled={duration <= 0 || path?.path === 'none'}>
            <Icon name="export" size={20}/> {phase === 'done' ? 'Exportar de novo' : 'Exportar vídeo'}
          </button>
        )}

        <span className="ep-ex-h sep">Outros formatos</span>
        <div className="ep-rows">
          <button className="ep-row" disabled={duration <= 0 || busy} onClick={() => startAudio('wav')}>
            <span className="ep-ex-rowtxt"><b>Só áudio (.wav)</b><span className="meta">Sem perdas</span></span><Icon name="music" size={20}/>
          </button>
          <button className="ep-row" disabled={duration <= 0 || busy || !m4a} onClick={() => startAudio('m4a')}>
            <span className="ep-ex-rowtxt"><b>Só áudio (.m4a)</b><span className="meta">{m4a ? 'AAC, arquivo menor' : 'Indisponível neste navegador'}</span></span><Icon name="music" size={20}/>
          </button>
          <button className="ep-row" disabled={duration <= 0 || coverBusy} onClick={saveCover}>
            <span className="ep-ex-rowtxt"><b>{coverBusy ? 'Gerando capa…' : 'Baixar capa (.png)'}</b><span className="meta">{project.coverTime !== undefined ? `Capa escolhida na timeline · ${formatTime(project.coverTime, { decimals: true })}` : 'Sem capa escolhida: usa o 1º quadro'}</span></span><Icon name="image" size={20} />
          </button>
          <button className="ep-row" disabled={duration <= 0 || frameBusy} onClick={saveFrame}>
            <span className="ep-ex-rowtxt"><b>{frameBusy ? 'Gerando imagem…' : 'Quadro atual (.png)'}</b><span className="meta">Capa ou miniatura da posição do cursor</span></span><Icon name="image" size={20}/>
          </button>
          <button className="ep-row" disabled={!cues} onClick={() => downloadBlob(toSRT(project), safeFileName(project.name, 'srt'), 'application/x-subrip;charset=utf-8')}>
            <span className="ep-ex-rowtxt"><b>Legendas (.srt)</b><span className="meta">{cues ? `${cues} blocos · YouTube, CapCut, Premiere` : 'Sem legendas no projeto'}</span></span><Icon name="captions" size={20}/>
          </button>
          <button className="ep-row" disabled={!cues} onClick={() => downloadBlob(toVTT(project), safeFileName(project.name, 'vtt'), 'text/vtt;charset=utf-8')}>
            <span className="ep-ex-rowtxt"><b>Legendas web (.vtt)</b><span className="meta">Para players HTML5</span></span><Icon name="captions" size={20}/>
          </button>
          <button className="ep-row" disabled={duration <= 0} onClick={() => downloadBlob(toFCPXML(project, assets), safeFileName(project.name, 'fcpxml'), 'application/xml;charset=utf-8')}>
            <span className="ep-ex-rowtxt"><b>DaVinci / Final Cut (.fcpxml)</b><span className="meta">Cortes, textos e legendas; reconecte a mídia ao abrir</span></span><Icon name="projects" size={20}/>
          </button>
        </div>
      </div>
    </div>
  );
}
