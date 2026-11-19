'use client';
/* =====================================================================
   Ferramentas de mídia com DOM: capturar quadro, extrair áudio, detectar
   batidas, gravar narração. Tudo devolve assets já ingeridos.
   ===================================================================== */
import type { MediaAsset } from '../types';
import { useEditor } from '../store';
import { detectBeats, toMono } from './beats';
import { ingestFile } from './ingest';
import { encodeWav } from './wav';
import { TOO_LONG_TO_DECODE, decodeFits } from './pure';

const baseName = (n: string) => n.replace(/\.[^.]+$/, '');

async function assetBuffer(a: MediaAsset): Promise<ArrayBuffer> {
  if (!a.url) throw new Error('Mídia indisponível (recarregue o projeto)');
  return (await fetch(a.url)).arrayBuffer();
}

export async function decodeAsset(a: MediaAsset): Promise<AudioBuffer> {
  if (!decodeFits(a.duration)) throw new Error(TOO_LONG_TO_DECODE); // antes do fetch/decodificação inteira (B6)
  const AC: typeof AudioContext = (globalThis as { AudioContext?: typeof AudioContext }).AudioContext
    ?? (globalThis as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new AC();
  try { return await ctx.decodeAudioData(await assetBuffer(a)); }
  catch { throw new Error('Este arquivo não tem áudio que eu consiga ler'); }
  finally { ctx.close().catch(() => {}); }
}

/** quadro do vídeo no tempo da mídia `t` → asset de imagem (PNG) */
export async function captureFrame(a: MediaAsset, t: number): Promise<MediaAsset> {
  if (!a.url) throw new Error('Mídia indisponível');
  const v = document.createElement('video');
  v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = a.url;
  await new Promise<void>((res, rej) => { v.onloadeddata = () => res(); v.onerror = () => rej(new Error('Não consegui ler o vídeo')); });
  await new Promise<void>((res) => { v.onseeked = () => res(); v.currentTime = Math.max(0, Math.min(t, (v.duration || t) - 0.05)); });
  const c = document.createElement('canvas');
  c.width = v.videoWidth; c.height = v.videoHeight;
  c.getContext('2d')!.drawImage(v, 0, 0);
  const blob = await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Falha ao capturar'))), 'image/png'));
  v.removeAttribute('src'); v.load();
  return ingestFile(new File([blob], `${baseName(a.name)}-quadro-${t.toFixed(1)}s.png`, { type: 'image/png' }), 'broll');
}

/** extrai a trilha de áudio de um vídeo como WAV */
export async function extractAudio(a: MediaAsset): Promise<MediaAsset> {
  const buf = await decodeAsset(a);
  const chans = Array.from({ length: Math.min(2, buf.numberOfChannels) }, (_, i) => buf.getChannelData(i));
  const wav = encodeWav(chans, buf.sampleRate);
  return ingestFile(new File([wav], `${baseName(a.name)} (áudio).wav`, { type: 'audio/wav' }), 'source');
}

/** detecta batidas e grava em asset.beats */
export async function analyzeBeats(a: MediaAsset): Promise<number[]> {
  const buf = await decodeAsset(a);
  const mono = toMono(Array.from({ length: buf.numberOfChannels }, (_, i) => buf.getChannelData(i)));
  const beats = detectBeats(mono, buf.sampleRate);
  useEditor.getState().updateAsset(a.id, { beats });
  return beats;
}

/* ---------- gravação de narração ---------- */

export interface Recorder { stop: () => Promise<MediaAsset>; cancel: () => void; stream: MediaStream }

export async function startRecording(): Promise<Recorder> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('Este navegador não permite gravar áudio');
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'].find((m) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m)) ?? '';
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  rec.start(250);
  const end = () => stream.getTracks().forEach((t) => t.stop());
  return {
    stream,
    cancel: () => { try { rec.stop(); } catch {} end(); },
    stop: () => new Promise<MediaAsset>((res, rej) => {
      rec.onstop = async () => {
        end();
        const type = rec.mimeType || 'audio/webm';
        const ext = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm';
        const d = new Date();
        const name = `Narração ${String(d.getHours()).padStart(2, '0')}h${String(d.getMinutes()).padStart(2, '0')}.${ext}`;
        try { res(await ingestFile(new File(chunks, name, { type }), 'source')); } catch (e) { rej(e); }
      };
      rec.stop();
    }),
  };
}
