/* =====================================================================
   EditorPro — contrato de dados compartilhado (fonte da verdade).
   TODOS os módulos (timeline, engine, export, IA, painéis) falam este
   formato. Mudanças aqui devem ser ADITIVAS (campos opcionais novos);
   nunca renomeie/remova campo sem combinar com a sessão principal.
   Tempo sempre em SEGUNDOS (number, float). Coordenadas normalizadas 0..1.
   ===================================================================== */

export type Seconds = number;
export type Id = string;

export type AspectRatio = '9:16' | '16:9' | '1:1' | '4:5';

export const ASPECT_SIZES: Record<AspectRatio, { width: number; height: number }> = {
  '9:16': { width: 1080, height: 1920 },
  '16:9': { width: 1920, height: 1080 },
  '1:1': { width: 1080, height: 1080 },
  '4:5': { width: 1080, height: 1350 },
};

/* ---------- mídia ---------- */

export type MediaKind = 'video' | 'audio' | 'image';
/** source = material bruto do usuário; reference = vídeo-exemplo de estilo; music = trilha */
export type MediaRole = 'source' | 'reference' | 'music' | 'broll'
  /* (aditivo 2026-11-19, "IA sem limites") gráfico desenhado pela IA (SVG rasterizado) */
  | 'graphic';

export interface MediaAsset {
  id: Id;
  kind: MediaKind;
  role: MediaRole;
  name: string;
  mime: string;
  size: number; // bytes
  duration: Seconds; // 0 para imagem
  width?: number;
  height?: number;
  /** object URL em runtime (não persiste; recriado a partir do Blob no IndexedDB) */
  url?: string;
  /** miniaturas (data URLs) espaçadas uniformemente, p/ timeline */
  thumbnails?: string[];
  /** picos de áudio normalizados 0..1 (p/ waveform), ~100 por segundo no máximo */
  waveform?: number[];
  /** referência do arquivo já enviado ao provedor de IA (opcional; não usado com Claude) */
  aiFileUri?: string;
  aiFileMime?: string;
  /** batidas detectadas na música (segundos da mídia) — p/ sincronizar cortes */
  beats?: number[];
  /** veio da biblioteca embutida (stickers, formas, sons) e não do usuário */
  library?: boolean;
  /** cópia leve (540–720p) usada só no PREVIEW; a original fica para o export */
  proxyUrl?: string;
  /** estado da geração do proxy */
  proxyStatus?: 'pending' | 'ready' | 'failed';
  /** (aditivo, "IA sem limites") código SVG de origem de um gráfico gerado pela IA (role 'graphic'); a imagem é a rasterização dele */
  svg?: string;
}

/* ---------- efeitos ---------- */

export type FilterKind =
  | 'brightness' | 'contrast' | 'saturation' | 'temperature'
  | 'blur' | 'vignette' | 'grain' | 'bw' | 'sepia'
  | 'exposure' | 'highlights' | 'shadows' | 'tint' | 'hue' | 'sharpen' | 'fade';

export interface Filter {
  kind: FilterKind;
  /** -1..1 para ajustes (0 = neutro); 0..1 para intensidade de efeitos */
  value: number;
}

/** LUTs/predefinições prontas (engine traduz para Filter[]) */
export type ColorPreset = 'none' | 'cinematic' | 'warm' | 'cool' | 'vibrant' | 'vintage' | 'bw' | 'moody';

/* ---------- correção de cor estilo DaVinci (aditivo 2026-11-19; motor em lib/color, sessão "cor") ---------- */

/** roda de cor: deslocamento por canal + mestre (luminância), todos -1..1 (0 = neutro) */
export interface ColorWheel { r: number; g: number; b: number; y: number }
/** ponto de curva normalizado 0..1 (x = entrada, y = saída) */
export interface CurvePoint { x: number; y: number }
/** faixas de cor do HSL secundário */
export type HslBand = 'red' | 'orange' | 'yellow' | 'green' | 'aqua' | 'blue' | 'purple' | 'magenta';
export interface HslAdjust { hue: number; sat: number; lum: number } // -1..1

export interface ColorGrade {
  /** primárias: lift (sombras), gamma (médios), gain (altas luzes), offset (geral) */
  lift?: ColorWheel;
  gamma?: ColorWheel;
  gain?: ColorWheel;
  offset?: ColorWheel;
  /** ajustes globais -1..1 (0 = neutro) */
  exposure?: number;
  contrast?: number;
  /** pivô do contraste 0..1 (padrão 0.435, como no DaVinci) */
  pivot?: number;
  saturation?: number;
  vibrance?: number;
  temperature?: number;
  tint?: number;
  highlights?: number;
  shadows?: number;
  /** curvas (lista ordenada por x; ausente = identidade) */
  curves?: { master?: CurvePoint[]; r?: CurvePoint[]; g?: CurvePoint[]; b?: CurvePoint[] };
  /** HSL secundário por faixa de cor */
  hsl?: Partial<Record<HslBand, HslAdjust>>;
  /** LUT 3D (.cube importada ou embutida): id resolvido por lib/color; intensidade 0..1 */
  lut?: { id: string; intensity: number };
  /** mistura da correção inteira com o original 0..1 (padrão 1) */
  mix?: number;
}

export type TransitionKind =
  | 'cut' | 'fade' | 'crossfade' | 'slide-left' | 'slide-right' | 'slide-up'
  | 'zoom-in' | 'zoom-out' | 'whip' | 'glitch' | 'flash'
  | 'slide-down' | 'dip-black' | 'dip-white' | 'blur' | 'spin' | 'wipe-left' | 'wipe-right'
  | 'wipe-up' | 'circle-open' | 'pixelate' | 'shake' | 'rgb-split' | 'film-burn'
  /* transições em shader WebGL (portadas do HyperFrames, Apache-2.0) */
  | 'domain-warp' | 'ridged-burn' | 'whip-pan' | 'sdf-iris' | 'ripple-waves' | 'gravitational-lens'
  | 'cinematic-zoom' | 'chromatic-split' | 'digital-glitch' | 'swirl-vortex' | 'thermal-distortion'
  | 'flash-through-white' | 'cross-warp-morph' | 'light-leak'
  /* (aditivo 2026-11-19, sessão fx) — CSS/canvas */
  | 'push-left' | 'push-right' | 'push-up' | 'push-down' | 'cover-left' | 'cover-right' | 'cover-up' | 'cover-down'
  | 'slide-blur-left' | 'slide-blur-right'
  /* (aditivo 2026-11-19, sessão fx) — shader WebGL próprio (lib/fx/transitionShaders.ts) */
  | 'cube-left' | 'cube-right' | 'cube-up' | 'flip-x' | 'flip-y' | 'page-curl' | 'doors-open' | 'doors-close'
  | 'blinds-h' | 'blinds-v' | 'luma-star' | 'luma-heart' | 'luma-diagonal' | 'luma-clock' | 'noise-dissolve'
  | 'zoom-blur' | 'spin-blur' | 'stretch' | 'ink' | 'smoke' | 'mosaic' | 'pixel-sort' | 'glitch-2' | 'camera-flash'
  | 'whip-left' | 'whip-right' | 'whip-up' | 'whip-down' | 'uncover-left' | 'uncover-up' | 'iris-close' | 'diamond'
  | 'wind' | 'wave' | 'burn-2' | 'flare' | 'swirl' | 'split-open' | 'shutter' | 'checkerboard' | 'squares'
  | 'polka' | 'film-roll' | 'tv-off' | 'kaleido' | 'dreamy' | 'zoom-rotate' | 'squeeze' | 'luma-melt'
  /* (aditivo, "IA sem limites") transição escrita pela IA em GLSL — ver Transition.code */
  | 'custom';

/** efeitos visuais aplicados ao clipe (ou a uma camada de ajuste) */
export type VisualEffectKind =
  | 'shake' | 'glitch' | 'rgb-split' | 'zoom-pulse' | 'vhs' | 'film-grain' | 'light-leak'
  | 'pixelate' | 'mirror' | 'kaleidoscope' | 'blur-motion' | 'flash-strobe' | 'old-film'
  | 'vignette-pulse' | 'sparkle' | 'soft-glow' | 'neon-edge' | 'black-bars'
  /* (aditivo 2026-11-19, sessão fx — catálogo em lib/fx/catalog.ts) */
  | 'zoom-punch' | 'zoom-slow' | 'handheld' | 'shake-3d' | 'beat-pulse'
  | 'blur-gauss' | 'blur-directional' | 'blur-radial' | 'blur-zoom' | 'tilt-shift' | 'focus-center'
  | 'fisheye' | 'bulge' | 'pinch' | 'swirl' | 'waves' | 'heat-haze' | 'ripple' | 'kaleidoscope-6'
  | 'glitch-digital' | 'datamosh' | 'chromatic-aberration' | 'rgb-wave' | 'pixel-sort'
  | 'crt' | 'vhs-2' | 'film-8mm' | 'dust-scratches' | 'night-vision'
  | 'bloom' | 'neon-glow' | 'light-leak-2' | 'light-leak-3' | 'lens-flare' | 'bokeh' | 'light-sweep'
  | 'cartoon' | 'sketch' | 'halftone' | 'duotone' | 'posterize' | 'ascii' | 'pixel-art' | 'outline' | 'thermal'
  | 'invert' | 'rainbow'
  | 'mirror-4' | 'mirror-vertical' | 'split-2' | 'split-3' | 'split-4' | 'split-9' | 'echo-trail'
  | 'strobe-color' | 'flash-black' | 'freeze-flash'
  | 'snow' | 'rain' | 'confetti' | 'hearts' | 'bubbles' | 'fireflies' | 'embers'
  | 'frame-border' | 'polaroid' | 'film-frame' | 'cinema-bars-anim' | 'vignette' | 'rounded-frame' | 'drop-shadow'
  | 'disco' | 'countdown'
  /* (aditivo, "IA sem limites") efeito escrito pela IA em GLSL — ver VisualEffect.code */
  | 'custom';

export interface VisualEffect {
  kind: VisualEffectKind;
  intensity: number; // 0..1
  speed?: number; // 0..2 (1 = normal)
  /** (aditivo, fx) cor do efeito ('#RRGGBB') — neon, duotone, moldura, contorno… */
  color?: string;
  /** (aditivo, fx) direção em graus (0 = →, 90 = ↓) — desfoque direcional, chuva, vazamento */
  angle?: number;
  /**
   * (aditivo, "IA sem limites") kind 'custom': corpo GLSL ES 1.00 com `vec4 effect(vec2 uv)`.
   * Uniforms prontos: uTex (quadro do clipe; na camada de ajuste = tudo abaixo), uResolution (px),
   * uTime (s desde o início do clipe), uDuration, uProgress (0..1 no clipe), uIntensity, uSpeed,
   * uColor (vec3 de `color`), uParams[8] (de `params`). Helpers: rand, noise, fbm, luma, rgb2hsv, hsv2rgb.
   * Não compila → o efeito vira passagem direta (nunca tela preta). Contrato em lib/fx/customShader.ts.
   */
  code?: string;
  /** (aditivo) nome legível do efeito personalizado ("Ondas neon") — aparece nos painéis */
  name?: string;
  /** (aditivo) até 8 parâmetros numéricos para uParams[0..7] */
  params?: number[];
}

export type BlendMode = 'normal' | 'multiply' | 'screen' | 'overlay' | 'darken' | 'lighten' | 'add' | 'difference'
  /* (aditivo 2026-11-19, sessão fx) */
  | 'soft-light' | 'hard-light' | 'color-dodge' | 'color-burn' | 'exclusion' | 'hue' | 'saturation' | 'color' | 'luminosity';

export type MaskShape = 'rect' | 'circle' | 'heart' | 'star' | 'line' | 'mirror'
  /* (aditivo 2026-11-19, sessão fx) gradiente linear, radial, retângulo arredondado, losango, texto */
  | 'linear' | 'radial' | 'rounded-rect' | 'diamond' | 'text';

/** (aditivo, fx) keyframe de máscara relativo ao início do clipe (Power Window animada) */
export interface MaskKeyframe {
  t: Seconds;
  x?: number; y?: number; w?: number; h?: number; rotation?: number; feather?: number;
  easing?: Easing;
}

export interface Mask {
  shape: MaskShape;
  /** centro/tamanho normalizados ao quadro */
  x: number; y: number; w: number; h: number;
  rotation: number;
  feather: number; // 0..1
  invert?: boolean;
  /** (aditivo, fx) raio dos cantos do 'rounded-rect' (0..1 do lado menor) */
  radius?: number;
  /** (aditivo, fx) texto da máscara 'text' */
  text?: string;
  /** (aditivo, fx) animação da máscara */
  keyframes?: MaskKeyframe[];
}

export interface ChromaKey {
  color: string; // '#00FF00'
  similarity: number; // 0..1
  smoothness: number; // 0..1
}

/** recorte em coordenadas normalizadas da MÍDIA (0..1) */
export interface Crop { x: number; y: number; w: number; h: number }

export type FitMode = 'cover' | 'contain' | 'fill';

/** curva de velocidade (CapCut: montagem, herói, bala, flash in/out) — pontos t 0..1 relativos ao clipe */
export interface SpeedPoint { t: number; speed: number }
export type SpeedPreset = 'montage' | 'hero' | 'bullet' | 'jump-cut' | 'flash-in' | 'flash-out';

export type AudioEffectKind =
  | 'noise-reduction' | 'normalize' | 'voice-enhance' | 'chipmunk' | 'deep' | 'robot'
  | 'echo' | 'reverb' | 'telephone' | 'megaphone' | 'bass-boost';

export interface AudioEffect { kind: AudioEffectKind; amount: number /* 0..1 */ }

export interface Transition {
  kind: TransitionKind;
  duration: Seconds; // tipicamente 0.2–0.8
  /** (aditivo, fx) curva aplicada ao progresso (ausente = curva própria da transição) */
  easing?: Easing;
  /**
   * (aditivo, "IA sem limites") kind 'custom': corpo GLSL ES 1.00 com `vec4 transition(vec2 uv)`.
   * Uniforms: uFrom, uTo (quadros que saem/entram), uProgress (0..1, já com easing), uResolution, uTime,
   * uParams[8]. Helpers iguais aos do efeito. Não compila → crossfade.
   */
  code?: string;
  name?: string;
  params?: number[];
}

export interface Transform {
  x: number; // deslocamento normalizado (-1..1), 0 = centro
  y: number;
  scale: number; // 1 = encaixa ("cover") no quadro
  rotation: number; // graus
  opacity: number; // 0..1
}

export const DEFAULT_TRANSFORM: Transform = { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 };

export type Easing = 'linear' | 'easeIn' | 'easeOut' | 'easeInOut';

/** keyframe de transform relativo ao início do clipe */
export interface Keyframe {
  t: Seconds; // relativo ao início do clipe
  transform: Partial<Transform>;
  easing?: Easing;
  /**
   * (aditivo, "IA sem limites") keyframe de QUALQUER propriedade numérica ou de cor do clipe, por caminho:
   * 'volume', 'style.fontSize', 'style.color', 'effects.0.intensity', 'colorGrade.saturation',
   * 'filters.brightness', 'mask.feather', 'position.x', 'speed'… Números interpolam; cores '#RRGGBB'
   * interpolam em RGB; o resto troca no keyframe. Resolvido por lib/engine/animate.ts (preview e export).
   */
  props?: Record<string, number | string>;
}

/* ---------- clipes ---------- */

interface BaseClip {
  id: Id;
  /** clipes de um mesmo modelo (lower third, CTA…) compartilham o groupId e se movem juntos */
  groupId?: Id;
  /** (aditivo, timeline) vínculo áudio↔vídeo estilo DaVinci: clipes com o mesmo linkId movem e aparam juntos */
  linkId?: Id;
  /** posição na timeline */
  start: Seconds;
  /** duração NA TIMELINE (já considerando speed) */
  duration: Seconds;
  /** rótulo livre (IA usa p/ explicar: "gancho", "CTA"...) */
  label?: string;
  locked?: boolean;
}

/** campos visuais comuns a vídeo/imagem/sticker (todos opcionais) */
export interface VisualExtras {
  fit?: FitMode; // padrão 'cover'
  crop?: Crop;
  flipH?: boolean;
  flipV?: boolean;
  blendMode?: BlendMode;
  mask?: Mask;
  chromaKey?: ChromaKey;
  effects?: VisualEffect[];
  /** recorta a pessoa do fundo (segmentação no navegador) */
  removeBackground?: boolean;
  animationIn?: { kind: ClipAnimation; duration: Seconds };
  animationOut?: { kind: ClipAnimation; duration: Seconds };
  animationLoop?: { kind: ClipAnimation; duration: Seconds };
}

export type ClipAnimation =
  | 'fade' | 'zoom-in' | 'zoom-out' | 'slide-left' | 'slide-right' | 'slide-up' | 'slide-down'
  | 'spin' | 'bounce' | 'pop' | 'shake' | 'swing' | 'blur' | 'flip'
  /* (aditivo 2026-11-19, sessão fx — lib/fx/clipAnimations.ts) */
  | 'rotate-3d' | 'pulse' | 'breathe' | 'wiggle' | 'slide-blur-left' | 'slide-blur-right' | 'slide-blur-up'
  | 'spin-zoom' | 'drop' | 'elastic' | 'rise' | 'roll' | 'zoom-blur' | 'heartbeat' | 'float' | 'pendulum'
  | 'tilt' | 'squash' | 'whirl' | 'jelly';

/** campos de áudio comuns a vídeo/áudio */
export interface AudioExtras {
  audioEffects?: AudioEffect[];
  /** semitons (-12..12), mantendo a duração */
  pitch?: number;
  /** congela/reproduz ao contrário */
  reverse?: boolean;
  speedCurve?: SpeedPoint[];
  speedPreset?: SpeedPreset;
}

export interface VideoClip extends BaseClip, VisualExtras, AudioExtras {
  type: 'video';
  assetId: Id;
  /** ponto de entrada na mídia de origem */
  in: Seconds;
  speed: number; // 1 = normal
  volume: number; // 0..2 (1 = original)
  muted?: boolean;
  transform: Transform;
  keyframes?: Keyframe[];
  filters: Filter[];
  colorPreset?: ColorPreset;
  /** correção de cor estilo DaVinci (aplicada depois dos filtros/preset) */
  colorGrade?: ColorGrade;
  /** transição na ENTRADA deste clipe (vinda do clipe anterior da mesma trilha) */
  transitionIn?: Transition;
  fadeIn?: Seconds;
  fadeOut?: Seconds;
}

export interface ImageClip extends BaseClip, VisualExtras {
  type: 'image';
  assetId: Id;
  transform: Transform;
  keyframes?: Keyframe[]; // ex.: Ken Burns
  filters: Filter[];
  /** (aditivo, sessão shell) predefinição de cor também em imagens */
  colorPreset?: ColorPreset;
  colorGrade?: ColorGrade;
  transitionIn?: Transition;
}

export interface AudioClip extends BaseClip, AudioExtras {
  type: 'audio';
  assetId: Id;
  in: Seconds;
  speed: number;
  volume: number;
  fadeIn?: Seconds;
  fadeOut?: Seconds;
  /** abaixa automaticamente quando há fala (ducking) */
  duckUnderVoice?: boolean;
  /** (aditivo, "IA sem limites") automação (ex.: props.volume) — só `props` vale em áudio */
  keyframes?: Keyframe[];
}

export type TextAnimation =
  | 'none' | 'fade' | 'pop' | 'slide-up' | 'typewriter' | 'bounce' | 'karaoke'
  | 'slide-down' | 'slide-left' | 'slide-right' | 'zoom' | 'blur' | 'wave' | 'glitch' | 'flicker' | 'spin'
  /* por palavra / por letra (biblioteca profissional) */
  | 'word-pop' | 'word-fade' | 'word-slide' | 'word-bounce' | 'word-drop' | 'word-highlight'
  | 'char-wave' | 'char-fade' | 'char-pop' | 'char-typewriter'
  | 'scale-in' | 'blur-in' | 'stomp' | 'drop' | 'highlight-sweep' | 'underline-draw' | 'box-reveal' | 'shake';

export interface TextStyle {
  fontFamily: string;
  fontSize: number; // px relativos a altura 1920 (engine escala)
  fontWeight: number;
  color: string;
  /** cor de destaque (palavra ativa no karaokê / ênfase) */
  highlightColor?: string;
  strokeColor?: string;
  strokeWidth?: number;
  background?: string; // caixa atrás do texto ('' = nenhuma)
  shadow?: boolean;
  uppercase?: boolean;
  align: 'left' | 'center' | 'right';
  italic?: boolean;
  underline?: boolean;
  letterSpacing?: number; // em px (base 1920)
  lineHeight?: number; // multiplicador (1.2)
  /** gradiente no preenchimento (sobrepõe color) */
  gradient?: { from: string; to: string; angle: number };
  /** raio da caixa de fundo (px) */
  backgroundRadius?: number;
  opacity?: number;
  /** sombra detalhada (sobrepõe `shadow` simples) */
  shadowColor?: string;
  shadowBlur?: number; // px (base 1920)
  shadowOffset?: { x: number; y: number };
  /** brilho externo (neon) */
  glow?: { color: string; blur: number };
  /** padding da caixa de fundo (px, base 1920) */
  backgroundPadding?: number;
  /* ---- (aditivo, biblioteca) texto avançado ---- */
  /** contornos extras por fora do principal (px base 1920), do mais interno ao mais externo */
  strokes?: { color: string; width: number }[];
  /** sombra longa sólida (estilo flat), comprimento em px base 1920, ângulo em graus (45 = baixo-direita) */
  longShadow?: { color: string; length: number; angle?: number };
  /** extrusão 3D (camadas empilhadas), profundidade em px base 1920 */
  extrude?: { color: string; depth: number; angle?: number };
  /** texto curvo: graus de arco da linha (−360..360; >0 = sorriso, <0 = arco p/ cima) */
  curve?: number;
  /** desfoque do vídeo atrás da caixa de fundo (px base 1920; efeito "vidro") */
  backgroundBlur?: number;
  /** linhas equilibradas (evita palavra órfã na última linha) */
  balance?: boolean;
}

export interface TextClip extends BaseClip {
  type: 'text';
  text: string;
  style: TextStyle;
  /** posição do centro do texto, normalizada 0..1 */
  position: { x: number; y: number };
  animation: TextAnimation;
  /** animação de saída e de loop (CapCut: entrada/saída/loop) */
  animationOut?: TextAnimation;
  animationLoop?: TextAnimation;
  rotation?: number;
  scale?: number;
  keyframes?: Keyframe[];
  /** id do modelo de texto usado (título, CTA, lower third...) */
  templateId?: string;
}

/** stickers/emoji/GIF (asset de imagem) ou emoji desenhado direto */
export interface StickerClip extends BaseClip, VisualExtras {
  type: 'sticker';
  assetId?: Id; // imagem/GIF da biblioteca ou do usuário
  emoji?: string; // alternativa: emoji nativo
  transform: Transform;
  keyframes?: Keyframe[];
}

export type ShapeKind = 'rect' | 'rounded-rect' | 'circle' | 'triangle' | 'star' | 'arrow' | 'line' | 'heart' | 'speech-bubble';

export interface ShapeClip extends BaseClip, VisualExtras {
  type: 'shape';
  shape: ShapeKind;
  fill: string;
  stroke?: string;
  strokeWidth?: number;
  cornerRadius?: number;
  /** (aditivo, biblioteca) proporção largura/altura da forma; sem isso o engine usa a natural (barras de lower third, pílulas de CTA) */
  aspect?: number;
  transform: Transform;
  keyframes?: Keyframe[];
}

/** camada de ajuste: aplica filtros/efeitos a tudo que está ABAIXO dela no intervalo */
export interface AdjustmentClip extends BaseClip {
  type: 'adjustment';
  filters: Filter[];
  colorPreset?: ColorPreset;
  /** correção de cor aplicada a tudo que está abaixo (camada de ajuste = "nó" global) */
  colorGrade?: ColorGrade;
  effects?: VisualEffect[];
}

export type Clip = VideoClip | ImageClip | AudioClip | TextClip | StickerClip | ShapeClip | AdjustmentClip;
export type ClipType = Clip['type'];

/* ---------- trilhas ---------- */

/** overlay = stickers/formas (picture-in-picture de vídeo pode ir em trilha 'video' extra); effect = camadas de ajuste */
export type TrackKind = 'video' | 'audio' | 'text' | 'overlay' | 'effect';

export interface Track {
  id: Id;
  kind: TrackKind;
  name: string;
  muted?: boolean;
  hidden?: boolean;
  locked?: boolean;
  /** (aditivo, timeline) solo: se alguma trilha estiver em solo, só elas tocam áudio */
  solo?: boolean;
  /** (aditivo, timeline) altura da linha na timeline (multiplicador 0.6..2.5; padrão automático) */
  height?: number;
  clips: Clip[]; // ordenados por start
}

/* ---------- legendas ---------- */

export interface CaptionWord {
  /** id estável da palavra ("w00012") — a IA ancora cortes em palavras, não em segundos */
  id?: string;
  start: Seconds; // tempo NA TIMELINE
  end: Seconds;
  text: string;
}

export interface CaptionSegment {
  id: Id;
  start: Seconds; // tempo NA TIMELINE
  end: Seconds;
  text: string;
  words?: CaptionWord[];
  /** palavras para destacar (ênfase) */
  emphasis?: string[];
}

/** presets embutidos + ids da biblioteca (web/lib/library/captions) */
export type CaptionPreset = 'classic' | 'bold-pop' | 'karaoke' | 'minimal' | 'boxed' | 'neon' | (string & {});

export interface CaptionStyle extends TextStyle {
  preset: CaptionPreset;
  position: { x: number; y: number };
  animation: TextAnimation;
  /** máximo de palavras visíveis por vez (estilo TikTok = 1–3) */
  maxWords: number;
  /** caixa atrás da PALAVRA ATIVA (estilo creator) */
  wordBox?: { color: string; radius: number; padding: number };
  /** escala da palavra ativa (1 = igual) */
  activeScale?: number;
  /** opacidade das palavras ainda não faladas (karaokê "acendendo") */
  inactiveOpacity?: number;
  /** emoji automático por palavra-chave (biblioteca decide o mapa) */
  autoEmoji?: boolean;
  /** número máximo de linhas visíveis */
  lines?: 1 | 2;
  /** rotação leve aleatória por bloco (estilo dinâmico), em graus */
  jitter?: number;
  /** (aditivo, biblioteca) ênfase automática de palavras-chave (números, valores, palavras fortes) */
  emphasis?: { auto: boolean; color?: string; scale?: number };
  /** (aditivo, biblioteca) mantém a legenda fora da interface do app (TikTok/Reels/Shorts/YouTube) */
  safeZone?: 'none' | 'tiktok' | 'reels' | 'shorts' | 'youtube';
}

export interface Captions {
  enabled: boolean;
  language: string; // 'pt-BR'
  segments: CaptionSegment[];
  style: CaptionStyle;
}

/* ---------- perfil de estilo (vindo do vídeo-exemplo) ---------- */

export interface StyleProfile {
  summary: string; // descrição em linguagem natural
  pacing: 'slow' | 'medium' | 'fast' | 'very-fast';
  avgShotLength: Seconds;
  aspect?: AspectRatio;
  captions?: Partial<CaptionStyle> & { present: boolean };
  transitions: TransitionKind[];
  colorPreset?: ColorPreset;
  zoomPunchIns: boolean; // zooms rápidos em frases-chave
  music?: { present: boolean; energy: 'low' | 'medium' | 'high'; genre?: string };
  textOverlays?: { present: boolean; examples?: string[] };
  hook?: string; // como o vídeo prende nos 3 primeiros segundos
  structure?: string[]; // ex.: ['gancho', 'problema', 'solução', 'CTA']
}

/* ---------- projeto ---------- */

export interface Project {
  id: Id;
  name: string;
  aspect: AspectRatio;
  width: number;
  height: number;
  fps: number;
  background: string; // cor de fundo
  tracks: Track[]; // ordem = camada (0 = fundo)
  captions: Captions;
  /** o que o usuário pediu (descrição inicial) */
  brief: string;
  referenceAssetId?: Id;
  /** fundo quando a mídia não preenche o quadro (CapCut: "Tela de fundo") */
  canvas?: { type: 'color' | 'blur' | 'image'; color?: string; blur?: number; assetId?: Id };
  markers?: Marker[];
  /** tempo do quadro usado como capa/thumbnail (CapCut: "Capa") */
  coverTime?: Seconds;
  style?: StyleProfile;
  createdAt: number;
  updatedAt: number;
}

/* ---------- chat ---------- */

export type ChatRole = 'user' | 'assistant' | 'system';

export interface ChatMessage {
  id: Id;
  role: ChatRole;
  text: string;
  createdAt: number;
  /** operações aplicadas por esta mensagem (para desfazer/ver) */
  opIds?: Id[];
  /** para onde o usuário "apontou" ao escrever (clipe, trecho, ponto do quadro, linha de legenda) */
  context?: ChatContext;
  status?: 'pending' | 'streaming' | 'applying' | 'done' | 'error';
  attachments?: Id[]; // assetIds
}

/* ---------- marcadores / comentários de revisão ---------- */
export interface Marker {
  id: Id;
  t: Seconds;
  /** fim opcional (comentário sobre um trecho) */
  end?: Seconds;
  label?: string;
  color?: string;
  kind?: 'user' | 'beat' | 'chapter' | 'comment';
  /** comentário de revisão: pendente até a IA aplicar */
  resolved?: boolean;
}

/* ---------- "apontar para qualquer coisa" (contexto do chat) ---------- */
export interface ChatContext {
  clipIds?: Id[];
  range?: { start: Seconds; end: Seconds };
  /** ponto no quadro (normalizado 0..1) no tempo t */
  point?: { x: number; y: number; t: Seconds };
  segmentId?: Id;
  markerId?: Id;
  /** rótulo curto mostrado no chip acima do campo ("Clipe 2 · 0:04–0:09") */
  label: string;
}
