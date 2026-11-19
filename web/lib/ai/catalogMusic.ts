/* =====================================================================
   Pedido de música SEM arquivo do usuário → faixa do catálogo gerado por
   código (lib/music, sem direitos autorais). Usado na 1ª edição e no chat,
   nos dois modos (Claude e demo).
   ===================================================================== */
import type { MediaAsset, Project } from '../types';
import type { EditOp } from '../ops';

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** o texto pede música? ("com música animada", "trilha épica"…; "sem música" não) */
export function asksForMusic(text: string): boolean {
  const t = fold(text);
  return /musica|trilha|som de fundo|musiquinha|\bbgm\b/.test(t) && !/sem (musica|trilha)/.test(t);
}

/** no chat: pedido direto para pôr/trocar música ("coloca uma música calma", "troca a música") */
export function chatMusicRequest(text: string): 'add' | 'swap' | null {
  const t = fold(text);
  if (!asksForMusic(t)) return null;
  if (/(troc|mud|outra|substitu)\w*.{0,25}(musica|trilha)|(musica|trilha).{0,20}(outra|diferente)/.test(t)) return 'swap';
  if (/(coloc|adicion|poe|ponha|bota|insir|insere|quero|inclu|acrescent|met[ea]|usa|use)\w*.{0,40}(musica|trilha|som de fundo|musiquinha)/.test(t)) return 'add';
  return null;
}

/** música enviada pelo usuário (não é da biblioteca/catálogo) */
export function userMusic(assets: Record<string, MediaAsset>): MediaAsset[] {
  return Object.values(assets).filter((a) => a.role === 'music' && !a.library && (a.kind === 'audio' || a.kind === 'video'));
}

/** clipes de música de fundo já na timeline (≥4 s; efeitos sonoros da biblioteca são curtos) */
export function backgroundMusicClips(p: Project, assets: Record<string, MediaAsset>) {
  return p.tracks.flatMap((t) => (t.kind === 'audio' ? t.clips : [])).filter((c) => c.type === 'audio' && assets[c.assetId]?.role === 'music' && c.duration >= 4);
}

/** a 1ª edição deve buscar música no catálogo? (pediu música, não mandou arquivo e ainda não há trilha) */
export function needsCatalogMusic(brief: string, p: Project, assets: Record<string, MediaAsset>): boolean {
  return asksForMusic(brief) && !userMusic(assets).length && !backgroundMusicClips(p, assets).length;
}

/** volume da trilha: baixa quando há fala (legendas), cheia quando o vídeo é só imagem/ambiente */
export function catalogMusicVolume(p: Project): number {
  return p.captions.segments.length ? 0.3 : 0.75;
}

/**
 * Navegador: escolhe a faixa pelo texto, gera o WAV (worker + cache), ingere e
 * devolve as ops do clipe (sobre `p`). Falhou (sem WebAudio etc.) → null.
 */
export async function catalogMusicOps(
  text: string,
  p: Project,
  opts: { exclude?: string[]; onStatus?: (s: string) => void } = {},
): Promise<{ ops: EditOp[]; name: string; id: string } | null> {
  try {
    const m = await import('../music');
    const duration = m.fitMusicDuration(p, 0);
    const id = m.pickMusic({ mood: text, duration, exclude: opts.exclude });
    const track = m.musicTrack(id);
    opts.onStatus?.(`Gerando a música “${track?.name ?? id}”…`);
    const asset = await m.prepareMusicAsset(id, duration);
    const ops = m.musicClipOps(p, asset, 0, { volume: catalogMusicVolume(p), fadeIn: 0.2, duck: true });
    return { ops: ops.map((o) => (o.op === 'add_clip' ? { ...o, explain: `Música do catálogo: “${track?.name ?? id}” (${track ? `${track.bpm} BPM` : ''})` } : o)), name: track?.name ?? id, id };
  } catch {
    return null;
  }
}

/** id do catálogo de um asset de música (pelo nome do arquivo gerado) */
export async function catalogIdOf(asset: MediaAsset | undefined): Promise<string | undefined> {
  if (!asset?.library) return undefined;
  const { MUSIC_CATALOG } = await import('../music');
  const base = asset.name.replace(/\.wav$/i, '');
  return MUSIC_CATALOG.find((t) => t.name === base)?.id;
}
