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
export type MediaRole = 'source' | 'reference' | 'music' | 'broll';

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
  /** referência do arquivo já enviado ao provedor de IA (ex.: Gemini Files API) */
  aiFileUri?: string;
  aiFileMime?: string;
}

/* ---------- efeitos ---------- */

export type FilterKind =
  | 'brightness' | 'contrast' | 'saturation' | 'temperature'
  | 'blur' | 'vignette' | 'grain' | 'bw' | 'sepia';

export interface Filter {
  kind: FilterKind;
  /** -1..1 para ajustes (0 = neutro); 0..1 para intensidade de efeitos */
  value: number;
}

/** LUTs/predefinições prontas (engine traduz para Filter[]) */
export type ColorPreset = 'none' | 'cinematic' | 'warm' | 'cool' | 'vibrant' | 'vintage' | 'bw' | 'moody';

export type TransitionKind =
  | 'cut' | 'fade' | 'crossfade' | 'slide-left' | 'slide-right' | 'slide-up'
  | 'zoom-in' | 'zoom-out' | 'whip' | 'glitch' | 'flash';

export interface Transition {
  kind: TransitionKind;
  duration: Seconds; // tipicamente 0.2–0.8
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
}

/* ---------- clipes ---------- */

interface BaseClip {
  id: Id;
  /** posição na timeline */
  start: Seconds;
  /** duração NA TIMELINE (já considerando speed) */
  duration: Seconds;
  /** rótulo livre (IA usa p/ explicar: "gancho", "CTA"...) */
  label?: string;
  locked?: boolean;
}

export interface VideoClip extends BaseClip {
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
  /** transição na ENTRADA deste clipe (vinda do clipe anterior da mesma trilha) */
  transitionIn?: Transition;
  fadeIn?: Seconds;
  fadeOut?: Seconds;
}

export interface ImageClip extends BaseClip {
  type: 'image';
  assetId: Id;
  transform: Transform;
  keyframes?: Keyframe[]; // ex.: Ken Burns
  filters: Filter[];
  transitionIn?: Transition;
}

export interface AudioClip extends BaseClip {
  type: 'audio';
  assetId: Id;
  in: Seconds;
  speed: number;
  volume: number;
  fadeIn?: Seconds;
  fadeOut?: Seconds;
  /** abaixa automaticamente quando há fala (ducking) */
  duckUnderVoice?: boolean;
}

export type TextAnimation = 'none' | 'fade' | 'pop' | 'slide-up' | 'typewriter' | 'bounce' | 'karaoke';

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
}

export interface TextClip extends BaseClip {
  type: 'text';
  text: string;
  style: TextStyle;
  /** posição do centro do texto, normalizada 0..1 */
  position: { x: number; y: number };
  animation: TextAnimation;
}

export type Clip = VideoClip | ImageClip | AudioClip | TextClip;
export type ClipType = Clip['type'];

/* ---------- trilhas ---------- */

export type TrackKind = 'video' | 'audio' | 'text';

export interface Track {
  id: Id;
  kind: TrackKind;
  name: string;
  muted?: boolean;
  hidden?: boolean;
  locked?: boolean;
  clips: Clip[]; // ordenados por start
}

/* ---------- legendas ---------- */

export interface CaptionWord {
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

export type CaptionPreset = 'classic' | 'bold-pop' | 'karaoke' | 'minimal' | 'boxed' | 'neon';

export interface CaptionStyle extends TextStyle {
  preset: CaptionPreset;
  position: { x: number; y: number };
  animation: TextAnimation;
  /** máximo de palavras visíveis por vez (estilo TikTok = 1–3) */
  maxWords: number;
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
  status?: 'pending' | 'streaming' | 'applying' | 'done' | 'error';
  attachments?: Id[]; // assetIds
}
