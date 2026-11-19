/* Ícones da timeline = conjunto único do app (@/components/ui/Icon, lucide).
   Adaptador fino: mantém os nomes usados no módulo, sem nenhum SVG próprio. */
import Icon, { type IconName } from '@/components/ui/Icon';

type P = { size?: number; className?: string; title?: string };

const make = (name: IconName) => {
  const C = ({ size = 16, className, title }: P) => <Icon name={name} size={size} className={className} title={title} />;
  C.displayName = `I_${name}`;
  return C;
};

export const IUndo = make('undo');
export const IRedo = make('redo');
export const ISplit = make('cut');
export const ITrash = make('delete');
export const IMagnet = make('magnet');
export const IFit = make('fullscreen');
export const IZoomIn = make('zoomIn');
export const IZoomOut = make('zoomOut');
export const IPlay = make('play');
export const IPause = make('pause');
export const IVideo = make('video');
export const IText = make('text');
export const IAudio = make('music');
export const ICaptions = make('captions');
export const IImage = make('image');
export const IEye = make('show');
export const IEyeOff = make('hide');
export const IVolume = make('volume');
export const IMute = make('mute');
export const ILock = make('lock');
export const IUnlock = make('unlock');
export const ICopy = make('copy');
export const IRipple = make('delete');
export const ISparkle = make('ai');
export const IPlus = make('add');
export const IGauge = make('speed');
export const IMore = make('more');
export const ISticker = make('stickers');
export const IShape = make('shapes');
export const ISliders = make('adjust');
export const IReverse = make('loop');
export const IMask = make('crop');
export const IChroma = make('chroma');
export const IDiamond = make('keyframe');
export const IFlag = make('marker');
export const IComment = make('review');
export const IClipboard = make('copy');
export const ISnowflake = make('freeze');
export const IAudioSplit = make('audio');
export const IMagnetTrack = make('layers');
export const IAsk = make('ai');
export const IInsert = make('layers');
