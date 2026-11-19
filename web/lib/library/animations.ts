/* =====================================================================
   Biblioteca · catálogo de animações (dono: sessão "biblioteca").
   Só METADADOS (nome PT-BR, grupo, onde pode ser usada, duração sugerida).
   Quem desenha é o engine (lib/engine/text.ts e animations.ts).
   ===================================================================== */
import type { ClipAnimation, Id, Seconds, TextAnimation } from '../types';
import type { EditOp } from '../ops';

export type AnimSlot = 'in' | 'out' | 'loop';

export const ANIM_SLOT_LABELS: Record<AnimSlot, string> = { in: 'Entrada', out: 'Saída', loop: 'Loop' };

export type TextAnimGroup = 'basico' | 'palavra' | 'letra' | 'enfase';

export const TEXT_ANIM_GROUP_LABELS: Record<TextAnimGroup, string> = {
  basico: 'Básicas', palavra: 'Palavra a palavra', letra: 'Letra a letra', enfase: 'Ênfase',
};

export interface TextAnimDef {
  id: TextAnimation;
  name: string;
  group: TextAnimGroup;
  slots: AnimSlot[];
  /** duração sugerida da animação de entrada/saída (s) */
  duration: Seconds;
  description: string;
}

export const TEXT_ANIMATIONS: TextAnimDef[] = [
  { id: 'none', name: 'Nenhuma', group: 'basico', slots: ['in', 'out', 'loop'], duration: 0, description: 'Sem animação.' },
  { id: 'fade', name: 'Esmaecer', group: 'basico', slots: ['in', 'out'], duration: 0.35, description: 'Surge/some suavemente.' },
  { id: 'pop', name: 'Pop', group: 'basico', slots: ['in', 'out'], duration: 0.35, description: 'Cresce com um leve quique.' },
  { id: 'scale-in', name: 'Crescer', group: 'basico', slots: ['in', 'out'], duration: 0.4, description: 'Escala do pequeno ao normal.' },
  { id: 'zoom', name: 'Zoom', group: 'basico', slots: ['in', 'out'], duration: 0.4, description: 'Chega de perto da câmera.' },
  { id: 'slide-up', name: 'Subir', group: 'basico', slots: ['in', 'out'], duration: 0.4, description: 'Desliza de baixo para cima.' },
  { id: 'slide-down', name: 'Descer', group: 'basico', slots: ['in', 'out'], duration: 0.4, description: 'Desliza de cima para baixo.' },
  { id: 'slide-left', name: 'Deslizar ←', group: 'basico', slots: ['in', 'out'], duration: 0.4, description: 'Entra pela direita.' },
  { id: 'slide-right', name: 'Deslizar →', group: 'basico', slots: ['in', 'out'], duration: 0.4, description: 'Entra pela esquerda.' },
  { id: 'drop', name: 'Cair', group: 'basico', slots: ['in'], duration: 0.45, description: 'Cai de cima e assenta.' },
  { id: 'blur', name: 'Desfocar', group: 'basico', slots: ['in', 'out'], duration: 0.4, description: 'Entra/sai desfocando.' },
  { id: 'blur-in', name: 'Surgir do desfoque', group: 'basico', slots: ['in'], duration: 0.5, description: 'Foca a partir de um borrão.' },
  { id: 'spin', name: 'Girar', group: 'basico', slots: ['in', 'out', 'loop'], duration: 0.5, description: 'Gira entrando.' },
  { id: 'bounce', name: 'Quicar', group: 'basico', slots: ['in', 'loop'], duration: 0.6, description: 'Quica até parar.' },
  { id: 'typewriter', name: 'Máquina de escrever', group: 'letra', slots: ['in'], duration: 0.8, description: 'Digita o texto todo.' },
  { id: 'karaoke', name: 'Karaokê', group: 'palavra', slots: ['in'], duration: 0, description: 'Preenche com a cor de destaque ao longo do clipe.' },
  { id: 'word-pop', name: 'Pop por palavra', group: 'palavra', slots: ['in'], duration: 0.6, description: 'Cada palavra surge com pop, em sequência.' },
  { id: 'word-fade', name: 'Esmaecer por palavra', group: 'palavra', slots: ['in', 'out'], duration: 0.7, description: 'Palavras aparecem uma a uma.' },
  { id: 'word-slide', name: 'Deslizar por palavra', group: 'palavra', slots: ['in'], duration: 0.7, description: 'Palavras sobem em sequência.' },
  { id: 'word-bounce', name: 'Quicar por palavra', group: 'palavra', slots: ['in'], duration: 0.8, description: 'Palavras quicam ao entrar.' },
  { id: 'word-drop', name: 'Cair por palavra', group: 'palavra', slots: ['in'], duration: 0.8, description: 'Palavras caem do alto.' },
  { id: 'word-highlight', name: 'Destaque por palavra', group: 'palavra', slots: ['in', 'loop'], duration: 0, description: 'Destaca palavra a palavra ao longo do clipe.' },
  { id: 'char-wave', name: 'Onda de letras', group: 'letra', slots: ['in', 'loop'], duration: 0.7, description: 'Letras entram em onda.' },
  { id: 'char-fade', name: 'Esmaecer letras', group: 'letra', slots: ['in', 'out'], duration: 0.7, description: 'Letras surgem uma a uma.' },
  { id: 'char-pop', name: 'Pop de letras', group: 'letra', slots: ['in'], duration: 0.7, description: 'Cada letra salta ao entrar.' },
  { id: 'char-typewriter', name: 'Digitando', group: 'letra', slots: ['in'], duration: 0.9, description: 'Letra a letra com cursor.' },
  { id: 'stomp', name: 'Pisão', group: 'enfase', slots: ['in'], duration: 0.3, description: 'Chega grande e "bate" no lugar.' },
  { id: 'shake', name: 'Tremer', group: 'enfase', slots: ['in', 'loop'], duration: 0.4, description: 'Treme como um impacto.' },
  { id: 'glitch', name: 'Glitch', group: 'enfase', slots: ['in', 'out', 'loop'], duration: 0.35, description: 'Falha digital com cores separadas.' },
  { id: 'flicker', name: 'Piscar', group: 'enfase', slots: ['in', 'loop'], duration: 0.5, description: 'Pisca como lâmpada neon.' },
  { id: 'wave', name: 'Onda', group: 'enfase', slots: ['loop'], duration: 0, description: 'Palavras ondulam sem parar.' },
  { id: 'highlight-sweep', name: 'Marca-texto', group: 'enfase', slots: ['in'], duration: 0.6, description: 'Um marca-texto passa por trás.' },
  { id: 'underline-draw', name: 'Sublinhar', group: 'enfase', slots: ['in'], duration: 0.6, description: 'Uma linha se desenha embaixo.' },
  { id: 'box-reveal', name: 'Revelar caixa', group: 'enfase', slots: ['in'], duration: 0.6, description: 'Uma caixa abre e revela o texto.' },
];

export type ClipAnimGroup = 'movimento' | 'escala' | 'giro' | 'efeito';

export const CLIP_ANIM_GROUP_LABELS: Record<ClipAnimGroup, string> = {
  movimento: 'Movimento', escala: 'Escala', giro: 'Giro', efeito: 'Efeito',
};

export interface ClipAnimDef {
  id: ClipAnimation;
  name: string;
  group: ClipAnimGroup;
  slots: AnimSlot[];
  duration: Seconds;
  description: string;
}

export const CLIP_ANIMATIONS: ClipAnimDef[] = [
  { id: 'fade', name: 'Esmaecer', group: 'efeito', slots: ['in', 'out'], duration: 0.4, description: 'Aparece/some suavemente.' },
  { id: 'blur', name: 'Desfocar', group: 'efeito', slots: ['in', 'out'], duration: 0.4, description: 'Entra/sai de um desfoque.' },
  { id: 'zoom-in', name: 'Zoom in', group: 'escala', slots: ['in', 'out', 'loop'], duration: 0.5, description: 'Cresce até o tamanho.' },
  { id: 'zoom-out', name: 'Zoom out', group: 'escala', slots: ['in', 'out', 'loop'], duration: 0.5, description: 'Encolhe até o tamanho.' },
  { id: 'pop', name: 'Pop', group: 'escala', slots: ['in', 'out'], duration: 0.35, description: 'Salta com elasticidade.' },
  { id: 'bounce', name: 'Quicar', group: 'escala', slots: ['in', 'loop'], duration: 0.6, description: 'Quica ao entrar.' },
  { id: 'slide-left', name: 'Deslizar ←', group: 'movimento', slots: ['in', 'out'], duration: 0.45, description: 'Entra pela direita.' },
  { id: 'slide-right', name: 'Deslizar →', group: 'movimento', slots: ['in', 'out'], duration: 0.45, description: 'Entra pela esquerda.' },
  { id: 'slide-up', name: 'Deslizar ↑', group: 'movimento', slots: ['in', 'out'], duration: 0.45, description: 'Sobe de baixo.' },
  { id: 'slide-down', name: 'Deslizar ↓', group: 'movimento', slots: ['in', 'out'], duration: 0.45, description: 'Desce de cima.' },
  { id: 'shake', name: 'Tremer', group: 'efeito', slots: ['in', 'loop'], duration: 0.4, description: 'Treme como impacto.' },
  { id: 'swing', name: 'Balançar', group: 'giro', slots: ['in', 'loop'], duration: 0.6, description: 'Balança como pêndulo.' },
  { id: 'spin', name: 'Girar', group: 'giro', slots: ['in', 'out', 'loop'], duration: 0.5, description: 'Gira entrando.' },
  { id: 'flip', name: 'Virar', group: 'giro', slots: ['in', 'out'], duration: 0.5, description: 'Vira como uma carta.' },
];

export function textAnimDef(id: TextAnimation | undefined): TextAnimDef | undefined {
  return TEXT_ANIMATIONS.find((a) => a.id === id);
}

export function clipAnimDef(id: ClipAnimation | undefined): ClipAnimDef | undefined {
  return CLIP_ANIMATIONS.find((a) => a.id === id);
}

export function textAnimationsFor(slot: AnimSlot): TextAnimDef[] {
  return TEXT_ANIMATIONS.filter((a) => a.slots.includes(slot));
}

export function clipAnimationsFor(slot: AnimSlot): ClipAnimDef[] {
  return CLIP_ANIMATIONS.filter((a) => a.slots.includes(slot));
}

const TEXT_FIELD: Record<AnimSlot, 'animation' | 'animationOut' | 'animationLoop'> = { in: 'animation', out: 'animationOut', loop: 'animationLoop' };
const CLIP_FIELD: Record<AnimSlot, 'animationIn' | 'animationOut' | 'animationLoop'> = { in: 'animationIn', out: 'animationOut', loop: 'animationLoop' };

/** op p/ trocar a animação de um TextClip num slot ('none' remove saída/loop) */
export function textAnimationOp(clipId: Id, slot: AnimSlot, id: TextAnimation): EditOp {
  const field = TEXT_FIELD[slot];
  const value = slot !== 'in' && id === 'none' ? undefined : id;
  const def = textAnimDef(id);
  return { op: 'update_clip', clipId, patch: { [field]: value }, explain: `Animação de ${ANIM_SLOT_LABELS[slot].toLowerCase()}: ${def?.name ?? id}` };
}

/** op p/ trocar a animação de um clipe visual (vídeo/imagem/sticker/forma); id null remove */
export function clipAnimationOp(clipId: Id, slot: AnimSlot, id: ClipAnimation | null, duration?: Seconds): EditOp {
  const field = CLIP_FIELD[slot];
  const def = id ? clipAnimDef(id) : undefined;
  const value = id ? { kind: id, duration: duration ?? (slot === 'loop' ? 1.2 : def?.duration ?? 0.4) } : undefined;
  return { op: 'update_clip', clipId, patch: { [field]: value }, explain: id ? `Animação de ${ANIM_SLOT_LABELS[slot].toLowerCase()}: ${def?.name ?? id}` : `Sem animação de ${ANIM_SLOT_LABELS[slot].toLowerCase()}` };
}
