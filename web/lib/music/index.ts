/* =====================================================================
   Música (dono: sessão "musica") — catálogo de trilhas GERADAS POR CÓDIGO,
   sem direitos autorais e sem download. API pública do módulo.
   ===================================================================== */
export { MUSIC_CATALOG, MOOD_LABELS, ENERGY_LABELS, musicTrack, keyLabel, trackStyle, type MusicTrack, type Mood, type Energy } from './catalog';
export { GENRE_LABELS, type Genre } from './styles';
export { renderMusicPCM, musicTiming, beatMarkers, barMarkers, ENGINE_VERSION, TARGET_LUFS, CEILING, MIN_DURATION, MAX_DURATION, type RenderOptions, type MusicTiming } from './engine';
export { musicWav } from './wav';
export { musicClipOps, beatMarkerOps, fitMusicDuration, visualEnd, musicRefitOps, musicTrackForAsset, type MusicClipOptions } from './ops';
export { pickMusic, scoreTracks, matchesMusic, normEnergy, type PickOptions } from './pick';
export { renderMusic, renderMusicBuffer, renderPreview, previewDuration, cacheKey, renderStats, type RenderMusicOptions } from './render';
export { insertMusic, prepareMusicAsset, refitMusicClip, type InsertMusicOptions } from './insert';
