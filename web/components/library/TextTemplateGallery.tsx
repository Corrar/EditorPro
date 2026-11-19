'use client';
/* modelos de texto (títulos, subtítulo, citação, capítulo, nome na tela) */
import TemplateGallery from './TemplateGallery';

export default function TextTemplateGallery({ onInserted, query }: { onInserted?: (clipIds: string[]) => void; query?: string }) {
  return <TemplateGallery kind="texto" onInserted={onInserted} query={query} />;
}
