/* =====================================================================
   Música · inserir no projeto (navegador): gera o WAV (cache), ingere
   como asset (role 'music', `library`, com `beats`) e põe o clipe na
   trilha de música no cursor — num único dispatch (1 desfazer).
   ===================================================================== */
import type { MediaAsset, Seconds } from '../types';
import { musicTrack } from './catalog';
import { beatMarkers } from './engine';
import { beatMarkerOps, fitMusicDuration, musicClipOps, type MusicClipOptions } from './ops';
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
