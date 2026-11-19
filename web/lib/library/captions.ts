/* =====================================================================
   Biblioteca · estilos de legenda "de creator" (dono: sessão "biblioteca").
   Cada preset é um Partial<CaptionStyle> que usa os campos novos do contrato
   (wordBox, activeScale, inactiveOpacity, autoEmoji, lines, jitter, glow,
   shadow*, backgroundPadding). O engine desenha; aqui só descrevemos.
   Nomes descritivos em PT-BR (sem marcas/pessoas).
   ===================================================================== */
import type { CaptionStyle, TextAnimation } from '../types';
import type { EditOp } from '../ops';

export type CaptionCategory = 'creator' | 'destaque' | 'classico' | 'estilizado';

export const CAPTION_CATEGORY_LABELS: Record<CaptionCategory, string> = {
  creator: 'Creator', destaque: 'Destaque', classico: 'Clássico', estilizado: 'Estilizado',
};

/** presets nativos do engine (usados como "aparência base" enquanto o engine não lê todos os campos novos) */
export type CaptionBasePreset = 'classic' | 'bold-pop' | 'karaoke' | 'minimal' | 'boxed' | 'neon';

export interface CaptionPresetDef {
  id: string;
  name: string;
  category: CaptionCategory;
  /** aparência nativa mais próxima (fallback do engine p/ destaque/caixa/brilho) */
  base: CaptionBasePreset;
  style: Partial<CaptionStyle>;
  /** frase de exemplo da miniatura */
  sample: string;
  /** o preset define a posição (letterbox, faixa de notícia); senão mantém a do usuário */
  ownsPosition?: boolean;
  description?: string;
}

const Y = 0.72; // posição padrão (terço inferior, acima da UI das redes)

export const CAPTION_PRESETS: CaptionPresetDef[] = [
  {
    id: 'impacto-amarelo', name: 'Impacto amarelo', category: 'creator', base: 'bold-pop', sample: 'ISSO MUDA TUDO',
    description: 'Fonte grossa em maiúsculas, contorno preto e palavra ativa amarela crescendo.',
    style: { fontFamily: 'Anton', fontWeight: 400, fontSize: 92, color: '#FFFFFF', highlightColor: '#FFE14D', strokeColor: '#000000', strokeWidth: 9,
      uppercase: true, shadow: true, shadowColor: 'rgba(0,0,0,.65)', shadowBlur: 0, shadowOffset: { x: 0, y: 6 }, activeScale: 1.18, maxWords: 2, animation: 'pop', lines: 1 },
  },
  {
    id: 'caixa-por-palavra', name: 'Caixa por palavra', category: 'creator', base: 'boxed', sample: 'olha esse truque',
    description: 'A palavra falada ganha uma caixa colorida arredondada atrás.',
    style: { fontFamily: 'Montserrat', fontWeight: 900, fontSize: 80, color: '#FFFFFF', highlightColor: '#FFFFFF', strokeWidth: 0, uppercase: true,
      wordBox: { color: '#F2681F', radius: 18, padding: 14 }, activeScale: 1.06, maxWords: 3, animation: 'pop', shadow: true, shadowColor: 'rgba(0,0,0,.45)', shadowBlur: 12, lines: 1 },
  },
  {
    id: 'karaoke-acendendo', name: 'Karaokê acendendo', category: 'creator', base: 'karaoke', sample: 'cada palavra acende',
    description: 'Frase inteira apagada; as palavras acendem conforme são faladas.',
    style: { fontFamily: 'Poppins', fontWeight: 800, fontSize: 74, color: '#FFFFFF', highlightColor: '#FFFFFF', strokeColor: '#000000', strokeWidth: 4,
      inactiveOpacity: 0.38, activeScale: 1.04, maxWords: 5, lines: 2, animation: 'fade', shadow: true },
  },
  {
    id: 'neon-vibrante', name: 'Neon', category: 'estilizado', base: 'neon', sample: 'noite neon',
    description: 'Letras claras com brilho colorido intenso.',
    style: { fontFamily: 'Righteous', fontWeight: 400, fontSize: 82, color: '#F4FDFF', highlightColor: '#3DF5FF', strokeWidth: 0, uppercase: true,
      glow: { color: '#19D3FF', blur: 34 }, activeScale: 1.08, maxWords: 3, animation: 'flicker', shadow: false },
  },
  {
    id: 'minimal-branco', name: 'Minimal branco', category: 'classico', base: 'minimal', sample: 'simples e limpo',
    description: 'Branco, peso médio e sombra suave. Combina com tudo.',
    style: { fontFamily: 'Inter', fontWeight: 600, fontSize: 62, color: '#FFFFFF', highlightColor: '#FFFFFF', strokeWidth: 0, uppercase: false,
      shadow: true, shadowColor: 'rgba(0,0,0,.55)', shadowBlur: 18, shadowOffset: { x: 0, y: 3 }, maxWords: 6, lines: 2, animation: 'fade', activeScale: 1 },
  },
  {
    id: 'classico-tv', name: 'Clássico TV', category: 'classico', base: 'boxed', sample: 'legenda de televisão',
    description: 'Faixa preta translúcida por linha, como em transmissões.',
    style: { fontFamily: 'Inter', fontWeight: 600, fontSize: 56, color: '#FFFFFF', highlightColor: '#FFFFFF', strokeWidth: 0, uppercase: false,
      background: 'rgba(0,0,0,0.72)', backgroundRadius: 6, backgroundPadding: 12, shadow: false, maxWords: 8, lines: 2, animation: 'none', activeScale: 1 },
  },
  {
    id: 'gradiente', name: 'Gradiente', category: 'estilizado', base: 'bold-pop', sample: 'cores que brilham',
    description: 'Preenchimento em degradê quente com contorno escuro.',
    style: { fontFamily: 'Poppins', fontWeight: 900, fontSize: 84, color: '#FFFFFF', highlightColor: '#FFFFFF', gradient: { from: '#FFD23F', to: '#FF4F7B', angle: 90 },
      strokeColor: '#1A0F1F', strokeWidth: 6, uppercase: true, activeScale: 1.1, maxWords: 2, animation: 'pop', shadow: true },
  },
  {
    id: 'contorno-grosso', name: 'Contorno grosso', category: 'creator', base: 'bold-pop', sample: 'contorno pesado',
    description: 'Contorno preto bem grosso e palavra ativa verde-limão.',
    style: { fontFamily: 'Archivo Black', fontWeight: 400, fontSize: 84, color: '#FFFFFF', highlightColor: '#B6FF3B', strokeColor: '#000000', strokeWidth: 14,
      uppercase: true, activeScale: 1.12, maxWords: 2, animation: 'stomp', shadow: false },
  },
  {
    id: 'sombra-longa', name: 'Sombra longa', category: 'estilizado', base: 'classic', sample: 'sombra dura',
    description: 'Sombra deslocada sem desfoque (estilo pôster).',
    style: { fontFamily: 'League Spartan', fontWeight: 900, fontSize: 86, color: '#FFFFFF', highlightColor: '#FFD23F', strokeWidth: 0, uppercase: true,
      shadow: true, shadowColor: '#F2681F', shadowBlur: 0, shadowOffset: { x: 8, y: 8 }, activeScale: 1.08, maxWords: 2, animation: 'slide-up' },
  },
  {
    id: 'duas-cores', name: 'Duas cores', category: 'destaque', base: 'bold-pop', sample: 'metade de cada cor',
    description: 'Branco com a palavra ativa em ciano crescendo; entra palavra a palavra.',
    style: { fontFamily: 'Montserrat', fontWeight: 900, fontSize: 80, color: '#FFFFFF', highlightColor: '#4DE1FF', strokeColor: '#000000', strokeWidth: 7,
      uppercase: true, activeScale: 1.15, maxWords: 3, animation: 'word-pop', shadow: true },
  },
  {
    id: 'marca-texto', name: 'Destaque marca-texto', category: 'destaque', base: 'boxed', sample: 'grife o importante',
    description: 'A palavra ativa recebe um traço de marca-texto amarelo.',
    style: { fontFamily: 'DM Sans', fontWeight: 700, fontSize: 70, color: '#141414', highlightColor: '#141414', strokeWidth: 0, uppercase: false,
      background: 'rgba(255,255,255,0.94)', backgroundRadius: 14, backgroundPadding: 14,
      wordBox: { color: '#FFE14D', radius: 6, padding: 6 }, activeScale: 1, maxWords: 4, lines: 2, animation: 'highlight-sweep', shadow: false },
  },
  {
    id: 'pop-emoji', name: 'Pop com emoji', category: 'creator', base: 'bold-pop', sample: 'dinheiro rápido 💰',
    description: 'Estilo vibrante com emoji automático nas palavras-chave.',
    style: { fontFamily: 'Poppins', fontWeight: 900, fontSize: 82, color: '#FFFFFF', highlightColor: '#FFD23F', strokeColor: '#000000', strokeWidth: 8,
      uppercase: true, autoEmoji: true, activeScale: 1.16, maxWords: 2, animation: 'word-bounce', jitter: 3, shadow: true },
  },
  {
    id: 'maquina-escrever', name: 'Máquina de escrever', category: 'estilizado', base: 'classic', sample: 'digitando agora...',
    description: 'Letras surgem uma a uma em fonte mono.',
    style: { fontFamily: 'Space Mono', fontWeight: 700, fontSize: 58, color: '#FFFFFF', highlightColor: '#FFFFFF', strokeWidth: 0, uppercase: false,
      background: 'rgba(10,10,10,0.78)', backgroundRadius: 4, backgroundPadding: 12, maxWords: 6, lines: 2, animation: 'char-typewriter', shadow: false, activeScale: 1 },
  },
  {
    id: 'serifada-elegante', name: 'Serifada elegante', category: 'classico', base: 'minimal', sample: 'uma história bonita',
    description: 'Serifa itálica, discreta e sofisticada.',
    style: { fontFamily: 'Playfair Display', fontWeight: 600, fontSize: 66, color: '#FFF8EE', highlightColor: '#F5C77E', strokeWidth: 0, italic: true, uppercase: false,
      shadow: true, shadowColor: 'rgba(0,0,0,.5)', shadowBlur: 16, maxWords: 5, lines: 2, animation: 'blur-in', activeScale: 1 },
  },
  {
    id: 'manuscrita', name: 'Manuscrita', category: 'estilizado', base: 'classic', sample: 'anotado à mão',
    description: 'Letra de caneta, leve e pessoal.',
    style: { fontFamily: 'Caveat', fontWeight: 700, fontSize: 92, color: '#FFFFFF', highlightColor: '#FFE14D', strokeColor: 'rgba(0,0,0,.55)', strokeWidth: 3, uppercase: false,
      shadow: true, maxWords: 4, lines: 2, animation: 'word-fade', jitter: 2, activeScale: 1.04 },
  },
  {
    id: 'retro-80s', name: 'Retrô 80s', category: 'estilizado', base: 'neon', sample: 'de volta aos 80',
    description: 'Degradê rosa/roxo, contorno e brilho magenta.',
    style: { fontFamily: 'Righteous', fontWeight: 400, fontSize: 84, color: '#FFFFFF', highlightColor: '#FFFFFF', gradient: { from: '#FF5FD2', to: '#7B5CFF', angle: 180 },
      strokeColor: '#1B0B3A', strokeWidth: 5, glow: { color: '#FF3FD0', blur: 22 }, uppercase: true, maxWords: 3, animation: 'char-wave', activeScale: 1.06 },
  },
  {
    id: 'noticia-faixa', name: 'Notícia (faixa)', category: 'classico', base: 'boxed', sample: 'urgente: novidade', ownsPosition: true,
    description: 'Faixa vermelha na base com texto branco condensado.',
    style: { fontFamily: 'Oswald', fontWeight: 700, fontSize: 62, color: '#FFFFFF', highlightColor: '#FFE14D', strokeWidth: 0, uppercase: true,
      background: '#D7263D', backgroundRadius: 0, backgroundPadding: 16, position: { x: 0.5, y: 0.86 }, maxWords: 6, lines: 1, animation: 'slide-left', shadow: false, activeScale: 1 },
  },
  {
    id: 'podcast', name: 'Podcast', category: 'destaque', base: 'karaoke', sample: 'no episódio de hoje',
    description: 'Duas linhas, palavras acendendo e destaque laranja.',
    style: { fontFamily: 'Plus Jakarta Sans', fontWeight: 800, fontSize: 66, color: '#FFFFFF', highlightColor: '#FF8A3D', strokeWidth: 0, uppercase: false,
      inactiveOpacity: 0.5, shadow: true, shadowColor: 'rgba(0,0,0,.6)', shadowBlur: 14, maxWords: 6, lines: 2, animation: 'fade', activeScale: 1.03 },
  },
  {
    id: 'tutorial', name: 'Tutorial', category: 'destaque', base: 'boxed', sample: 'passo um: clique aqui',
    description: 'Caixa clara arredondada, texto escuro e palavra ativa azul.',
    style: { fontFamily: 'Rubik', fontWeight: 700, fontSize: 64, color: '#16181D', highlightColor: '#2F6BFF', strokeWidth: 0, uppercase: false,
      background: 'rgba(255,255,255,0.95)', backgroundRadius: 22, backgroundPadding: 16, maxWords: 5, lines: 2, animation: 'pop', shadow: false, activeScale: 1.04 },
  },
  {
    id: 'cinema-letterbox', name: 'Cinema (letterbox)', category: 'classico', base: 'minimal', sample: 'era uma vez', ownsPosition: true,
    description: 'Pequena e centralizada na faixa preta inferior, como no cinema.',
    style: { fontFamily: 'Cormorant Garamond', fontWeight: 600, fontSize: 52, color: '#F3F0E8', highlightColor: '#F3F0E8', strokeWidth: 0, uppercase: false,
      letterSpacing: 2, shadow: false, position: { x: 0.5, y: 0.93 }, maxWords: 8, lines: 2, animation: 'fade', activeScale: 1 },
  },
];

const BY_ID = new Map(CAPTION_PRESETS.map((p) => [p.id, p]));

export function captionPresetDef(id: string | undefined): CaptionPresetDef | undefined {
  return id ? BY_ID.get(id) : undefined;
}

/** aparência nativa a usar no engine p/ um id de preset (nativo ou da biblioteca) */
export function captionBasePreset(id: string | undefined): CaptionBasePreset {
  const natives: CaptionBasePreset[] = ['classic', 'bold-pop', 'karaoke', 'minimal', 'boxed', 'neon'];
  if (id && (natives as string[]).includes(id)) return id as CaptionBasePreset;
  return captionPresetDef(id)?.base ?? 'classic';
}

/** campos opcionais que um preset pode ligar e que precisam ser "zerados" ao trocar de preset */
const RESETTABLE: (keyof CaptionStyle)[] = [
  'wordBox', 'activeScale', 'inactiveOpacity', 'autoEmoji', 'lines', 'jitter', 'glow', 'shadowColor', 'shadowBlur',
  'shadowOffset', 'backgroundPadding', 'gradient', 'background', 'backgroundRadius', 'italic', 'underline', 'letterSpacing',
  'lineHeight', 'strokeColor', 'strokeWidth', 'highlightColor', 'opacity',
];

/**
 * Patch completo p/ set_caption_style: zera os campos opcionais do preset
 * anterior e aplica o novo. Mantém a posição atual, salvo presets que a definem.
 */
export function captionStylePatch(id: string, current?: Partial<CaptionStyle>): Partial<CaptionStyle> | null {
  const def = captionPresetDef(id);
  if (!def) return null;
  const reset: Partial<CaptionStyle> = {};
  for (const k of RESETTABLE) (reset as Record<string, unknown>)[k] = undefined;
  const patch: Partial<CaptionStyle> = {
    ...reset,
    align: 'center',
    italic: false,
    uppercase: false,
    shadow: false,
    ...def.style,
    preset: def.id,
  };
  if (!def.ownsPosition) patch.position = current?.position ?? def.style.position ?? { x: 0.5, y: Y };
  return patch;
}

/** EditOp que aplica o preset às legendas (um passo de desfazer) */
export function captionPresetOp(id: string, current?: Partial<CaptionStyle>): EditOp | null {
  const style = captionStylePatch(id, current);
  const def = captionPresetDef(id);
  if (!style || !def) return null;
  return { op: 'set_caption_style', style, explain: `Legendas no estilo “${def.name}”` };
}

/** animações de legenda sugeridas (subconjunto que faz sentido por bloco) */
export const CAPTION_ANIMATIONS: TextAnimation[] = [
  'none', 'pop', 'fade', 'slide-up', 'bounce', 'zoom', 'blur-in', 'stomp', 'word-pop', 'word-bounce', 'word-fade', 'char-typewriter', 'char-wave', 'highlight-sweep', 'flicker',
];
