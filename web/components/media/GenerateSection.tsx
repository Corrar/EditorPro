'use client';
/* =====================================================================
   "Gerar com IA" na ferramenta Mídia: B-roll por texto, Animar foto,
   Estender clipe, Avatar falando. Consulta GET /api/gen/status?probe=1;
   sem rota ou configured:false → cartões desabilitados "Em breve".
   A geração usa probeGeneration/requestGeneration/attachGenerated de
   @/lib/ai/generate (sessão de IA); o vídeo pronto entra na Mídia como B-roll.
   ===================================================================== */
import { useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { emit } from '@/lib/events';
import { useEditor } from '@/lib/store';
import type { MediaAsset } from '@/lib/types';
import { IconImage, IconMusic, IconSpark, IconVideo } from '@/components/shell/icons';
import { attachGenerated, probeGeneration, requestGeneration, type GenKind as AiGenKind } from '@/lib/ai/generate';

type GenKind = 'broll' | 'animate-photo' | 'extend-clip' | 'avatar';
interface GenStatus { configured: boolean; capabilities: AiGenKind[] }
const AI_KIND: Record<GenKind, AiGenKind> = { broll: 'text-to-video', 'animate-photo': 'image-to-video', 'extend-clip': 'extend', avatar: 'avatar' };

const CARDS: { id: GenKind; title: string; desc: string; emoji: string }[] = [
  { id: 'broll', title: 'B-roll por texto', desc: 'Descreva a cena e a IA cria um clipe', emoji: '🎬' },
  { id: 'animate-photo', title: 'Animar foto', desc: 'Dá movimento a uma imagem', emoji: '🖼️' },
  { id: 'extend-clip', title: 'Estender clipe', desc: 'Continua o vídeo por mais alguns segundos', emoji: '⏩' },
  { id: 'avatar', title: 'Avatar falando', desc: 'Foto + áudio viram uma pessoa falando', emoji: '🗣️' },
];

export interface GenRequest { kind: GenKind; prompt?: string; imageAssetId?: string; videoAssetId?: string; audioAssetId?: string; seconds?: number }

async function assetDataUrl(id: string | undefined): Promise<string | undefined> {
  const a = id ? useEditor.getState().assets[id] : undefined;
  if (!a?.url) return undefined;
  const blob = await (await fetch(a.url)).blob();
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(new Error('Não consegui ler a mídia')); r.readAsDataURL(blob); });
}

/** envia ao gerador do servidor, acompanha o progresso e coloca o vídeo pronto na Mídia (B-roll) */
async function submitGeneration(req: GenRequest, onProgress: (f: number, stage: string) => void): Promise<void> {
  const aspect = useEditor.getState().project.aspect;
  onProgress(0.02, 'Preparando…');
  const [imageUrl, videoUrl, audioUrl] = await Promise.all([assetDataUrl(req.imageAssetId), assetDataUrl(req.videoAssetId), assetDataUrl(req.audioAssetId)]);
  const stage = { queued: 'Na fila…', running: 'Gerando…', done: 'Baixando…', error: 'Erro' } as const;
  const { url } = await requestGeneration(AI_KIND[req.kind], { prompt: req.prompt, imageUrl, videoUrl, audioUrl, duration: req.seconds, aspect }, {
    onProgress: (st, pr) => onProgress(Math.max(0.05, Math.min(0.97, pr ?? (st === 'queued' ? 0.05 : 0.5))), stage[st]),
  });
  const title = CARDS.find((c) => c.id === req.kind)?.title ?? 'Vídeo gerado';
  await attachGenerated(url, `${title} ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }).replace(':', 'h')}.mp4`);
  onProgress(1, 'Pronto');
}

function AssetPick({ kind, value, onChange, label }: { kind: MediaAsset['kind']; value: string; onChange: (id: string) => void; label: string }) {
  const list = useEditor(useShallow((s) => Object.values(s.assets).filter((a) => a.kind === kind)));
  const Icon = kind === 'image' ? IconImage : kind === 'audio' ? IconMusic : IconVideo;
  return (
    <label className="ep-pfield">
      <span className="ep-label">{label}</span>
      {list.length ? (
        <select className="ep-select" value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">Escolha…</option>
          {list.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      ) : <span className="ep-genempty"><Icon size={14} /> Importe {kind === 'image' ? 'uma foto' : kind === 'audio' ? 'um áudio' : 'um vídeo'} primeiro</span>}
    </label>
  );
}

function GenForm({ kind, onDone }: { kind: GenKind; onDone: () => void }) {
  const [prompt, setPrompt] = useState('');
  const [image, setImage] = useState('');
  const [video, setVideo] = useState('');
  const [audio, setAudio] = useState('');
  const [seconds, setSeconds] = useState(3);
  const [progress, setProgress] = useState<{ f: number; stage: string } | null>(null);
  const ready = useMemo(() => {
    if (kind === 'broll') return prompt.trim().length > 3;
    if (kind === 'animate-photo') return !!image;
    if (kind === 'extend-clip') return !!video;
    return !!image && !!audio;
  }, [kind, prompt, image, video, audio]);

  const go = async () => {
    setProgress({ f: 0, stage: 'Enviando…' });
    try {
      await submitGeneration({ kind, prompt: prompt.trim() || undefined, imageAssetId: image || undefined, videoAssetId: video || undefined, audioAssetId: audio || undefined, seconds }, (f, stage) => setProgress({ f, stage }));
      emit('ep:toast', { text: 'Vídeo gerado — já está na Mídia como B-roll', kind: 'ok' });
      onDone();
    } catch (e) {
      emit('ep:toast', { text: e instanceof Error ? e.message : 'Falha na geração', kind: 'error' });
    } finally { setProgress(null); }
  };

  return (
    <div className="ep-genform">
      {(kind === 'broll' || kind === 'animate-photo' || kind === 'extend-clip') && (
        <label className="ep-pfield">
          <span className="ep-label">{kind === 'broll' ? 'Descreva a cena' : 'Como deve se mover (opcional)'}</span>
          <textarea className="ep-textarea ep-ptext" rows={2} value={prompt} onChange={(e) => setPrompt(e.target.value)} onKeyDown={(e) => e.stopPropagation()}
            placeholder={kind === 'broll' ? 'Ex.: café sendo servido em câmera lenta, luz da manhã' : 'Ex.: zoom lento, cabelo ao vento'} />
        </label>
      )}
      {(kind === 'animate-photo' || kind === 'avatar') && <AssetPick kind="image" value={image} onChange={setImage} label="Foto" />}
      {kind === 'extend-clip' && <AssetPick kind="video" value={video} onChange={setVideo} label="Clipe" />}
      {kind === 'avatar' && <AssetPick kind="audio" value={audio} onChange={setAudio} label="Áudio da fala" />}
      {kind === 'extend-clip' && (
        <label className="ep-pfield"><span className="ep-label">Segundos a mais</span>
          <select className="ep-select" value={seconds} onChange={(e) => setSeconds(Number(e.target.value))}>{[2, 3, 5, 8].map((n) => <option key={n} value={n}>{n}s</option>)}</select>
        </label>
      )}
      {progress ? (
        <div className="ep-genprog"><i style={{ width: `${Math.round(progress.f * 100)}%` }} /><span>{progress.stage}</span></div>
      ) : (
        <div className="ep-genacts">
          <button type="button" className="ep-mini" onClick={onDone}>Cancelar</button>
          <button type="button" className="ep-btn primary" disabled={!ready} onClick={go}><IconSpark size={15} /> Gerar</button>
        </div>
      )}
    </div>
  );
}

export default function GenerateSection() {
  const [status, setStatus] = useState<GenStatus | null>(null);
  const [open, setOpen] = useState<GenKind | null>(null);
  useEffect(() => {
    let alive = true;
    probeGeneration().then((j) => { if (alive) setStatus({ configured: !!j?.configured, capabilities: j?.capabilities ?? [] }); });
    return () => { alive = false; };
  }, []);
  const on = !!status?.configured;

  return (
    <section className="ep-gen">
      <div className="ep-gen-h">
        <h4><IconSpark size={15} /> Gerar com IA</h4>
        {status && !on && <span className="ep-badge amber">Em breve</span>}
      </div>
      {status && !on && <p className="ep-pnote">Geração de vídeo precisa de uma GPU — será ligada depois.</p>}
      <div className="ep-gengrid">
        {CARDS.map((c) => (
          <button key={c.id} type="button" className={`ep-gencard${open === c.id ? ' on' : ''}`} disabled={!on || !status?.capabilities.includes(AI_KIND[c.id])} aria-expanded={open === c.id}
            onClick={() => setOpen(open === c.id ? null : c.id)} title={on ? c.desc : 'Em breve'}>
            <span className="em">{c.emoji}</span>
            <b>{c.title}</b>
            <span>{c.desc}</span>
          </button>
        ))}
      </div>
      {on && open && <GenForm key={open} kind={open} onDone={() => setOpen(null)} />}
    </section>
  );
}
