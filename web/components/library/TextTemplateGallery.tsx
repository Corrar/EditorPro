'use client';
/* modelos de texto (títulos, subtítulo, citação, capítulo, nome na tela) */
import TemplateGallery from './TemplateGallery';

export default function TextTemplateGallery({ onInserted }: { onInserted?: (clipIds: string[]) => void }) {
  return <TemplateGallery kind="texto" onInserted={onInserted} />;
}
