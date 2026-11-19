/* =====================================================================
   Módulos opcionais de outras sessões (carregados se existirem):
   - lib/fx/customShader.ts  (sessão fx): checkShader, SHADER_PRELUDE_DOC, SHADER_EXAMPLES
   require.context não quebra o build quando o arquivo ainda não existe;
   fora do webpack (vitest) cai no fallback.
   ===================================================================== */

export type ShaderStage = 'effect' | 'transition';
export type ShaderCheck = { ok: true } | { ok: false; error: string; line?: number };
export interface ShaderExample { id: string; name: string; stage: ShaderStage; code: string }
export interface CustomShaderModule {
  checkShader?: (code: string, stage: ShaderStage) => ShaderCheck;
  SHADER_PRELUDE_DOC?: string;
  SHADER_EXAMPLES?: ShaderExample[];
}

type Ctx = { keys(): string[]; (k: string): unknown };
type ReqCtx = (dir: string, sub: boolean, re: RegExp) => Ctx;

let cached: CustomShaderModule | null | undefined;
let override: CustomShaderModule | null | undefined;

/** testes: injeta (ou remove com null) o módulo */
export function __setCustomShaderModule(m: CustomShaderModule | null | undefined): void { override = m; }

export function customShaderModule(): CustomShaderModule | null {
  if (override !== undefined) return override;
  if (cached !== undefined) return cached;
  try {
    const ctx = (require as unknown as { context: ReqCtx }).context('../fx', false, /^\.\/customShader\.ts$/);
    const k = ctx.keys()[0];
    cached = k ? (ctx(k) as CustomShaderModule) : null;
  } catch {
    cached = null;
  }
  return cached;
}

/** checagem leve (sem WebGL) quando o módulo da fx não existe ainda */
export function basicShaderCheck(code: string, stage: ShaderStage): ShaderCheck {
  const entry = stage === 'effect' ? 'effect' : 'transition';
  if (!new RegExp(`vec4\\s+${entry}\\s*\\(\\s*vec2\\s+\\w+\\s*\\)`).test(code)) return { ok: false, error: `falta a função "vec4 ${entry}(vec2 uv)"` };
  let depth = 0;
  for (const ch of code) { if (ch === '{') depth++; else if (ch === '}') depth--; if (depth < 0) break; }
  if (depth !== 0) return { ok: false, error: 'chaves { } desbalanceadas' };
  return { ok: true };
}

export function checkShaderCode(code: string, stage: ShaderStage): ShaderCheck {
  const m = customShaderModule();
  try {
    if (m?.checkShader) return m.checkShader(code, stage);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  return basicShaderCheck(code, stage);
}

/** documentação do prelúdio (cópia mínima p/ quando o módulo da fx não está no build) */
const FALLBACK_DOC =
  'Shaders GLSL ES 1.00 (WebGL 1). EFEITO: escreva só `vec4 effect(vec2 uv)`; TRANSIÇÃO: só `vec4 transition(vec2 uv)`. ' +
  'uv 0..1, (0,0) no canto SUPERIOR esquerdo. Devolva RGBA 0..1. Efeito: tex(uv) lê o quadro do clipe (uTex), uResolution, uTime (s), ' +
  'uDuration, uProgress (0..1 no clipe), uIntensity, uSpeed, uColor (vec3), uParams[8]. Transição: getFromColor(uv), getToColor(uv), uProgress. ' +
  'Helpers: rand, noise, fbm, luma, rgb2hsv, hsv2rgb, rot2, sdCircle, sdBox, aspect(), PI, TAU. Sem main()/gl_FragColor; loops com limite constante; floats com ponto (1.0).';

const PREFERRED_EXAMPLES = ['waves', 'rain', 'beat-pulse', 'spiral'];

/** texto p/ o prompt: prelúdio + 3–4 exemplos testados (máx. ~4 KB) */
export function shaderDocForAI(): string {
  const m = customShaderModule();
  const doc = m?.SHADER_PRELUDE_DOC ?? FALLBACK_DOC;
  const all = m?.SHADER_EXAMPLES ?? [];
  const picked = [...PREFERRED_EXAMPLES.map((id) => all.find((e) => e.id === id)).filter((e): e is ShaderExample => !!e), ...all].filter((e, i, a) => a.indexOf(e) === i).slice(0, 4);
  let out = doc;
  for (const e of picked) {
    const block = `\n\nExemplo (${e.stage === 'effect' ? 'efeito' : 'transição'} "${e.name}"):\n\`\`\`glsl\n${e.code.trim()}\n\`\`\``;
    if (out.length + block.length > 4500) break;
    out += block;
  }
  return out;
}
