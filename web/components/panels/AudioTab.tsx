'use client';
import { useEditor } from '@/lib/store';
import type { AudioClip, VideoClip } from '@/lib/types';
import { placeAssetOp } from '@/lib/media/place';
import { formatTime } from '@/lib/util';
import { IconAudio, IconMusic, IconPlus } from '@/components/shell/icons';
import { EmptyHint, Section, Slider, Toggle } from './controls';
import { pct, secs, useClipPatch, useSelectedClip } from './hooks';

function MusicLibrary() {
  const assets = useEditor((s) => s.assets);
  const dispatch = useEditor((s) => s.dispatch);
  const select = useEditor((s) => s.select);
  const music = Object.values(assets).filter((a) => a.kind === 'audio');
  if (!music.length) return <p className="ep-pnote">Importe uma música na aba Mídia (MP3, WAV, M4A…) para usá-la aqui.</p>;
  return (
    <div className="ep-musiclist">
      {music.map((a) => (
        <button
          key={a.id} type="button" className="ep-music"
          onClick={() => {
            const op = placeAssetOp(useEditor.getState().project, a, { at: 0 });
            dispatch(op);
            if (op.op === 'add_clip') select([op.clip.id]);
          }}
        >
          <span className="ic"><IconMusic size={16} /></span>
          <span className="n">{a.name}</span>
          <span className="d mono">{formatTime(a.duration)}</span>
          <IconPlus size={16} />
        </button>
      ))}
    </div>
  );
}

export default function AudioTab() {
  const found = useSelectedClip();
  const dispatch = useEditor((s) => s.dispatch);
  const clip = found && (found.clip.type === 'audio' || found.clip.type === 'video') ? (found.clip as AudioClip | VideoClip) : null;
  const patch = useClipPatch(clip?.id);

  return (
    <>
      {!clip || !found ? (
        <EmptyHint icon={<IconAudio />} title="Selecione um clipe com som" text="Clique em um vídeo ou música na timeline para ajustar volume, fades e ducking." />
      ) : (
        <>
          <Section title={clip.type === 'audio' ? 'Música / áudio' : 'Som do vídeo'}>
            <Slider label="Volume" value={clip.type === 'video' && clip.muted ? 0 : clip.volume} min={0} max={2} onChange={(v, h) => patch(clip.type === 'video' ? { volume: v, muted: false } : { volume: v }, h)} format={pct} reset={1} />
            <Slider label="Fade de entrada" value={clip.fadeIn ?? 0} min={0} max={Math.min(5, clip.duration / 2)} step={0.05} onChange={(v, h) => patch({ fadeIn: v }, h)} format={secs} reset={0} />
            <Slider label="Fade de saída" value={clip.fadeOut ?? 0} min={0} max={Math.min(5, clip.duration / 2)} step={0.05} onChange={(v, h) => patch({ fadeOut: v }, h)} format={secs} reset={0} />
            {clip.type === 'video' ? (
              <Toggle label="Mudo" checked={!!clip.muted} onChange={(v) => patch({ muted: v })} />
            ) : (
              <>
                <Toggle
                  label="Abaixar quando houver fala" hint="Ducking automático sob a voz"
                  checked={!!clip.duckUnderVoice} onChange={(v) => patch({ duckUnderVoice: v })}
                />
                <Toggle
                  label="Silenciar trilha" hint={found.track.name}
                  checked={!!found.track.muted} onChange={(v) => dispatch({ op: 'update_track', trackId: found.track.id, patch: { muted: v } })}
                />
              </>
            )}
          </Section>
        </>
      )}
      <Section title="Músicas da biblioteca">
        <MusicLibrary />
      </Section>
    </>
  );
}
