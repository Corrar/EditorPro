import type { InspectorTool } from '@/components/panels/Inspector';
import { useColorAvailable } from '@/components/panels/ColorTool';
import {
  IconAudio, IconCanvas, IconReview, IconCaptions, IconEdit, IconEffects, IconFilters, IconMedia, IconSliders, IconColor, IconSticker, IconTemplates, IconText, IconTransitions,
} from './icons';

export type ToolId = 'media' | InspectorTool;

/** ferramentas do rail (ordem CapCut). 'edit' só aparece quando há seleção */
export const TOOLS: { id: ToolId; label: string; Icon: typeof IconMedia }[] = [
  { id: 'edit', label: 'Editar', Icon: IconEdit },
  { id: 'media', label: 'Mídia', Icon: IconMedia },
  { id: 'audio', label: 'Áudio', Icon: IconAudio },
  { id: 'text', label: 'Texto', Icon: IconText },
  { id: 'stickers', label: 'Stickers', Icon: IconSticker },
  { id: 'templates', label: 'Modelos', Icon: IconTemplates },
  { id: 'effects', label: 'Efeitos', Icon: IconEffects },
  { id: 'filters', label: 'Filtros', Icon: IconFilters },
  { id: 'transitions', label: 'Transições', Icon: IconTransitions },
  { id: 'captions', label: 'Legendas', Icon: IconCaptions },
  { id: 'adjust', label: 'Ajustes', Icon: IconSliders },
  { id: 'color', label: 'Cor', Icon: IconColor },
  { id: 'canvas', label: 'Formatos', Icon: IconCanvas },
  { id: 'review', label: 'Revisão', Icon: IconReview },
];

export const toolDef = (id: ToolId) => TOOLS.find((t) => t.id === id)!;

/** ferramentas que dependem de módulo opcional (só aparecem quando ele carrega) */
export const OPTIONAL_TOOLS = new Set<ToolId>(['color']);

/** TOOLS sem as opcionais que ainda não carregaram */
export function useVisibleTools() {
  const color = useColorAvailable();
  return TOOLS.filter((t) => t.id !== 'color' || color);
}

/** valor de data-ep-tool (contrato do cursor da IA, lib/aiCursor.ts): 'canvas' é 'formats' lá */
export const toolAttr = (id: string) => (id === 'canvas' ? 'formats' : id);
