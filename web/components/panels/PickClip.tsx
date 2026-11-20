'use client';
/* "Selecione um clipe" deixou de ser beco sem saída: um toque seleciona o clipe sob o cursor
   (ou o mais perto dele) e o painel abre já nele. */
import { useEditor } from '@/lib/store';
import type { Clip } from '@/lib/types';
import { clipForPanel } from './pickClip';

export function PickClipButton({ accept }: { accept: (c: Clip) => boolean }) {
  const project = useEditor((s) => s.project);
  const playhead = useEditor((s) => s.playhead);
  const picked = clipForPanel(project, playhead, accept);
  if (!picked) return <p className="ep-pickclip-none">Ainda não há um clipe que aceite isso na timeline.</p>;
  const pick = () => {
    const st = useEditor.getState();
    st.select([picked.clip.id]);
    // o mais perto (fora do cursor): leva o cursor até ele, p/ o preview mostrar o clipe escolhido
    if (!picked.underPlayhead) st.setPlayhead(picked.clip.start + Math.min(0.05, picked.clip.duration / 2));
  };
  return (
    <button type="button" className="ep-btn primary ep-pickclip" onClick={pick}>
      {picked.underPlayhead ? 'Selecionar o clipe no cursor' : 'Selecionar o clipe mais perto'}
    </button>
  );
}
