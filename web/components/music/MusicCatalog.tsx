'use client';
/* =====================================================================
   MusicCatalog — catálogo de trilhas geradas por código (sessão "musica").
   Filtros por gênero/humor, busca, prévia de ~10 s (render num Web Worker,
   sem travar a UI), favoritos/recentes e "Usar" com 1 toque (entra na
   trilha de música no cursor, ajustada ao fim do vídeo; toast c/ Desfazer).
   ===================================================================== */
import '@/styles/music.css';
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import Icon from '@/components/ui/Icon';
import { emit } from '@/lib/events';
import { useEditor } from '@/lib/store';
import { MUSIC_CATALOG, MOOD_LABELS, ENERGY_LABELS, keyLabel, type Mood, type MusicTrack } from '@/lib/music/catalog';
import { GENRE_LABELS, type Genre } from '@/lib/music/styles';
import { matchesMusic } from '@/lib/music/pick';
import { fitMusicDuration, visualEnd } from '@/lib/music/ops';
import { renderPreview } from '@/lib/music/render';
import { insertMusic } from '@/lib/music/insert';
import { useMusicPrefs } from '@/lib/music/prefs';

const PREVIEW_SECONDS = 10;
const FAV = '__fav__';
const REC = '__rec__';
type DurMode = 'fit' | 30 | 60;

/** WAV mudo minúsculo: "destrava" o <audio> no iOS ainda dentro do toque */
const SILENT = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

function EnergyBars({ e }: { e: MusicTrack['energy'] }) {
  const n = e === 'baixa' ? 1 : e === 'media' ? 2 : 3;
  return (
    <span className="ep-mus-energy" role="img" aria-label={`Energia ${ENERGY_LABELS[e].toLowerCase()}`}>
      {[0, 1, 2].map((i) => <i key={i} className={i < n ? 'on' : ''} />)}
    </span>
  );
}

export default function MusicCatalog({ query: extQuery, onInserted }: { query?: string; onInserted?: (assetId: string) => void }) {
  const prefs = useMusicPrefs();
  useEffect(() => { useMusicPrefs.getState().hydrate(); }, []);
  const [genre, setGenre] = useState<string>('todos');
  const [mood, setMood] = useState<Mood | null>(null);
  const [q, setQ] = useState('');
  const query = `${extQuery ?? ''} ${q}`.trim();

  const project = useEditor((s) => s.project);
  const playhead = useEditor((s) => s.playhead);
  const hasVideo = visualEnd(project) > 1;
  const [dur, setDur] = useState<DurMode>('fit');
  const empty = project.tracks.every((t) => t.clips.length === 0);
  const at = empty ? 0 : playhead;
  const fitSec = fitMusicDuration(project, at, 30);
  const mode: DurMode = dur === 'fit' && !hasVideo ? 30 : dur;

  /* ---------- prévia ---------- */
  const [playing, setPlaying] = useState<string | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);
  const tokenRef = useRef(0);
  const rafRef = useRef(0);
  const listRef = useRef<HTMLUListElement>(null);

  const stop = () => {
    tokenRef.current++;
    cancelAnimationFrame(rafRef.current);
    const a = audioRef.current;
    if (a) { a.pause(); a.removeAttribute('src'); a.load(); }
    audioRef.current = null;
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = null;
    listRef.current?.querySelectorAll<HTMLElement>('[data-progress]').forEach((el) => el.style.setProperty('--p', '0'));
    setPlaying(null);
    setLoading(null);
  };
  useEffect(() => () => stop(), []); // eslint-disable-line react-hooks/exhaustive-deps

  const play = async (id: string) => {
    if (playing === id || loading === id) { stop(); return; }
    stop();
    const token = tokenRef.current;
    // cria e "destrava" o elemento ainda dentro do gesto (Safari/iOS)
    const audio = new Audio();
    audio.src = SILENT;
    audio.play().catch(() => {});
    audioRef.current = audio;
    setLoading(id);
    try {
      const blob = await renderPreview(id);
      if (token !== tokenRef.current) return;
      const url = URL.createObjectURL(blob);
      urlRef.current = url;
      audio.src = url;
      audio.loop = true; // a prévia é um loop sem emenda
      audio.volume = 1;
      await audio.play();
      if (token !== tokenRef.current) return;
      setLoading(null);
      setPlaying(id);
      const el = listRef.current?.querySelector<HTMLElement>(`[data-progress="${id}"]`);
      const t0 = performance.now();
      const tick = () => {
        if (token !== tokenRef.current) return;
        const e = (performance.now() - t0) / 1000;
        el?.style.setProperty('--p', String(Math.min(1, e / PREVIEW_SECONDS)));
        // fade de saída nos últimos 0,8 s
        if (e > PREVIEW_SECONDS - 0.8) audio.volume = Math.max(0, (PREVIEW_SECONDS - e) / 0.8);
        if (e >= PREVIEW_SECONDS) { stop(); return; }
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch (e) {
      if (token !== tokenRef.current) return;
      stop();
      emit('ep:toast', { text: e instanceof Error && e.name === 'NotAllowedError' ? 'Toque de novo para ouvir a prévia' : 'Não consegui tocar a prévia', kind: 'error' });
    }
  };

  /* ---------- usar ---------- */
  const use = async (t: MusicTrack) => {
    if (busy) return;
    stop();
    setBusy(t.id);
    prefs.pushRecent(t.id);
    try {
      const r = await insertMusic(t.id, { duration: mode === 'fit' ? undefined : mode });
      if (r) {
        emit('ep:toast', { text: `Música adicionada · ${t.name}`, kind: 'ok', action: { label: 'Desfazer', run: () => useEditor.getState().undo() } });
        onInserted?.(r.asset.id);
      }
    } catch (e) {
      emit('ep:toast', { text: e instanceof Error ? e.message : 'Não consegui adicionar a música', kind: 'error' });
    } finally {
      setBusy(null);
    }
  };

  /* ---------- filtros ---------- */
  const genres = useMemo(() => Object.keys(GENRE_LABELS) as Genre[], []);
  const moods = useMemo(() => {
    const set = new Set<Mood>();
    for (const t of MUSIC_CATALOG) if (genre === 'todos' || genre === FAV || genre === REC || t.genre === genre) set.add(t.mood);
    return [...set];
  }, [genre]);
  const list = useMemo(() => {
    let base: MusicTrack[];
    if (genre === FAV) base = prefs.favorites.map((id) => MUSIC_CATALOG.find((t) => t.id === id)).filter((t): t is MusicTrack => !!t);
    else if (genre === REC) base = prefs.recents.map((id) => MUSIC_CATALOG.find((t) => t.id === id)).filter((t): t is MusicTrack => !!t);
    else base = MUSIC_CATALOG.filter((t) => genre === 'todos' || t.genre === genre);
    return base.filter((t) => (!mood || t.mood === mood || t.moods?.includes(mood)) && matchesMusic(t, query));
  }, [genre, mood, query, prefs.favorites, prefs.recents]);

  const pills: { id: string; label: string }[] = [
    { id: 'todos', label: 'Todas' },
    ...(prefs.favorites.length ? [{ id: FAV, label: `★ Favoritas (${prefs.favorites.length})` }] : []),
    ...(prefs.recents.length ? [{ id: REC, label: 'Recentes' }] : []),
    ...genres.map((g) => ({ id: g, label: GENRE_LABELS[g] })),
  ];

  return (
    <section className="ep-mus" aria-label="Catálogo de músicas">
      <label className="ep-searchpill ep-mus-search">
        <Icon name="search" size={18} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar música, gênero ou clima" aria-label="Buscar música" />
        {q && <button type="button" className="ep-mus-clear" onClick={() => setQ('')} aria-label="Limpar busca"><Icon name="close" size={16} /></button>}
      </label>

      <div className="ep-mus-dur" role="radiogroup" aria-label="Duração da música">
        {hasVideo && (
          <button type="button" role="radio" aria-checked={mode === 'fit'} className={mode === 'fit' ? 'on' : ''} onClick={() => setDur('fit')}>
            Até o fim do vídeo <span className="mono">{fmt(fitSec)}</span>
          </button>
        )}
        {([30, 60] as const).map((d) => (
          <button key={d} type="button" role="radio" aria-checked={mode === d} className={mode === d ? 'on' : ''} onClick={() => setDur(d)}>{d} s</button>
        ))}
      </div>

      <div className="ep-mus-pills" role="tablist" aria-label="Gêneros">
        {pills.map((p) => (
          <button key={p.id} type="button" role="tab" aria-selected={genre === p.id} className={`ep-mus-pill${genre === p.id ? ' on' : ''}`}
            onClick={() => { setGenre(p.id); setMood(null); }}>{p.label}</button>
        ))}
      </div>
      {moods.length > 1 && (
        <div className="ep-mus-moods" aria-label="Humor">
          {moods.map((m) => (
            <button key={m} type="button" aria-pressed={mood === m} className={`ep-mus-mood${mood === m ? ' on' : ''}`} onClick={() => setMood(mood === m ? null : m)}>
              {MOOD_LABELS[m]}
            </button>
          ))}
        </div>
      )}

      {!list.length && (
        <div className="ep-mus-empty">
          {genre === FAV ? 'Toque na ☆ de uma música para guardar aqui.' : `Nenhuma música encontrada${query ? ` para “${query}”` : ''}.`}
        </div>
      )}

      <ul className="ep-mus-list" ref={listRef}>
        {list.map((t) => {
          const isPlay = playing === t.id, isLoad = loading === t.id, isBusy = busy === t.id;
          const fav = prefs.favorites.includes(t.id);
          return (
            <li key={t.id} className={`ep-mus-card${isPlay ? ' playing' : ''}`} data-genre={t.genre}>
              <button type="button" className="ep-mus-cover" data-progress={t.id} style={{ '--p': 0 } as CSSProperties}
                onClick={() => play(t.id)} aria-label={isPlay || isLoad ? `Parar prévia de ${t.name}` : `Ouvir prévia de ${t.name}`} aria-pressed={isPlay}>
                {isLoad ? <span className="ep-mus-spin" aria-hidden /> : <Icon name={isPlay ? 'pause' : 'play'} size={20} />}
              </button>
              <div className="ep-mus-info">
                <span className="ep-mus-name">{t.name}</span>
                <span className="ep-mus-meta">{GENRE_LABELS[t.genre]} · {MOOD_LABELS[t.mood]}</span>
                <span className="ep-mus-tech">
                  <EnergyBars e={t.energy} />
                  <span className="mono">{t.bpm} BPM</span>
                  <span className="ep-mus-key">{keyLabel(t)}</span>
                </span>
              </div>
              <button type="button" className={`ep-mus-fav${fav ? ' on' : ''}`} aria-pressed={fav}
                aria-label={fav ? `Remover ${t.name} das favoritas` : `Favoritar ${t.name}`} onClick={() => prefs.toggleFav(t.id)}>
                <span aria-hidden>{fav ? '★' : '☆'}</span>
              </button>
              <button type="button" className="ep-mus-use" onClick={() => use(t)} disabled={!!busy} aria-label={`Usar ${t.name}`}>
                {isBusy ? <span className="ep-mus-spin sm" aria-hidden /> : <Icon name="add" size={18} />}
                <span>Usar</span>
              </button>
            </li>
          );
        })}
      </ul>
      <p className="ep-mus-note">Músicas geradas no seu navegador — livres de direitos autorais para usar em qualquer vídeo.</p>
    </section>
  );
}
