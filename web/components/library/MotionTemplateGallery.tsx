'use client';
/* motion graphics (lower thirds, CTAs, contador, preço, lista, progresso, antes/depois, marca d'água) */
import TemplateGallery from './TemplateGallery';

export default function MotionTemplateGallery({ onInserted }: { onInserted?: (clipIds: string[]) => void }) {
  return <TemplateGallery kind="motion" onInserted={onInserted} />;
}
