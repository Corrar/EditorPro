/* =====================================================================
   Biblioteca profissional — API pública (dono: sessão "biblioteca").
   Fontes, estilos de legenda, animações, modelos de texto/motion graphics,
   looks de cor e efeitos sonoros sintetizados.
   Spec: docs/superpowers/specs/2026-11-19-biblioteca-profissional.md
   Componentes de UI (galerias) ficam em components/library (import direto).
   ===================================================================== */
export {
  FONT_CATALOG, FONT_CATEGORY_LABELS, fontDef, nearestWeight, searchFonts, googleFontsUrl, projectFonts,
  ensureFont, ensureProjectFonts, fontStack,
} from './fonts';
export type { FontDef, FontCategory } from './fonts';

export { emojiFor, emojiForWords, normEmojiKey, EMOJI_KEYWORDS } from './emoji';

export {
  CAPTION_PRESETS, CAPTION_CATEGORY_LABELS, CAPTION_ANIMATIONS, captionPresetDef, captionBasePreset, captionStylePatch, captionPresetOp,
} from './captions';
export type { CaptionPresetDef, CaptionCategory, CaptionBasePreset } from './captions';

export {
  TEXT_ANIMATIONS, CLIP_ANIMATIONS, ANIM_SLOT_LABELS, TEXT_ANIM_GROUP_LABELS, CLIP_ANIM_GROUP_LABELS,
  textAnimDef, clipAnimDef, textAnimationsFor, clipAnimationsFor, textAnimationOp, clipAnimationOp,
} from './animations';
export type { AnimSlot, TextAnimDef, ClipAnimDef, TextAnimGroup, ClipAnimGroup } from './animations';

export {
  TEMPLATES, TEMPLATE_CATEGORY_LABELS, DEFAULT_BRAND, templateDef, templatesOf, defaultValues, buildTemplate, assembleTemplate,
  templateFonts, templateTracks, shapeGeometry, estimateTextWidth, makeFrame,
} from './templates';
export type { TemplateDef, TemplateParam, TemplateContext, TemplateKind, TemplateCategory, BrandColors, Piece, Frame } from './templates';

export { LOOKS, LOOK_CATEGORY_LABELS, lookDef, lookFilters, detectLook, lookClipOps, lookAdjustmentOps } from './looks';
export type { LookDef, LookCategory } from './looks';

export {
  SFX_CATALOG, SFX_CATEGORY_LABELS, sfxDef, renderSfx, sfxWav, synthSfx, wavInfo, sfxClipOps, insertSfx, previewSfx,
} from './sfx';
export type { SfxDef, SfxCategory } from './sfx';

/** resumo compacto dos ids (p/ o prompt da IA conhecer o catálogo) */
export { libraryCatalogForAI } from './catalog';
