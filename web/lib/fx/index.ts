/* API pública da sessão fx */
export * from './catalog';
export { BLEND_OPS, blendOp } from './blend';
export { GEOMETRY_EFFECTS, isGeometryEffect, addFxGeometry } from './geometry';
export { OVERLAY_EFFECTS, PAINT_2D_EFFECTS, paint2DEffect, type FxOpts } from './effects2d';
export { EFFECT_SHADER_KINDS, isGLEffect, effectFragment } from './effectShaders';
export { applyGLEffect } from './effectsGL';
export { FX_SHADER_TRANSITION_KINDS, fxTransitionFragment } from './transitionShaders';
export { applyIntroFx, applyLoopFx } from './clipAnimations';
export { fxGLAvailable, runFx, glStats } from './glcore';
export { effectNativeMode, effectsNativeMode, easeTransitionProgress } from './native';
export { checkShader, wrapShader, staticCheck, shaderHash, parseShaderLog, SHADER_PRELUDE_DOC, SHADER_EXAMPLES, SHADER_MAX_CHARS, type ShaderStage, type ShaderCheck, type ShaderExample } from './customShader';
export { applyCustomEffect, runCustomTransition, warmCustomShader } from './customRender';
