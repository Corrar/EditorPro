'use client';
/* sheet baixo de ajuste (celular): título central, ↺ redefinir, ✓ confirmar.
   Aplica ao vivo; ao confirmar, as mudanças viram UM passo de desfazer; ↺ desfaz tudo desde a abertura. */
import { useEffect, useRef } from 'react';
import Icon from '@/components/ui/Icon';
import { useEditor } from '@/lib/store';
import type { Clip } from '@/lib/types';
import {
  AdjustSection, AnimationSection, BackgroundSection, BlendSection, ChromaSection, CropSection, EditSection, EffectsSection,
  FilterSection, MaskSection, MotionSection, OpacitySection, SpeedSection, VolumeSection,
} from '@/components/panels/ClipSections';
import { ShapeStyleSection, StickerSection } from '@/components/panels/StickersTab';
import { TextEditor } from '@/components/panels/TextTab';

export type SheetKind = 'opacity' | 'speed' | 'volume' | 'anim' | 'effects' | 'filters' | 'adjust' | 'motion' | 'mask' | 'chroma' | 'crop' | 'bg' | 'blend' | 'edit' | 'text' | 'style';

const TITLE: Record<SheetKind, string> = {
  opacity: 'Opacidade', speed: 'Velocidade', volume: 'Áudio', anim: 'Animações', effects: 'Efeitos', filters: 'Filtros', adjust: 'Ajustes', motion: 'Transformar',
  mask: 'Máscara', chroma: 'Chroma key', crop: 'Recortar', bg: 'Remover fundo', blend: 'Composição', edit: 'Editar', text: 'Texto', style: 'Estilo',
};

export default function ToolSheet({ kind, clip, onClose }: { kind: SheetKind; clip: Clip; onClose: () => void }) {
  const start = useRef(useEditor.getState().past.length);
  useEffect(() => { start.current = useEditor.getState().past.length; }, [kind, clip.id]);

  const reset = () => {
    const st = useEditor.getState();
    while (useEditor.getState().past.length > start.current) st.undo();
    useEditor.setState({ future: [] });
  };
  const confirm = () => {
    const { past } = useEditor.getState();
    // junta tudo o que foi feito no sheet em um único passo de desfazer
    if (past.length > start.current + 1) useEditor.setState({ past: past.slice(0, start.current + 1) });
    onClose();
  };

  const v = clip.type === 'video' ? clip : null;
  const body = (() => {
    switch (kind) {
      case 'opacity': return clip.type === 'video' || clip.type === 'image' || clip.type === 'sticker' || clip.type === 'shape' ? <OpacitySection clip={clip} /> : null;
      case 'speed': return clip.type === 'video' || clip.type === 'audio' ? <SpeedSection clip={clip} /> : null;
      case 'volume': return clip.type === 'video' || clip.type === 'audio' ? <VolumeSection clip={clip} /> : null;
      case 'anim': return clip.type === 'video' || clip.type === 'image' || clip.type === 'sticker' || clip.type === 'shape' ? <AnimationSection clip={clip} /> : null;
      case 'effects': return clip.type !== 'audio' && clip.type !== 'text' ? <EffectsSection clip={clip} /> : null;
      case 'filters': return clip.type === 'video' || clip.type === 'image' || clip.type === 'adjustment' ? <FilterSection clip={clip} /> : null;
      case 'adjust': return clip.type === 'video' || clip.type === 'image' || clip.type === 'adjustment' ? <AdjustSection clip={clip} /> : null;
      case 'motion': return clip.type === 'video' || clip.type === 'image' || clip.type === 'sticker' || clip.type === 'shape' ? <MotionSection clip={clip} /> : null;
      case 'mask': return clip.type === 'video' || clip.type === 'image' || clip.type === 'shape' ? <MaskSection clip={clip} /> : null;
      case 'chroma': return clip.type === 'video' || clip.type === 'image' ? <ChromaSection clip={clip} /> : null;
      case 'crop': return clip.type === 'video' || clip.type === 'image' ? <CropSection clip={clip} /> : null;
      case 'bg': return clip.type === 'video' || clip.type === 'image' ? <BackgroundSection clip={clip} /> : null;
      case 'blend': return clip.type === 'video' || clip.type === 'image' || clip.type === 'sticker' || clip.type === 'shape' ? <BlendSection clip={clip} /> : null;
      case 'edit': return <EditSection clip={clip} />;
      case 'text': return clip.type === 'text' ? <TextEditor clip={clip} /> : null;
      case 'style': return clip.type === 'sticker' ? <StickerSection clip={clip} /> : clip.type === 'shape' ? <ShapeStyleSection clip={clip} /> : null;
      default: return null;
    }
  })();
  void v;

  return (
    <div className="ep-toolsheet" role="dialog" aria-modal="false" aria-label={TITLE[kind]}>
      <div className="ep-toolsheet-head">
        <button type="button" className="ep-circle sm" onClick={reset} aria-label="Redefinir" title="Redefinir"><Icon name="rotate" size={18} /></button>
        <span className="ep-h-sheet">{TITLE[kind]}</span>
        <button type="button" className="ep-circle sm ep-toolsheet-ok" onClick={confirm} aria-label="Confirmar" title="Confirmar"><Icon name="check" size={20} /></button>
      </div>
      <div className="ep-toolsheet-body ep-insp">{body ?? <p className="ep-pnote">Não disponível para este clipe.</p>}</div>
    </div>
  );
}
