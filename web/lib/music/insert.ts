/* =====================================================================
   Música · inserir no projeto (navegador): gera o WAV (cache), ingere
   como asset (role 'music', `library`, com `beats`) e põe o clipe na
   trilha de música no cursor — num único dispatch (1 desfazer).
   ===================================================================== */
import type { MediaAsset, Seconds } from '../types';
import { musicTrack } from './catalog';
import { MIN_DURATION, beatMarkers } from './engine';
import { sourceSpan } from '../engine/speed';
import { beatMarkerOps, fitMusicDuration, musicClipOps, musicRefitOps, musicTrackForAsset, type MusicClipOptions } from './ops';
import { renderMusic } from './render';

export interface InsertMusicOptions extends Omit<MusicClipOptions, 'duration'> {
  /** início na timeline (padrão: cursor; 0 se a timeline estiver vazia) */
  at?: Seconds;
  /** duração (padrão: até o fim do vídeo; 30 s sem vídeo) */
  duration?: Seconds;
  /** também cria marcadores de batida (kind 'beat') — padrão: não */
  markBeats?: boolean | 'bars';
}

/** gera/ingere o asset da faixa na duração pedida (reaproveita se já existir) */
export async function prepareMusicAsset(id: string, duration: Seconds): Promise<MediaAsset> {
  const t = musicTrack(id);
  if (!t) throw new Error(`música desconhecida: ${id}`);
  const [{ useEditor }, { ingestFile }] = await Promise.all([import('../store'), import('../media/ingest')]);
  const name = `${t.name}.wav`;
  const same = Object.values(useEditor.getState().assets).find((a) => a.library && a.name === name && a.url && Math.abs(a.duration - duration) < 0.05);
  if (same) return same;
  const blob = await renderMusic(id, { duration });
  const file = new File([blob], name, { type: 'audio/wav' });
  const asset = await ingestFile(file, 'music');
  const beats = beatMarkers(id, duration);
  useEditor.getState().updateAsset(asset.id, { library: true, beats });
  return { ...asset, library: true, beats };
}

export async function insertMusic(id: string, opts: InsertMusicOptions = {}): Promise<{ asset: MediaAsset; clipId: string } | null> {
  const t = musicTrack(id);
  if (!t) return null;
  const { useEditor } = await import('../store');
  const st0 = useEditor.getState();
  const empty = st0.project.tracks.every((tr) => tr.clips.length === 0);
  const at = Math.max(0, opts.at ?? (empty ? 0 : st0.playhead));
  const duration = opts.duration ?? fitMusicDuration(st0.project, at, t.duration);
  const asset = await prepareMusicAsset(id, duration);
  const st = useEditor.getState();
  const ops = musicClipOps(st.project, asset, at, { ...opts, duration });
  if (opts.markBeats) ops.push(...beatMarkerOps(st.project, asset.beats ?? [], at, { every: opts.markBeats === 'bars' ? 4 : 1 }));
  st.dispatch(ops);
  const add = ops.find((o) => o.op === 'add_clip');
  const clipId = add && add.op === 'add_clip' ? add.clip.id : '';
  if (clipId) useEditor.getState().select([clipId]);
  return { asset, clipId };
}

/**
 * Depois de aparar/esticar a borda de um clipe de música do catálogo: gera a
 * faixa no tamanho novo (BPM ajustado para terminar no compasso, com final) e
 * troca o asset do clipe. `newDuration` padrão = duração atual do clipe.
 * Devolve false se o clipe não for música do catálogo. 1 dispatch (1 desfazer).
 *
 * O render é assíncrono: se nesse meio-tempo o clipe mudou (Desfazer, outro
 * aparo, outra mídia), o resultado velho é descartado — senão um refit atrasado
 * (sem histórico) reaplicaria um aparo desfeito ou sobrescreveria o aparo mais novo.
 */
export async function refitMusicClip(clipId: string, newDuration?: Seconds, opts: { history?: boolean } = {}): Promise<boolean> {
  const { useEditor } = await import('../store');
  const st = useEditor.getState();
  const clip = st.project.tracks.flatMap((t) => t.clips).find((c) => c.id === clipId);
  if (!clip || clip.type !== 'audio') return false;
  const track = musicTrackForAsset(st.assets[clip.assetId]);
  if (!track) return false;
  const duration = Math.round((newDuration ?? clip.duration) * 1000) / 1000;
  // quanto de música o clipe toca (velocidade/curva incluídas): é isso que precisa ser renderizado
  const span = Math.round(sourceSpan({ ...clip, duration }) * 1000) / 1000;
  // curto demais p/ o motor (mín. 2 s): renderizar cresceria o clipe por cima do vizinho — fica como está
  if (span < MIN_DURATION) return false;
  if (Math.abs(span - (st.assets[clip.assetId]?.duration ?? 0)) < 0.02 && clip.in === 0) return true;
  const asset = await prepareMusicAsset(track.id, span);
  const now = useEditor.getState();
  const cur = now.project.tracks.flatMap((t) => t.clips).find((c) => c.id === clipId);
  const same = cur && cur.type === 'audio' && cur.assetId === clip.assetId && cur.in === clip.in
    && Math.abs(cur.duration - clip.duration) < 1e-6 && cur.speed === clip.speed
    && cur.speedCurve === clip.speedCurve && cur.speedPreset === clip.speedPreset;
  if (!same) return false;
  const ops = musicRefitOps(now.project, clipId, asset, duration);
  if (!ops.length) return false;
  now.dispatch(ops, opts.history === false ? { history: false } : undefined);
  return true;
}
