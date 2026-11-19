/* =====================================================================
   Biblioteca · modelos de texto e motion graphics (dono: sessão "biblioteca").
   Cada modelo descreve "peças" (texto, forma, emoji) em coordenadas do
   quadro; assembleTemplate() converte em EditOp[] (add_track/add_clip) com
   o MESMO groupId — a timeline move/exclui o grupo junto.
   Puro: não toca no DOM nem no store (a galeria faz o dispatch).
   ===================================================================== */
import type {
  ClipAnimation, Id, Keyframe, Project, Seconds, ShapeClip, ShapeKind, StickerClip, TextAnimation, TextClip, TextStyle, Track,
} from '../types';
import { DEFAULT_TRANSFORM } from '../types';
import { DEFAULT_TEXT_STYLE } from '../defaults';
import { clipEnd, projectDuration, type EditOp } from '../ops';
import { uid } from '../util';
import { fontDef } from './fonts';

/* ---------- tipos públicos ---------- */

export interface BrandColors {
  /** cor principal (barras, caixas, botões) */
  primary: string;
  /** cor de apoio (destaques, selos) */
  secondary: string;
  /** cor do texto sobre fundo escuro/vídeo */
  text: string;
  /** cor escura (texto sobre caixa clara) */
  dark: string;
}

export const DEFAULT_BRAND: BrandColors = { primary: '#F2681F', secondary: '#FFD23F', text: '#FFFFFF', dark: '#141414' };

export type TemplateKind = 'texto' | 'motion';
export type TemplateCategory = 'titulo' | 'texto' | 'lower-third' | 'cta' | 'info' | 'marca';

export const TEMPLATE_CATEGORY_LABELS: Record<TemplateCategory, string> = {
  titulo: 'Títulos', texto: 'Textos', 'lower-third': 'Lower thirds', cta: 'Chamadas (CTA)', info: 'Informação', marca: 'Marca',
};

export interface TemplateParam {
  key: string;
  label: string;
  type: 'text' | 'number';
  default: string;
  multiline?: boolean;
}

export interface TemplateContext {
  project: Project;
  /** início na timeline (playhead) */
  at?: Seconds;
  brand?: Partial<BrandColors>;
  /** duração desejada (senão a padrão do modelo) */
  duration?: Seconds;
  /** mede a largura do texto em px do projeto (opcional; sem ela usamos estimativa) */
  measure?: (text: string, style: TextStyle, projectHeight: number) => number;
  /** força o groupId (testes/IA); senão gera um */
  groupId?: Id;
}

/** quadro onde o modelo é montado */
export interface Frame {
  W: number;
  H: number;
  short: number;
  portrait: boolean;
  dur: Seconds;
  brand: BrandColors;
  /** largura do texto como fração da largura do quadro */
  textW: (text: string, style: Partial<TextStyle>) => number;
}

interface PieceBase {
  /** início relativo ao modelo (s) */
  t0?: Seconds;
  /** duração (s); padrão = até o fim do modelo */
  dur?: Seconds;
  label?: string;
}

export interface TextPiece extends PieceBase {
  kind: 'text';
  text: string;
  style: Partial<TextStyle>;
  x: number;
  y: number;
  animation?: TextAnimation;
  animationOut?: TextAnimation;
  animationLoop?: TextAnimation;
  rotation?: number;
  keyframes?: Keyframe[];
}

export interface ShapePiece extends PieceBase {
  kind: 'shape';
  shape: ShapeKind;
  fill: string;
  stroke?: string;
  strokeWidth?: number;
  /** raio do canto em px do PROJETO (convertido p/ a unidade da forma) */
  radiusPx?: number;
  /** caixa: centro e tamanho normalizados (w relativo a W, h relativo a H) */
  box: { cx: number; cy: number; w: number; h: number };
  opacity?: number;
  rotation?: number;
  animIn?: ClipAnimation;
  animOut?: ClipAnimation;
  animLoop?: ClipAnimation;
  animInDur?: Seconds;
  keyframes?: Keyframe[];
}

export interface StickerPiece extends PieceBase {
  kind: 'sticker';
  emoji: string;
  cx: number;
  cy: number;
  /** tamanho relativo ao lado menor do quadro (0..1) */
  size: number;
  rotation?: number;
  animIn?: ClipAnimation;
  animOut?: ClipAnimation;
  animLoop?: ClipAnimation;
}

export type Piece = TextPiece | ShapePiece | StickerPiece;

export interface TemplateDef {
  id: string;
  name: string;
  kind: TemplateKind;
  category: TemplateCategory;
  description: string;
  /** duração padrão (s) */
  duration: Seconds;
  params: TemplateParam[];
  /** ocupa o projeto inteiro (marca d'água) em vez de começar no playhead */
  fullLength?: boolean;
  build: (v: Record<string, string>, f: Frame) => Piece[];
}

/* ---------- utilitários de montagem ---------- */

const NARROW_K = 0.43;
const NORMAL_K = 0.58;

/** estimativa de largura de texto (px do projeto) quando não há canvas para medir */
export function estimateTextWidth(text: string, style: Partial<TextStyle>, H: number): number {
  const px = ((style.fontSize ?? DEFAULT_TEXT_STYLE.fontSize) * H) / 1920;
  const def = fontDef(style.fontFamily);
  let k = def?.narrow ? NARROW_K : NORMAL_K;
  if (def?.category === 'manuscrita') k *= 0.85;
  if (def?.category === 'mono') k = 0.62;
  if ((style.fontWeight ?? 700) >= 800 && !def?.narrow) k *= 1.06;
  const s = style.uppercase ? text.toLocaleUpperCase('pt-BR') : text;
  const longest = s.split('\n').reduce((m, l) => Math.max(m, l.length), 0);
  const spacing = ((style.letterSpacing ?? 0) * H) / 1920;
  return longest * px * k * (style.uppercase ? 1.08 : 1) + longest * spacing;
}

/** converte uma caixa (fração do quadro) em transform + aspect de ShapeClip */
export function shapeGeometry(box: ShapePiece['box'], shape: ShapeKind, W: number, H: number): { transform: ShapeClip['transform']; aspect?: number; rotate90: boolean } {
  const short = Math.min(W, H);
  let wPx = Math.max(1, box.w * W);
  let hPx = Math.max(1, box.h * H);
  const stretchy = shape === 'rect' || shape === 'rounded-rect' || shape === 'line';
  // barras verticais: desenha deitada e gira 90° (o engine dimensiona pelo lado maior)
  const rotate90 = stretchy && hPx > wPx;
  if (rotate90) [wPx, hPx] = [hPx, wPx];
  const aspect = wPx / hPx;
  const base = short * 0.95;
  const scale = aspect >= 1 ? wPx / base : hPx / base;
  return {
    transform: { ...DEFAULT_TRANSFORM, x: box.cx - 0.5, y: box.cy - 0.5, scale, rotation: rotate90 ? 90 : 0 },
    aspect: stretchy || shape === 'speech-bubble' || shape === 'circle' ? aspect : undefined,
    rotate90,
  };
}

function isFree(track: Track, start: Seconds, end: Seconds): boolean {
  return !track.locked && !track.clips.some((c) => c.start < end - 1e-6 && clipEnd(c) > start + 1e-6);
}

/**
 * Escolhe (ou cria) as trilhas do modelo: formas/emoji numa trilha de
 * sobreposição ABAIXO da trilha de texto (o texto fica por cima).
 */
export function templateTracks(p: Project, start: Seconds, end: Seconds, needs: { text: boolean; overlay: boolean }): { ops: EditOp[]; textTrackId: Id; overlayTrackId: Id } {
  const ops: EditOp[] = [];
  const tracks = p.tracks;
  let textIdx = tracks.findIndex((t) => t.kind === 'text' && isFree(t, start, end));
  let textTrackId = textIdx >= 0 ? tracks[textIdx].id : uid('track_text');
  let overlayTrackId = uid('track_overlay');
  let overlayIdx = -1;
  if (needs.overlay) {
    const limit = textIdx >= 0 ? textIdx : tracks.length;
    for (let i = limit - 1; i >= 0; i--) {
      if (tracks[i].kind === 'overlay' && isFree(tracks[i], start, end)) { overlayIdx = i; break; }
    }
    if (overlayIdx >= 0) overlayTrackId = tracks[overlayIdx].id;
    else {
      const n = tracks.filter((t) => t.kind === 'overlay').length + 1;
      ops.push({ op: 'add_track', track: { id: overlayTrackId, kind: 'overlay', name: `Sobreposição ${n}` }, index: limit, explain: 'Nova trilha para as formas do modelo' });
      if (textIdx >= 0) textIdx += 1;
    }
  }
  if (needs.text && textIdx < 0) {
    const n = tracks.filter((t) => t.kind === 'text').length + 1;
    ops.push({ op: 'add_track', track: { id: textTrackId, kind: 'text', name: `Texto ${n}` }, explain: 'Nova trilha de texto do modelo' });
  }
  if (!needs.text) textTrackId = '';
  return { ops, textTrackId, overlayTrackId };
}

export function makeFrame(ctx: TemplateContext, duration: Seconds): Frame {
  const { width: W, height: H } = ctx.project;
  const brand = { ...DEFAULT_BRAND, ...(ctx.brand ?? {}) };
  const textW = (text: string, style: Partial<TextStyle>) => {
    const full: TextStyle = { ...DEFAULT_TEXT_STYLE, ...style } as TextStyle;
    const px = ctx.measure ? ctx.measure(text, full, H) : estimateTextWidth(text, full, H);
    return px / W;
  };
  return { W, H, short: Math.min(W, H), portrait: H > W, dur: duration, brand, textW };
}

/* ---------- catálogo ---------- */

const P = (key: string, label: string, def: string, multiline = false): TemplateParam => ({ key, label, type: 'text', default: def, multiline });
const N = (key: string, label: string, def: number): TemplateParam => ({ key, label, type: 'number', default: String(def) });

const ts = (s: Partial<TextStyle>): Partial<TextStyle> => ({ strokeWidth: 0, shadow: false, align: 'center', ...s });

/** margem lateral dos lower thirds (fração da largura) */
const mx = (f: Frame) => (f.portrait ? 0.07 : 0.06);
/** linha base dos lower thirds */
const ly = (f: Frame) => (f.portrait ? 0.74 : 0.78);
/** centro x para um texto alinhado à esquerda começando em `left` */
const leftX = (f: Frame, left: number, text: string, style: Partial<TextStyle>) => left + f.textW(text, style) / 2;
/** px base-1920 -> fração da altura */
const fy = (px: number) => px / 1920;

export const TEMPLATES: TemplateDef[] = [
  /* ===== títulos e textos ===== */
  {
    id: 'titulo-impacto', name: 'Título impacto', kind: 'texto', category: 'titulo', duration: 3,
    description: 'Título enorme em caixa alta com contorno e barra de destaque.',
    params: [P('titulo', 'Título', 'O SEGREDO'), P('sub', 'Linha de apoio', 'que ninguém te conta')],
    build: (v, f) => {
      const big = ts({ fontFamily: 'Anton', fontWeight: 400, fontSize: f.portrait ? 190 : 210, color: f.brand.text, uppercase: true, strokeColor: '#000', strokeWidth: 8, shadow: true });
      const sub = ts({ fontFamily: 'Montserrat', fontWeight: 800, fontSize: 64, color: f.brand.dark, uppercase: true, background: f.brand.secondary, backgroundRadius: 12, backgroundPadding: 14 });
      const w = Math.min(0.9, f.textW(v.titulo, big));
      return [
        { kind: 'text', text: v.titulo, style: big, x: 0.5, y: 0.45, animation: 'stomp', animationOut: 'fade' },
        { kind: 'shape', shape: 'line', fill: f.brand.primary, box: { cx: 0.5, cy: 0.45 + fy(big.fontSize!) * 0.62, w: w * 0.8, h: 0.012 }, t0: 0.15, animIn: 'slide-right', animOut: 'fade' },
        ...(v.sub ? [{ kind: 'text', text: v.sub, style: sub, x: 0.5, y: 0.45 + fy(big.fontSize!) * 0.62 + 0.06, t0: 0.3, animation: 'pop', animationOut: 'fade' } as TextPiece] : []),
      ];
    },
  },
  {
    id: 'titulo-elegante', name: 'Título elegante', kind: 'texto', category: 'titulo', duration: 3.5,
    description: 'Serifa itálica, filete fino e subtítulo espaçado.',
    params: [P('titulo', 'Título', 'Uma nova fase'), P('sub', 'Subtítulo', 'COLEÇÃO 2026')],
    build: (v, f) => {
      const big = ts({ fontFamily: 'Playfair Display', fontWeight: 600, fontSize: 132, color: '#FFFFFF', italic: true, shadowColor: 'rgba(0,0,0,.45)', shadowBlur: 20 });
      const sub = ts({ fontFamily: 'Montserrat', fontWeight: 600, fontSize: 40, color: '#FFFFFF', letterSpacing: 14, uppercase: true });
      return [
        { kind: 'text', text: v.titulo, style: big, x: 0.5, y: 0.46, animation: 'blur-in', animationOut: 'fade' },
        { kind: 'shape', shape: 'line', fill: 'rgba(255,255,255,.85)', box: { cx: 0.5, cy: 0.46 + fy(132) * 0.75, w: 0.18, h: 0.003 }, t0: 0.4, animIn: 'zoom-in', animOut: 'fade' },
        { kind: 'text', text: v.sub, style: sub, x: 0.5, y: 0.46 + fy(132) * 0.75 + 0.045, t0: 0.6, animation: 'char-fade', animationOut: 'fade' },
      ];
    },
  },
  {
    id: 'titulo-cinema', name: 'Título cinema', kind: 'texto', category: 'titulo', duration: 4,
    description: 'Faixas pretas de cinema e título condensado bem espaçado.',
    params: [P('titulo', 'Título', 'O COMEÇO'), P('sub', 'Crédito', 'um filme de você')],
    build: (v, f) => {
      const big = ts({ fontFamily: 'Bebas Neue', fontWeight: 400, fontSize: f.portrait ? 150 : 170, color: '#F4F1EA', letterSpacing: 22, uppercase: true });
      const sub = ts({ fontFamily: 'Cormorant Garamond', fontWeight: 600, fontSize: 46, color: 'rgba(244,241,234,.85)', italic: true });
      const bar = f.portrait ? 0.1 : 0.12;
      return [
        { kind: 'shape', shape: 'rect', fill: '#000000', box: { cx: 0.5, cy: bar / 2, w: 1.02, h: bar }, animIn: 'slide-down', animInDur: 0.6, animOut: 'slide-up', label: 'Faixa' },
        { kind: 'shape', shape: 'rect', fill: '#000000', box: { cx: 0.5, cy: 1 - bar / 2, w: 1.02, h: bar }, animIn: 'slide-up', animInDur: 0.6, animOut: 'slide-down', label: 'Faixa' },
        { kind: 'text', text: v.titulo, style: big, x: 0.5, y: 0.48, t0: 0.4, animation: 'blur-in', animationOut: 'fade' },
        { kind: 'text', text: v.sub, style: sub, x: 0.5, y: 0.48 + fy(big.fontSize!) * 0.7, t0: 1, animation: 'fade', animationOut: 'fade' },
      ];
    },
  },
  {
    id: 'subtitulo', name: 'Subtítulo em caixa', kind: 'texto', category: 'texto', duration: 3,
    description: 'Frase curta numa caixa arredondada, palavra a palavra.',
    params: [P('texto', 'Texto', 'Isso aqui vai te ajudar', true)],
    build: (v, f) => [{
      kind: 'text', text: v.texto, x: 0.5, y: f.portrait ? 0.3 : 0.25, animation: 'word-slide', animationOut: 'fade',
      style: ts({ fontFamily: 'Poppins', fontWeight: 800, fontSize: 70, color: f.brand.dark, background: '#FFFFFF', backgroundRadius: 22, backgroundPadding: 18 }),
    }],
  },
  {
    id: 'citacao', name: 'Citação', kind: 'texto', category: 'texto', duration: 5,
    description: 'Aspas grandes, frase em serifa e autor.',
    params: [P('frase', 'Frase', 'Feito é melhor que perfeito.', true), P('autor', 'Autor', 'Ditado popular')],
    build: (v, f) => [
      { kind: 'text', text: '“', x: 0.5, y: 0.33, style: ts({ fontFamily: 'Playfair Display', fontWeight: 900, fontSize: 300, color: f.brand.primary }), animation: 'drop', animationOut: 'fade' },
      { kind: 'text', text: v.frase, x: 0.5, y: 0.47, t0: 0.25, style: ts({ fontFamily: 'Lora', fontWeight: 600, fontSize: 78, color: '#FFFFFF', italic: true, shadowColor: 'rgba(0,0,0,.5)', shadowBlur: 18, lineHeight: 1.25 }), animation: 'word-fade', animationOut: 'fade' },
      { kind: 'text', text: `— ${v.autor}`, x: 0.5, y: 0.6, t0: 1.2, style: ts({ fontFamily: 'Montserrat', fontWeight: 600, fontSize: 42, color: 'rgba(255,255,255,.85)', letterSpacing: 4, uppercase: true }), animation: 'fade', animationOut: 'fade' },
    ],
  },
  {
    id: 'nome-na-tela', name: 'Nome na tela', kind: 'texto', category: 'texto', duration: 3,
    description: 'Nome em pílula e função logo abaixo, centralizados.',
    params: [P('nome', 'Nome', 'Ana Souza'), P('funcao', 'Função', 'Fundadora')],
    build: (v, f) => [
      { kind: 'text', text: v.nome, x: 0.5, y: 0.8, style: ts({ fontFamily: 'Plus Jakarta Sans', fontWeight: 800, fontSize: 64, color: '#FFFFFF', background: f.brand.primary, backgroundRadius: 60, backgroundPadding: 16 }), animation: 'pop', animationOut: 'fade' },
      { kind: 'text', text: v.funcao, x: 0.5, y: 0.8 + 0.055, t0: 0.2, style: ts({ fontFamily: 'Plus Jakarta Sans', fontWeight: 600, fontSize: 42, color: '#FFFFFF', shadowColor: 'rgba(0,0,0,.6)', shadowBlur: 12 }), animation: 'fade', animationOut: 'fade' },
    ],
  },
  {
    id: 'capitulo', name: 'Capítulo', kind: 'texto', category: 'titulo', duration: 3,
    description: 'Número do capítulo, título e sublinhado que se desenha.',
    params: [N('numero', 'Número', 1), P('titulo', 'Título', 'O problema')],
    build: (v, f) => {
      const title = ts({ fontFamily: 'League Spartan', fontWeight: 900, fontSize: 120, color: '#FFFFFF', uppercase: true, shadow: true });
      const w = Math.min(0.85, f.textW(v.titulo, title));
      return [
        { kind: 'text', text: `CAPÍTULO ${v.numero}`, x: 0.5, y: 0.42, style: ts({ fontFamily: 'Montserrat', fontWeight: 700, fontSize: 40, color: f.brand.secondary, letterSpacing: 12 }), animation: 'char-fade', animationOut: 'fade' },
        { kind: 'text', text: v.titulo, x: 0.5, y: 0.42 + 0.065, t0: 0.25, style: title, animation: 'slide-up', animationOut: 'fade' },
        { kind: 'shape', shape: 'line', fill: f.brand.primary, box: { cx: 0.5, cy: 0.42 + 0.065 + fy(120) * 0.65, w, h: 0.008 }, t0: 0.55, animIn: 'slide-right', animOut: 'fade' },
      ];
    },
  },

  /* ===== lower thirds ===== */
  {
    id: 'lt-barra', name: 'Lower third · barra', kind: 'motion', category: 'lower-third', duration: 4,
    description: 'Barra vertical colorida ao lado do nome e da função.',
    params: [P('nome', 'Nome', 'Ana Souza'), P('funcao', 'Função', 'Fundadora · Estúdio Aurora')],
    build: (v, f) => {
      const left = mx(f) + 0.03;
      const name = ts({ fontFamily: 'Montserrat', fontWeight: 900, fontSize: 64, color: '#FFFFFF', align: 'left', shadowColor: 'rgba(0,0,0,.55)', shadowBlur: 14 });
      const role = ts({ fontFamily: 'Montserrat', fontWeight: 600, fontSize: 40, color: 'rgba(255,255,255,.9)', align: 'left', shadowColor: 'rgba(0,0,0,.55)', shadowBlur: 12 });
      const y = ly(f);
      return [
        { kind: 'shape', shape: 'rect', fill: f.brand.primary, box: { cx: mx(f), cy: y + 0.02, w: 0.012, h: fy(64 + 40) * 1.5 }, animIn: 'slide-up', animOut: 'fade', animInDur: 0.35 },
        { kind: 'text', text: v.nome, style: name, x: leftX(f, left, v.nome, name), y, t0: 0.15, animation: 'slide-right', animationOut: 'fade' },
        { kind: 'text', text: v.funcao, style: role, x: leftX(f, left, v.funcao, role), y: y + fy(64) * 1.05, t0: 0.3, animation: 'fade', animationOut: 'fade' },
      ];
    },
  },
  {
    id: 'lt-caixa', name: 'Lower third · caixa', kind: 'motion', category: 'lower-third', duration: 4,
    description: 'Caixa na cor da marca com o nome e faixa escura com a função.',
    params: [P('nome', 'Nome', 'Ana Souza'), P('funcao', 'Função', 'Fundadora')],
    build: (v, f) => {
      const left = mx(f) + 0.025;
      const name = ts({ fontFamily: 'Poppins', fontWeight: 800, fontSize: 60, color: '#FFFFFF', align: 'left' });
      const role = ts({ fontFamily: 'Poppins', fontWeight: 600, fontSize: 38, color: '#FFFFFF', align: 'left' });
      const y = ly(f);
      const nw = f.textW(v.nome, name) + 0.05;
      const rw = f.textW(v.funcao, role) + 0.05;
      const nh = fy(60) * 1.55;
      const rh = fy(38) * 1.6;
      return [
        { kind: 'shape', shape: 'rounded-rect', fill: f.brand.primary, radiusPx: 14 * f.H / 1920, box: { cx: mx(f) + nw / 2, cy: y, w: nw, h: nh }, animIn: 'slide-right', animOut: 'slide-left' },
        { kind: 'shape', shape: 'rounded-rect', fill: 'rgba(15,15,18,.88)', radiusPx: 12 * f.H / 1920, box: { cx: mx(f) + rw / 2, cy: y + nh / 2 + rh / 2 + 0.006, w: rw, h: rh }, t0: 0.15, animIn: 'slide-right', animOut: 'slide-left' },
        { kind: 'text', text: v.nome, style: name, x: leftX(f, left, v.nome, name), y, t0: 0.2, animation: 'fade', animationOut: 'fade' },
        { kind: 'text', text: v.funcao, style: role, x: leftX(f, left, v.funcao, role), y: y + nh / 2 + rh / 2 + 0.006, t0: 0.35, animation: 'fade', animationOut: 'fade' },
      ];
    },
  },
  {
    id: 'lt-linha', name: 'Lower third · linha animada', kind: 'motion', category: 'lower-third', duration: 4,
    description: 'Nome, linha que se desenha e função embaixo.',
    params: [P('nome', 'Nome', 'Ana Souza'), P('funcao', 'Função', 'Fundadora')],
    build: (v, f) => {
      const left = mx(f);
      const name = ts({ fontFamily: 'Outfit', fontWeight: 800, fontSize: 66, color: '#FFFFFF', align: 'left', shadowColor: 'rgba(0,0,0,.5)', shadowBlur: 14 });
      const role = ts({ fontFamily: 'Outfit', fontWeight: 500, fontSize: 40, color: '#FFFFFF', align: 'left', letterSpacing: 3, uppercase: true, shadowColor: 'rgba(0,0,0,.5)', shadowBlur: 12 });
      const y = ly(f);
      const w = Math.max(f.textW(v.nome, name), f.textW(v.funcao, role)) + 0.02;
      return [
        { kind: 'text', text: v.nome, style: name, x: leftX(f, left, v.nome, name), y, animation: 'word-slide', animationOut: 'fade' },
        { kind: 'shape', shape: 'line', fill: f.brand.primary, box: { cx: left + w / 2, cy: y + fy(66) * 0.72, w, h: 0.006 }, t0: 0.25, animIn: 'slide-right', animOut: 'fade' },
        { kind: 'text', text: v.funcao, style: role, x: leftX(f, left, v.funcao, role), y: y + fy(66) * 0.72 + fy(40) * 1.1, t0: 0.45, animation: 'fade', animationOut: 'fade' },
      ];
    },
  },
  {
    id: 'lt-glass', name: 'Lower third · vidro', kind: 'motion', category: 'lower-third', duration: 4,
    description: 'Cartão translúcido com contorno claro e ponto da marca.',
    params: [P('nome', 'Nome', 'Ana Souza'), P('funcao', 'Função', 'Fundadora')],
    build: (v, f) => {
      const name = ts({ fontFamily: 'Plus Jakarta Sans', fontWeight: 800, fontSize: 56, color: '#FFFFFF', align: 'left' });
      const role = ts({ fontFamily: 'Plus Jakarta Sans', fontWeight: 500, fontSize: 38, color: 'rgba(255,255,255,.85)', align: 'left' });
      const y = ly(f);
      const dot = fy(56) * 1.2 * f.H / f.W; // largura do ponto em fração de W
      const tl = mx(f) + 0.03 + dot + 0.025;
      const w = Math.max(f.textW(v.nome, name), f.textW(v.funcao, role)) + (tl - mx(f)) + 0.04;
      const h = fy(56 + 38) * 1.6;
      return [
        { kind: 'shape', shape: 'rounded-rect', fill: 'rgba(255,255,255,.16)', stroke: 'rgba(255,255,255,.45)', strokeWidth: 3, radiusPx: 28 * f.H / 1920, box: { cx: mx(f) + w / 2, cy: y + fy(20), w, h }, animIn: 'zoom-in', animOut: 'fade' },
        { kind: 'shape', shape: 'circle', fill: f.brand.primary, box: { cx: mx(f) + 0.03 + dot / 2, cy: y + fy(20), w: dot, h: fy(56) * 1.2 }, t0: 0.15, animIn: 'pop', animOut: 'fade' },
        { kind: 'text', text: v.nome, style: name, x: leftX(f, tl, v.nome, name), y: y - fy(8), t0: 0.2, animation: 'fade', animationOut: 'fade' },
        { kind: 'text', text: v.funcao, style: role, x: leftX(f, tl, v.funcao, role), y: y + fy(56), t0: 0.3, animation: 'fade', animationOut: 'fade' },
      ];
    },
  },
  {
    id: 'lt-minimal', name: 'Lower third · minimal', kind: 'motion', category: 'lower-third', duration: 4,
    description: 'Só tipografia: nome forte e função leve, palavra a palavra.',
    params: [P('nome', 'Nome', 'Ana Souza'), P('funcao', 'Função', 'Fundadora')],
    build: (v, f) => {
      const left = mx(f);
      const name = ts({ fontFamily: 'Inter', fontWeight: 800, fontSize: 60, color: '#FFFFFF', align: 'left', shadowColor: 'rgba(0,0,0,.55)', shadowBlur: 16 });
      const role = ts({ fontFamily: 'Inter', fontWeight: 400, fontSize: 42, color: 'rgba(255,255,255,.88)', align: 'left', shadowColor: 'rgba(0,0,0,.55)', shadowBlur: 14 });
      const y = ly(f);
      return [
        { kind: 'text', text: v.nome, style: name, x: leftX(f, left, v.nome, name), y, animation: 'word-fade', animationOut: 'fade' },
        { kind: 'text', text: v.funcao, style: role, x: leftX(f, left, v.funcao, role), y: y + fy(60) * 1.05, t0: 0.3, animation: 'word-fade', animationOut: 'fade' },
      ];
    },
  },

  /* ===== CTAs ===== */
  {
    id: 'cta-siga', name: 'CTA · Siga', kind: 'motion', category: 'cta', duration: 3,
    description: 'Botão em pílula “Siga para mais” com mãozinha quicando.',
    params: [P('texto', 'Texto', 'Siga para mais')],
    build: (v, f) => {
      const st = ts({ fontFamily: 'Poppins', fontWeight: 800, fontSize: 60, color: '#FFFFFF' });
      const w = f.textW(v.texto, st) + 0.12;
      const y = f.portrait ? 0.7 : 0.75;
      return [
        { kind: 'shape', shape: 'line', fill: f.brand.primary, box: { cx: 0.5, cy: y, w, h: fy(60) * 1.9 }, animIn: 'pop', animOut: 'zoom-out', animLoop: 'zoom-in' },
        { kind: 'text', text: v.texto, style: st, x: 0.5, y, t0: 0.1, animation: 'pop', animationOut: 'fade' },
        { kind: 'sticker', emoji: '👆', cx: 0.5 + w / 2 - 0.02, cy: y + fy(60) * 1.4, size: 0.1, t0: 0.4, animIn: 'pop', animLoop: 'bounce' },
      ];
    },
  },
  {
    id: 'cta-inscreva', name: 'CTA · Inscreva-se', kind: 'motion', category: 'cta', duration: 3.5,
    description: 'Botão vermelho “Inscreva-se” com sininho balançando.',
    params: [P('texto', 'Texto', 'INSCREVA-SE')],
    build: (v, f) => {
      const st = ts({ fontFamily: 'Montserrat', fontWeight: 900, fontSize: 58, color: '#FFFFFF', uppercase: true });
      const w = f.textW(v.texto, st) + 0.1;
      const y = f.portrait ? 0.72 : 0.78;
      const bell = 0.11;
      return [
        { kind: 'shape', shape: 'rounded-rect', fill: '#E62E2E', radiusPx: 18 * f.H / 1920, box: { cx: 0.5 - bell / 2, cy: y, w, h: fy(58) * 2 }, animIn: 'pop', animOut: 'zoom-out' },
        { kind: 'text', text: v.texto, style: st, x: 0.5 - bell / 2, y, t0: 0.1, animation: 'pop', animationOut: 'fade' },
        { kind: 'sticker', emoji: '🔔', cx: 0.5 + w / 2 + 0.02, cy: y, size: bell, t0: 0.35, animIn: 'pop', animLoop: 'swing' },
      ];
    },
  },
  {
    id: 'cta-link-bio', name: 'CTA · Link na bio', kind: 'motion', category: 'cta', duration: 3,
    description: 'Pílula branca “Link na bio” com seta apontando.',
    params: [P('texto', 'Texto', 'Link na bio')],
    build: (v, f) => {
      const st = ts({ fontFamily: 'Plus Jakarta Sans', fontWeight: 800, fontSize: 58, color: f.brand.dark });
      const w = f.textW(`🔗 ${v.texto}`, st) + 0.1;
      const y = f.portrait ? 0.68 : 0.72;
      return [
        { kind: 'shape', shape: 'line', fill: '#FFFFFF', box: { cx: 0.5, cy: y, w, h: fy(58) * 1.9 }, animIn: 'slide-up', animOut: 'fade' },
        { kind: 'text', text: `🔗 ${v.texto}`, style: st, x: 0.5, y, t0: 0.15, animation: 'fade', animationOut: 'fade' },
        { kind: 'sticker', emoji: '👇', cx: 0.5, cy: y + fy(58) * 2.2, size: 0.09, t0: 0.4, animIn: 'pop', animLoop: 'bounce' },
      ];
    },
  },
  {
    id: 'cta-comente', name: 'CTA · Comente', kind: 'motion', category: 'cta', duration: 3.5,
    description: 'Balão de fala pedindo um comentário.',
    params: [P('texto', 'Texto', 'Comente “EU QUERO”')],
    build: (v, f) => {
      const st = ts({ fontFamily: 'Poppins', fontWeight: 800, fontSize: 56, color: f.brand.dark });
      const w = Math.min(0.9, f.textW(v.texto, st) + 0.14);
      const h = (w * f.W) / 1.9 / f.H;
      const y = f.portrait ? 0.66 : 0.7;
      return [
        { kind: 'shape', shape: 'speech-bubble', fill: '#FFFFFF', box: { cx: 0.5, cy: y, w, h }, animIn: 'pop', animOut: 'zoom-out', animLoop: 'swing' },
        { kind: 'text', text: v.texto, style: st, x: 0.5, y: y - h * 0.08, t0: 0.15, animation: 'pop', animationOut: 'fade' },
        { kind: 'sticker', emoji: '💬', cx: 0.5 - w / 2 + 0.02, cy: y - h / 2, size: 0.09, t0: 0.35, animIn: 'pop', animLoop: 'bounce' },
      ];
    },
  },

  /* ===== informação ===== */
  {
    id: 'contador', name: 'Contagem regressiva', kind: 'motion', category: 'info', duration: 4,
    description: 'Números em sequência dentro de um anel, com “JÁ!” no fim.',
    params: [N('de', 'Começar de', 3), P('final', 'Texto final', 'JÁ!')],
    build: (v, f) => {
      const n = Math.max(1, Math.min(10, Math.round(Number(v.de) || 3)));
      const step = f.dur / (n + (v.final ? 1 : 0));
      const st = ts({ fontFamily: 'Anton', fontWeight: 400, fontSize: 300, color: '#FFFFFF', shadow: true });
      const ring = 0.42;
      const pieces: Piece[] = [
        { kind: 'shape', shape: 'circle', fill: 'rgba(0,0,0,.35)', stroke: f.brand.primary, strokeWidth: 10, box: { cx: 0.5, cy: 0.5, w: ring * f.short / f.W, h: ring * f.short / f.H }, animIn: 'zoom-in', animOut: 'fade', animLoop: 'zoom-in' },
      ];
      for (let i = 0; i < n; i++) {
        pieces.push({ kind: 'text', text: String(n - i), style: st, x: 0.5, y: 0.5, t0: i * step, dur: step, animation: 'stomp' });
      }
      if (v.final) pieces.push({ kind: 'text', text: v.final, style: { ...st, fontSize: 200, color: f.brand.secondary }, x: 0.5, y: 0.5, t0: n * step, dur: step, animation: 'pop', animationLoop: 'shake' });
      return pieces;
    },
  },
  {
    id: 'preco-oferta', name: 'Preço / oferta', kind: 'motion', category: 'info', duration: 4,
    description: 'Preço grande, preço antigo e selo de desconto girando.',
    params: [P('preco', 'Preço', 'R$ 99,90'), P('antes', 'Preço antigo', 'de R$ 149,90'), P('selo', 'Selo', '-30%')],
    build: (v, f) => {
      const price = ts({ fontFamily: 'Archivo Black', fontWeight: 400, fontSize: 170, color: '#FFFFFF', strokeColor: '#000', strokeWidth: 6, shadow: true });
      const old = ts({ fontFamily: 'Montserrat', fontWeight: 700, fontSize: 52, color: 'rgba(255,255,255,.85)', shadowColor: 'rgba(0,0,0,.6)', shadowBlur: 10 });
      const y = 0.5;
      const pw = f.textW(v.preco, price);
      const seal = 0.24 * f.short;
      return [
        { kind: 'text', text: v.antes, style: old, x: 0.5, y: y - fy(170) * 0.75, animation: 'fade', animationOut: 'fade' },
        { kind: 'text', text: v.preco, style: price, x: 0.5, y, t0: 0.15, animation: 'stomp', animationOut: 'zoom', animationLoop: 'none' },
        { kind: 'shape', shape: 'star', fill: f.brand.secondary, box: { cx: Math.min(0.88, 0.5 + pw / 2), cy: y - fy(170) * 0.7, w: seal / f.W, h: seal / f.H }, t0: 0.45, animIn: 'spin', animLoop: 'swing', animOut: 'zoom-out' },
        { kind: 'text', text: v.selo, style: ts({ fontFamily: 'Anton', fontWeight: 400, fontSize: 64, color: f.brand.dark }), x: Math.min(0.88, 0.5 + pw / 2), y: y - fy(170) * 0.7, t0: 0.55, rotation: -10, animation: 'pop', animationOut: 'fade' },
      ];
    },
  },
  {
    id: 'lista-123', name: 'Lista 1-2-3', kind: 'motion', category: 'info', duration: 5,
    description: 'Três itens numerados aparecendo um de cada vez.',
    params: [P('item1', 'Item 1', 'Planeje o roteiro'), P('item2', 'Item 2', 'Grave em boa luz'), P('item3', 'Item 3', 'Edite com ritmo'), P('titulo', 'Título (opcional)', '3 DICAS')],
    build: (v, f) => {
      const items = [v.item1, v.item2, v.item3].filter((s) => s?.trim());
      const st = ts({ fontFamily: 'Poppins', fontWeight: 700, fontSize: 58, color: '#FFFFFF', align: 'left', shadowColor: 'rgba(0,0,0,.55)', shadowBlur: 14 });
      const num = ts({ fontFamily: 'Poppins', fontWeight: 900, fontSize: 52, color: '#FFFFFF' });
      const badge = fy(58) * 1.6; // altura (fração de H)
      const badgeW = (badge * f.H) / f.W;
      const left = mx(f) + 0.02;
      const gap = f.portrait ? 0.085 : 0.13;
      const y0 = 0.5 - ((items.length - 1) * gap) / 2 + (v.titulo ? 0.04 : 0);
      const pieces: Piece[] = [];
      if (v.titulo) pieces.push({ kind: 'text', text: v.titulo, x: 0.5, y: y0 - gap * 1.1, style: ts({ fontFamily: 'Anton', fontWeight: 400, fontSize: 96, color: f.brand.secondary, uppercase: true, shadow: true }), animation: 'pop', animationOut: 'fade' });
      items.forEach((it, i) => {
        const t0 = 0.3 + i * 0.6;
        const y = y0 + i * gap;
        pieces.push({ kind: 'shape', shape: 'circle', fill: f.brand.primary, box: { cx: left + badgeW / 2, cy: y, w: badgeW, h: badge }, t0, animIn: 'pop', animOut: 'fade' });
        pieces.push({ kind: 'text', text: String(i + 1), style: num, x: left + badgeW / 2, y, t0: t0 + 0.05, animation: 'pop', animationOut: 'fade' });
        pieces.push({ kind: 'text', text: it, style: st, x: leftX(f, left + badgeW + 0.03, it, st), y, t0: t0 + 0.1, animation: 'slide-right', animationOut: 'fade' });
      });
      return pieces;
    },
  },
  {
    id: 'barra-progresso', name: 'Barra de progresso', kind: 'motion', category: 'info', duration: 6,
    description: 'Barra segmentada que se preenche com o tempo e marcador.',
    params: [N('segmentos', 'Segmentos', 10), P('rotulo', 'Rótulo (opcional)', '')],
    build: (v, f) => {
      const n = Math.max(3, Math.min(20, Math.round(Number(v.segmentos) || 10)));
      const total = 0.84;
      const left = (1 - total) / 2;
      const y = f.portrait ? 0.06 : 0.07;
      const h = f.portrait ? 0.008 : 0.014;
      const gap = 0.006;
      const seg = (total - gap * (n - 1)) / n;
      const pieces: Piece[] = [
        { kind: 'shape', shape: 'line', fill: 'rgba(255,255,255,.28)', box: { cx: 0.5, cy: y, w: total, h }, animIn: 'fade', animOut: 'fade', label: 'Trilho' },
      ];
      for (let i = 0; i < n; i++) {
        const t0 = (i * f.dur) / n;
        pieces.push({ kind: 'shape', shape: 'line', fill: f.brand.primary, box: { cx: left + seg / 2 + i * (seg + gap), cy: y, w: seg, h }, t0, animIn: 'fade', animInDur: Math.min(0.3, f.dur / n), label: `Segmento ${i + 1}` });
      }
      if (v.rotulo) pieces.push({ kind: 'text', text: v.rotulo, x: 0.5, y: y + 0.035, style: ts({ fontFamily: 'Inter', fontWeight: 700, fontSize: 36, color: '#FFFFFF', shadowColor: 'rgba(0,0,0,.6)', shadowBlur: 10 }), animation: 'fade', animationOut: 'fade' });
      return pieces;
    },
  },
  {
    id: 'antes-depois', name: 'Antes / depois', kind: 'motion', category: 'info', duration: 4,
    description: 'Divisória no meio e etiquetas “ANTES” e “DEPOIS”.',
    params: [P('antes', 'Etiqueta 1', 'ANTES'), P('depois', 'Etiqueta 2', 'DEPOIS')],
    build: (v, f) => {
      const tag = (bg: string, color: string) => ts({ fontFamily: 'Montserrat', fontWeight: 900, fontSize: 48, color, uppercase: true, background: bg, backgroundRadius: 40, backgroundPadding: 14, letterSpacing: 3 });
      if (f.portrait) {
        return [
          { kind: 'shape', shape: 'rect', fill: '#FFFFFF', box: { cx: 0.5, cy: 0.5, w: 1.02, h: 0.005 }, animIn: 'slide-right', animOut: 'fade' },
          { kind: 'text', text: v.antes, style: tag('rgba(0,0,0,.7)', '#FFFFFF'), x: 0.5, y: 0.08, t0: 0.2, animation: 'pop', animationOut: 'fade' },
          { kind: 'text', text: v.depois, style: tag(f.brand.primary, '#FFFFFF'), x: 0.5, y: 0.58, t0: 0.35, animation: 'pop', animationOut: 'fade' },
        ];
      }
      return [
        { kind: 'shape', shape: 'rect', fill: '#FFFFFF', box: { cx: 0.5, cy: 0.5, w: 0.004, h: 1.02 }, animIn: 'slide-down', animOut: 'fade' },
        { kind: 'text', text: v.antes, style: tag('rgba(0,0,0,.7)', '#FFFFFF'), x: 0.25, y: 0.1, t0: 0.2, animation: 'pop', animationOut: 'fade' },
        { kind: 'text', text: v.depois, style: tag(f.brand.primary, '#FFFFFF'), x: 0.75, y: 0.1, t0: 0.35, animation: 'pop', animationOut: 'fade' },
      ];
    },
  },

  /* ===== marca ===== */
  {
    id: 'marca-dagua', name: 'Marca d’água', kind: 'motion', category: 'marca', duration: 10, fullLength: true,
    description: 'Seu @ discreto no canto durante o vídeo inteiro.',
    params: [P('texto', 'Texto', '@seuperfil')],
    build: (v, f) => {
      const st = ts({ fontFamily: 'Plus Jakarta Sans', fontWeight: 700, fontSize: 40, color: '#FFFFFF', opacity: 0.6, align: 'right', shadowColor: 'rgba(0,0,0,.45)', shadowBlur: 8 });
      const w = f.textW(v.texto, st);
      const dot = fy(40) * 0.55;
      const dotW = (dot * f.H) / f.W;
      const right = 1 - (f.portrait ? 0.06 : 0.04);
      const y = f.portrait ? 0.9 : 0.92;
      return [
        { kind: 'shape', shape: 'circle', fill: f.brand.primary, opacity: 0.75, box: { cx: right - w - 0.012 - dotW / 2, cy: y, w: dotW, h: dot }, animIn: 'fade', label: 'Marca' },
        { kind: 'text', text: v.texto, style: st, x: right - w / 2, y, animation: 'fade', label: 'Marca d’água' },
      ];
    },
  },
];

const BY_ID = new Map(TEMPLATES.map((t) => [t.id, t]));

export function templateDef(id: string): TemplateDef | undefined {
  return BY_ID.get(id);
}

export function templatesOf(kind: TemplateKind): TemplateDef[] {
  return TEMPLATES.filter((t) => t.kind === kind);
}

export function defaultValues(def: TemplateDef): Record<string, string> {
  return Object.fromEntries(def.params.map((p) => [p.key, p.default]));
}

/* ---------- montagem em EditOps ---------- */

/** peças -> clipes (ids novos, mesmo groupId) e trilhas necessárias */
export function assembleTemplate(def: TemplateDef, pieces: Piece[], ctx: TemplateContext, frame: Frame): EditOp[] {
  const p = ctx.project;
  const at = def.fullLength ? 0 : Math.max(0, ctx.at ?? 0);
  const dur = frame.dur;
  const groupId = ctx.groupId ?? uid('grp');
  const needs = { text: pieces.some((x) => x.kind === 'text'), overlay: pieces.some((x) => x.kind !== 'text') };
  const { ops, textTrackId, overlayTrackId } = templateTracks(p, at, at + dur, needs);
  const label = def.name;
  for (const piece of pieces) {
    const t0 = Math.max(0, Math.min(dur - 0.05, piece.t0 ?? 0));
    const d = Math.max(0.05, Math.min(piece.dur ?? dur - t0, dur - t0));
    const base = { id: uid('clip'), groupId, start: at + t0, duration: d, label: piece.label ?? label };
    if (piece.kind === 'text') {
      const clip: TextClip = {
        ...base,
        type: 'text',
        text: piece.text,
        style: { ...DEFAULT_TEXT_STYLE, highlightColor: frame.brand.secondary, ...piece.style } as TextStyle,
        position: { x: piece.x, y: piece.y },
        animation: piece.animation ?? 'fade',
        ...(piece.animationOut ? { animationOut: piece.animationOut } : {}),
        ...(piece.animationLoop && piece.animationLoop !== 'none' ? { animationLoop: piece.animationLoop } : {}),
        ...(piece.rotation ? { rotation: piece.rotation } : {}),
        ...(piece.keyframes ? { keyframes: piece.keyframes } : {}),
        templateId: def.id,
      };
      ops.push({ op: 'add_clip', trackId: textTrackId, clip });
    } else if (piece.kind === 'shape') {
      const g = shapeGeometry(piece.box, piece.shape, frame.W, frame.H);
      const hPx = (g.rotate90 ? piece.box.w * frame.W : piece.box.h * frame.H);
      const clip: ShapeClip = {
        ...base,
        type: 'shape',
        shape: piece.shape,
        fill: piece.fill,
        ...(piece.stroke ? { stroke: piece.stroke, strokeWidth: piece.strokeWidth ?? 2 } : {}),
        ...(piece.radiusPx !== undefined ? { cornerRadius: Math.min(100, (200 * piece.radiusPx) / Math.max(1, hPx)) } : {}),
        ...(g.aspect ? { aspect: g.aspect } : {}),
        transform: { ...g.transform, opacity: piece.opacity ?? 1, rotation: g.transform.rotation + (piece.rotation ?? 0) },
        ...(piece.animIn ? { animationIn: { kind: piece.animIn, duration: piece.animInDur ?? 0.4 } } : {}),
        ...(piece.animOut ? { animationOut: { kind: piece.animOut, duration: 0.3 } } : {}),
        ...(piece.animLoop ? { animationLoop: { kind: piece.animLoop, duration: 1.2 } } : {}),
        ...(piece.keyframes ? { keyframes: piece.keyframes } : {}),
      };
      ops.push({ op: 'add_clip', trackId: overlayTrackId, clip });
    } else {
      const clip: StickerClip = {
        ...base,
        type: 'sticker',
        emoji: piece.emoji,
        transform: { ...DEFAULT_TRANSFORM, x: piece.cx - 0.5, y: piece.cy - 0.5, scale: piece.size / 0.95, rotation: piece.rotation ?? 0 },
        ...(piece.animIn ? { animationIn: { kind: piece.animIn, duration: 0.35 } } : {}),
        ...(piece.animOut ? { animationOut: { kind: piece.animOut, duration: 0.3 } } : {}),
        ...(piece.animLoop ? { animationLoop: { kind: piece.animLoop, duration: 1 } } : {}),
      };
      ops.push({ op: 'add_clip', trackId: overlayTrackId, clip });
    }
  }
  const i = ops.findIndex((o) => o.op === 'add_clip');
  if (i >= 0) ops[i] = { ...ops[i], explain: `Inserindo modelo “${def.name}”` };
  return ops;
}

/**
 * Gera as EditOps de um modelo. `values` sobrepõe os parâmetros padrão.
 * Ex.: dispatch(buildTemplate('lt-caixa', { nome: 'Bruno' }, { project, at: playhead }))
 */
export function buildTemplate(id: string, values: Record<string, string | number> = {}, ctx: TemplateContext): EditOp[] {
  const def = templateDef(id);
  if (!def) return [];
  const v: Record<string, string> = { ...defaultValues(def) };
  for (const [k, val] of Object.entries(values)) if (val !== undefined && val !== null) v[k] = String(val);
  const dur = def.fullLength ? Math.max(projectDuration(ctx.project), 5) : Math.max(0.5, ctx.duration ?? def.duration);
  const frame = makeFrame(ctx, dur);
  return assembleTemplate(def, def.build(v, frame), ctx, frame);
}

/** famílias de fonte usadas por um modelo (p/ carregar antes da prévia) */
export function templateFonts(id: string, project: Project): string[] {
  const def = templateDef(id);
  if (!def) return [];
  const frame = makeFrame({ project }, def.duration);
  const set = new Set<string>();
  for (const piece of def.build(defaultValues(def), frame)) if (piece.kind === 'text' && piece.style.fontFamily) set.add(piece.style.fontFamily);
  return [...set];
}
