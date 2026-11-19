'use client';
import { create } from 'zustand';
import { SfxList } from '@/components/library';
/* Áudio: importar música, gravar narração, biblioteca, volume/voz/batidas do clipe */
import { useEffect, useRef, useState } from 'react';
import { emit } from '@/lib/events';
import { ingestFiles } from '@/lib/media/ingest';
import { placeAssetOp } from '@/lib/media/place';
import { startRecording, type Recorder } from '@/lib/media/tools';
import { useEditor } from '@/lib/store';
import { useShallow } from 'zustand/react/shallow';
import { formatTime, uid } from '@/lib/util';
import { IconMic, IconMusic, IconPlus, IconUpload } from '@/components/shell/icons';
import { VolumeSection } from './ClipSections';
import { Section, Seg } from './controls';
import { isSound } from './clipkit';
import { useSelectedClip } from './hooks';

function MusicLibrary() {
  const music = useEditor(useShallow((s) => Object.values(s.assets).filter((a) => a.kind === 'audio')));
  const dispatch = useEditor((s) => s.dispatch);
  const select = useEditor((s) => s.select);
  if (!music.length) return <p className="ep-pnote">Nenhum áudio ainda. Importe uma música ou grave uma narração.</p>;
  return (
    <div className="ep-musiclist">
      {music.map((a) => (
        <button key={a.id} type="button" className="ep-music" onClick={() => { const op = placeAssetOp(useEditor.getState().project, a, { at: 0 }); dispatch(op); if (op.op === 'add_clip') select([op.clip.id]); }}>
          <span className="ic"><IconMusic size={16} /></span>
          <span className="n">{a.name}</span>
          <span className="d mono">{formatTime(a.duration)}{a.beats?.length ? ` · ${a.beats.length}♪` : ''}</span>
          <IconPlus size={16} />
        </button>
      ))}
    </div>
  );
}

function Narration() {
  const [state, setState] = useState<'idle' | 'count' | 'rec' | 'saving'>('idle');
  const [count, setCount] = useState(3);
  const [elapsed, setElapsed] = useState(0);
  const rec = useRef<Recorder | null>(null);
  const startAt = useRef(0);
  const t0 = useRef(0);
  const timers = useRef<ReturnType<typeof setInterval>[]>([]);
  const clear = () => { timers.current.forEach(clearInterval); timers.current = []; };
  useEffect(() => () => { clear(); rec.current?.cancel(); }, []);

  const begin = async () => {
    try {
      rec.current = null;
      setState('count'); setCount(3);
      let n = 3;
      await new Promise<void>((res) => {
        const id = setInterval(() => { n -= 1; setCount(n); if (n <= 0) { clearInterval(id); res(); } }, 800);
        timers.current.push(id);
      });
      startAt.current = Math.round(useEditor.getState().playhead * 100) / 100;
      rec.current = await startRecording();
      t0.current = performance.now();
      setState('rec'); setElapsed(0);
      timers.current.push(setInterval(() => setElapsed((performance.now() - t0.current) / 1000), 200));
    } catch (e) {
      clear(); setState('idle');
      emit('ep:toast', { text: e instanceof Error && e.name === 'NotAllowedError' ? 'Permita o uso do microfone para gravar' : e instanceof Error ? e.message : 'Não consegui gravar', kind: 'error' });
    }
  };
  const stop = async () => {
    if (!rec.current) return;
    clear(); setState('saving');
    try {
      const a = await rec.current.stop();
      const st = useEditor.getState();
      const trackId = st.project.tracks.find((t) => t.kind === 'audio' && t.name.startsWith('Narração'))?.id ?? uid('track_audio');
      if (!st.project.tracks.some((t) => t.id === trackId)) st.dispatch({ op: 'add_track', track: { id: trackId, kind: 'audio', name: 'Narração' } }, { history: false });
      const id = uid('clip');
      st.dispatch({ op: 'add_clip', trackId, clip: { id, type: 'audio', assetId: a.id, start: startAt.current, duration: a.duration || elapsed, in: 0, speed: 1, volume: 1, label: a.name } });
      st.select([id]);
      emit('ep:toast', { text: 'Narração adicionada na timeline', kind: 'ok' });
    } catch (e) {
      emit('ep:toast', { text: e instanceof Error ? e.message : 'Falha ao salvar a narração', kind: 'error' });
    } finally { rec.current = null; setState('idle'); }
  };
  const cancel = () => { clear(); rec.current?.cancel(); rec.current = null; setState('idle'); };

  return (
    <Section title="Gravar narração">
      {state === 'idle' && <button type="button" className="ep-recbtn" onClick={begin}><IconMic size={20} /> Gravar a partir do playhead</button>}
      {state === 'count' && <div className="ep-reccount" aria-live="assertive">{count}</div>}
      {state === 'rec' && (
        <div className="ep-recrow">
          <span className="ep-recdot" /> <b className="mono">{formatTime(elapsed, { decimals: true })}</b>
          <button type="button" className="ep-btn primary" onClick={stop}>Parar e inserir</button>
          <button type="button" className="ep-mini" onClick={cancel}>Cancelar</button>
        </div>
      )}
      {state === 'saving' && <p className="ep-pnote"><span className="ep-spin xs" /> Salvando narração…</p>}
    </Section>
  );
}

/** aba do painel de Áudio (a barra do celular abre direto em "Efeitos sonoros") */
export const useAudioView = create<{ view: 'music' | 'sfx' }>(() => ({ view: 'music' }));
const AUDIO_VIEWS: { id: 'music' | 'sfx'; label: string }[] = [{ id: 'music', label: 'Músicas e voz' }, { id: 'sfx', label: 'Efeitos sonoros' }];

export default function AudioTab() {
  const clip = useSelectedClip()?.clip;
  const input = useRef<HTMLInputElement>(null);
  const importMusic = async (files: File[]) => {
    const done = await ingestFiles(files, 'music');
    if (done.length) emit('ep:toast', { text: `${done.length} áudio(s) importado(s)`, kind: 'ok' });
  };
  const view = useAudioView((s) => s.view);
  if (view === 'sfx') return (
    <>
      <Seg value={view} onChange={(v) => useAudioView.setState({ view: v })} options={AUDIO_VIEWS} />
      <Section title="Efeitos sonoros"><SfxList /></Section>
    </>
  );
  return (
    <>
      <Seg value={view} onChange={(v) => useAudioView.setState({ view: v })} options={AUDIO_VIEWS} />
      <div className="ep-audioacts">
        <button type="button" className="ep-btn primary ep-wide" onClick={() => input.current?.click()}><IconUpload size={16} /> Importar música</button>
        <input ref={input} type="file" hidden multiple accept="audio/*" onChange={(e) => { void importMusic(Array.from(e.target.files ?? [])); e.target.value = ''; }} />
      </div>
      <Narration />
      {isSound(clip) && <VolumeSection clip={clip} />}
      <Section title="Seus áudios"><MusicLibrary /></Section>
    </>
  );
}
