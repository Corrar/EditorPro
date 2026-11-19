'use client';
/* =====================================================================
   Ícones do EditorPro — conjunto ÚNICO para o app todo (contrato da principal).
   Base: lucide-react (licença ISC). Traço 1.9, cantos arredondados, cor = currentColor.
   Uso:  <Icon name="ai" />   <Icon name="play" size={20} />
   Não desenhe SVGs próprios nos módulos: adicione o nome aqui.
   ===================================================================== */
import {
  ArrowUp, AudioLines, Bell, Blend, Bookmark, Captions, Check, ChevronLeft, ChevronRight, CircleHelp,
  Clapperboard, Copy, Crop, Crosshair, Diamond, Download, Droplet, Ellipsis, Eye, EyeOff, Film,
  FlipHorizontal2, FolderOpen, Gauge, House, Image, Languages, LayoutGrid, LayoutTemplate, Layers,
  Lock, LockOpen, LogOut, Magnet, Maximize, Menu, MessageCircle, MessageSquareText, Mic, Monitor, Moon,
  Music, Palette, Paperclip, Pause, Pipette, Play, Plus, Redo2, Repeat, RotateCw, ScanLine, Scissors,
  Search, SendHorizontal, Settings, Shapes, Share, Shuffle, SkipBack, SlidersHorizontal, Smartphone,
  Snowflake, Sparkles, Square, Sticker, Sun, Timer, Trash2, Type, Undo2, Upload, UserRound, Video,
  Volume2, VolumeX, Wand, WandSparkles, X, ZoomIn, ZoomOut, Flame, RectangleVertical,
  PanelLeft, ChevronsUpDown, Pencil, ArrowLeft, Replace, Rewind,
  type LucideIcon,
} from 'lucide-react';

export const ICONS = {
  // navegação / ferramentas
  home: House, media: Clapperboard, audio: AudioLines, text: Type, stickers: Sticker, shapes: Shapes,
  effects: WandSparkles, filters: Palette, transitions: Blend, captions: Captions, adjust: SlidersHorizontal,
  formats: RectangleVertical, review: MessageSquareText, projects: FolderOpen, settings: Settings,
  templates: LayoutTemplate, menu: Menu, grid: LayoutGrid, edit: Wand,
  // IA
  ai: Sparkles, chat: MessageCircle, translate: Languages,
  // ações
  upload: Upload, download: Download, export: Share, mic: Mic, video: Video, film: Film, image: Image,
  music: Music, undo: Undo2, redo: Redo2, play: Play, pause: Pause, back: SkipBack, cut: Scissors,
  delete: Trash2, add: Plus, more: Ellipsis, search: Search, help: CircleHelp, sun: Sun, moon: Moon,
  bell: Bell, close: X, next: ChevronRight, prev: ChevronLeft, check: Check, copy: Copy, crop: Crop,
  speed: Gauge, volume: Volume2, mute: VolumeX, layers: Layers, show: Eye, hide: EyeOff, lock: Lock,
  unlock: LockOpen, fullscreen: Maximize, point: Crosshair, safearea: ScanLine, freeze: Snowflake,
  keyframe: Diamond, magnet: Magnet, zoomIn: ZoomIn, zoomOut: ZoomOut, logout: LogOut, attach: Paperclip,
  send: SendHorizontal, send2: ArrowUp, fire: Flame, phone: Smartphone, desktop: Monitor, square: Square,
  marker: Bookmark, shuffle: Shuffle, loop: Repeat, rotate: RotateCw, flip: FlipHorizontal2,
  chroma: Droplet, picker: Pipette, user: UserRound, timer: Timer,
  // (aditivo, shell)
  sidebar: PanelLeft, expand: ChevronsUpDown, rename: Pencil, arrowLeft: ArrowLeft, replace: Replace, reverse: Rewind,
} satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof ICONS;

export default function Icon({
  name, size = 22, strokeWidth = 1.9, className, title,
}: { name: IconName; size?: number; strokeWidth?: number; className?: string; title?: string }) {
  const C = ICONS[name];
  return <C size={size} strokeWidth={strokeWidth} className={className} aria-hidden={title ? undefined : true} aria-label={title} />;
}
