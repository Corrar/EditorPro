'use client';
/* motion graphics (lower thirds, CTAs, contador, preço, lista, progresso, antes/depois, marca d'água) */
import TemplateGallery from './TemplateGallery';

export default function MotionTemplateGallery({ onInserted, query }: { onInserted?: (clipIds: string[]) => void; query?: string }) {
  return <TemplateGallery kind="motion" onInserted={onInserted} query={query} />;
}
