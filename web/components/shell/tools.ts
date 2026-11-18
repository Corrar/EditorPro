import type { InspectorTool } from '@/components/panels/Inspector';
import { IconAudio, IconCaptions, IconEffects, IconMedia, IconText, IconTransitions } from './icons';

export type ToolId = 'media' | InspectorTool;

export const TOOLS: { id: ToolId; label: string; Icon: typeof IconMedia }[] = [
  { id: 'media', label: 'Mídia', Icon: IconMedia },
  { id: 'text', label: 'Texto', Icon: IconText },
  { id: 'captions', label: 'Legendas', Icon: IconCaptions },
  { id: 'effects', label: 'Efeitos', Icon: IconEffects },
  { id: 'transitions', label: 'Transições', Icon: IconTransitions },
  { id: 'audio', label: 'Áudio', Icon: IconAudio },
];
