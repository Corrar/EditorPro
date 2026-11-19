'use client';
import { LookGallery } from '@/components/library';
/* ferramentas Efeitos / Filtros / Ajustes: atuam no clipe selecionado ou numa camada de ajuste */
import { makeAdjustmentClip } from '@/lib/defaults';
import { targetTrackId } from '@/lib/media/place';
import { projectDuration } from '@/lib/ops';
import { useEditor } from '@/lib/store';
import { IconEffects, IconFilters, IconSliders } from '@/components/shell/icons';
import { AdjustSection, EffectsSection, FilterSection } from './ClipSections';
import { EmptyHint, Section } from './controls';
import { isFilterable, isVisual } from './clipkit';
import { useSelectedClip } from './hooks';

function AddAdjustmentLayer() {
  const dispatch = useEditor((s) => s.dispatch);
  const select = useEditor((s) => s.select);
  const add = () => {
    const st = useEditor.getState();
    const dur = Math.max(3, Math.min(10, projectDuration(st.project) - st.playhead || 5));
    const c = makeAdjustmentClip(Math.round(st.playhead * 100) / 100, dur, { label: 'Camada de ajuste' });
    dispatch({ op: 'add_clip', trackId: targetTrackId(st.project, 'effect'), clip: c, explain: 'Adicionando camada de ajuste' });
    select([c.id]);
  };
  return (
    <Section title="Camada de ajuste">
      <p className="ep-pnote">Aplica cor e efeitos a tudo que estiver abaixo dela, no trecho que ela cobre.</p>
      <button type="button" className="ep-btn sec ep-wide" onClick={add}>＋ Adicionar camada de ajuste</button>
    </Section>
  );
}

export function EffectsTool() {
  const clip = useSelectedClip()?.clip;
  return (
    <>
      {isVisual(clip) || clip?.type === 'adjustment' ? <EffectsSection clip={clip} /> : <EmptyHint icon={<IconEffects />} title="Selecione um clipe" text="Escolha um vídeo, imagem, sticker ou camada de ajuste para aplicar efeitos (glitch, VHS, tremor, neon…)." />}
      <AddAdjustmentLayer />
    </>
  );
}

export function FiltersTool() {
  const clip = useSelectedClip()?.clip;
  return (
    <>
      <Section title="Looks de cor"><LookGallery /></Section>
      {isFilterable(clip) ? <FilterSection clip={clip} /> : <EmptyHint icon={<IconFilters />} title="Filtros por clipe" text="Selecione um vídeo, imagem ou camada de ajuste para os filtros clássicos." />}
      <AddAdjustmentLayer />
    </>
  );
}

export function AdjustTool() {
  const clip = useSelectedClip()?.clip;
  return (
    <>
      {isFilterable(clip) ? <AdjustSection clip={clip} /> : <EmptyHint icon={<IconSliders />} title="Selecione um clipe" text="Exposição, contraste, realces, sombras, temperatura, nitidez, vinheta…" />}
      <AddAdjustmentLayer />
    </>
  );
}
