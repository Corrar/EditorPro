import type { InspectorTool } from '@/components/panels/Inspector';
import {
  IconAudio, IconCanvas, IconReview, IconCaptions, IconEdit, IconEffects, IconFilters, IconMedia, IconSliders, IconSticker, IconText, IconTransitions,
} from './icons';

export type ToolId = 'media' | InspectorTool;

/** ferramentas do rail (ordem CapCut). 'edit' só aparece quando há seleção */
export const TOOLS: { id: ToolId; label: string; Icon: typeof IconMedia }[] = [
  { id: 'edit', label: 'Editar', Icon: IconEdit },
  { id: 'media', label: 'Mídia', Icon: IconMedia },
  { id: 'audio', label: 'Áudio', Icon: IconAudio },
  { id: 'text', label: 'Texto', Icon: IconText },
  { id: 'stickers', label: 'Stickers', Icon: IconSticker },
  { id: 'effects', label: 'Efeitos', Icon: IconEffects },
  { id: 'filters', label: 'Filtros', Icon: IconFilters },
  { id: 'transitions', label: 'Transições', Icon: IconTransitions },
  { id: 'captions', label: 'Legendas', Icon: IconCaptions },
  { id: 'adjust', label: 'Ajustes', Icon: IconSliders },
  { id: 'canvas', label: 'Formatos', Icon: IconCanvas },
  { id: 'review', label: 'Revisão', Icon: IconReview },
];

export const toolDef = (id: ToolId) => TOOLS.find((t) => t.id === id)!;
