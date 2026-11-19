/* =====================================================================
   Efeitos e transições ESCRITOS PELA IA em GLSL ES 1.00 ("IA sem limites").
   - efeito:    o código define  vec4 effect(vec2 uv)      (VisualEffect.kind 'custom')
   - transição: o código define  vec4 transition(vec2 uv)  (Transition.kind 'custom')
   O código do usuário entra entre um PRELÚDIO (uniforms + helpers) e um
   main() fixo. Cores de entrada/saída com alfa "reto" (não pré-multiplicado).
   uv: (0,0) = canto SUPERIOR esquerdo, (1,1) = inferior direito.
   Usado pela sessão ai (checkShader/wrapShader/SHADER_PRELUDE_DOC/SHADER_EXAMPLES)
   e pelo motor (customRender.ts). Sem DOM no import: seguro em servidor/vitest.
   ===================================================================== */
import { GLSL_PRECISION, glCompileCheck } from './glcore';

export type ShaderStage = 'effect' | 'transition';

/** limite de tamanho do código da IA (bytes ~ caracteres) */
export const SHADER_MAX_CHARS = 16 * 1024;

const HELPERS = [
  '#define PI 3.14159265',
  '#define TAU 6.28318531',
  'float rand(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}',
  'float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(rand(i),rand(i+vec2(1.,0.)),f.x),mix(rand(i+vec2(0.,1.)),rand(i+vec2(1.,1.)),f.x),f.y);}',
  'float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<5;i++){v+=a*noise(p);p=p*2.03+vec2(1.7,9.2);a*=.5;}return v;}',
  'float luma(vec3 c){return dot(c,vec3(.299,.587,.114));}',
  'vec3 rgb2hsv(vec3 c){vec4 K=vec4(0.,-1./3.,2./3.,-1.);vec4 p=mix(vec4(c.bg,K.wz),vec4(c.gb,K.xy),step(c.b,c.g));vec4 q=mix(vec4(p.xyw,c.r),vec4(c.r,p.yzx),step(p.x,c.r));float d=q.x-min(q.w,q.y);float e=1.0e-10;return vec3(abs(q.z+(q.w-q.y)/(6.*d+e)),d/(q.x+e),q.x);}',
  'vec3 hsv2rgb(vec3 c){vec3 p=abs(fract(c.xxx+vec3(1.,2./3.,1./3.))*6.-3.);return c.z*mix(vec3(1.),clamp(p-1.,0.,1.),c.y);}',
  'mat2 rot2(float a){float s=sin(a),c=cos(a);return mat2(c,-s,s,c);}',
  'float sdCircle(vec2 p,float r){return length(p)-r;}',
  'float sdBox(vec2 p,vec2 b){vec2 d=abs(p)-b;return length(max(d,0.))+min(max(d.x,d.y),0.);}',
  'float aspect(){return uResolution.x/uResolution.y;}',
];

const PRELUDE: Record<ShaderStage, string> = {
  effect: [
    GLSL_PRECISION.trimEnd(),
    'varying vec2 v_uv;',
    'uniform sampler2D uTex;',
    'uniform vec2 uResolution;',
    'uniform float uTime,uDuration,uProgress,uIntensity,uSpeed;',
    'uniform vec3 uColor;',
    'uniform float uParams[8];',
    ...HELPERS,
    'vec4 tex(vec2 uv){return texture2D(uTex,clamp(uv,0.,1.));}',
  ].join('\n'),
  transition: [
    GLSL_PRECISION.trimEnd(),
    'varying vec2 v_uv;',
    'uniform sampler2D uFrom,uTo;',
    'uniform vec2 uResolution;',
    'uniform float uProgress,uTime;',
    'uniform float uParams[8];',
    ...HELPERS,
    'vec4 getFromColor(vec2 uv){return texture2D(uFrom,clamp(uv,0.,1.));}',
    'vec4 getToColor(vec2 uv){return texture2D(uTo,clamp(uv,0.,1.));}',
  ].join('\n'),
};

/** linhas do prelúdio (o código do usuário começa na linha PRELUDE_LINES+1) */
const PRELUDE_LINES: Record<ShaderStage, number> = {
  effect: PRELUDE.effect.split('\n').length,
  transition: PRELUDE.transition.split('\n').length,
};

const MAIN: Record<ShaderStage, string> = {
  effect: 'void main(){vec4 c=effect(v_uv);float a=clamp(c.a,0.,1.);gl_FragColor=vec4(clamp(c.rgb,0.,1.)*a,a);}',
  transition: 'void main(){vec4 c=transition(v_uv);float a=clamp(c.a,0.,1.);gl_FragColor=vec4(clamp(c.rgb,0.,1.)*a,a);}',
};

const ENTRY: Record<ShaderStage, RegExp> = {
  effect: /\bvec4\s+effect\s*\(\s*vec2\s+\w+\s*\)/,
  transition: /\bvec4\s+transition\s*\(\s*vec2\s+\w+\s*\)/,
};

/** fonte completa (prelúdio + código + main) pronta p/ compilar */
export function wrapShader(code: string, stage: ShaderStage): string {
  return PRELUDE[stage] + '\n' + code + '\n' + MAIN[stage];
}

/** hash FNV-1a 32 bits (chave do cache de programa) */
export function shaderHash(code: string, stage: ShaderStage): string {
  let h = 0x811c9dc5;
  const s = stage + '|' + code;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

export type ShaderCheck = { ok: true } | { ok: false; error: string; line?: number };

/** checagens que não precisam de GPU (rodam também no servidor/vitest) */
export function staticCheck(code: string, stage: ShaderStage): ShaderCheck {
  if (typeof code !== 'string' || !code.trim()) return { ok: false, error: 'código vazio' };
  if (code.length > SHADER_MAX_CHARS) return { ok: false, error: `código maior que ${SHADER_MAX_CHARS / 1024} KB` };
  const fn = stage === 'effect' ? 'vec4 effect(vec2 uv)' : 'vec4 transition(vec2 uv)';
  if (!ENTRY[stage].test(code)) return { ok: false, error: `defina a função ${fn}` };
  const bad = /(^|\n)\s*#\s*(version|extension|pragma)\b/.exec(code);
  if (bad) return { ok: false, error: `diretiva #${bad[2]} não é permitida`, line: lineOf(code, bad.index + bad[1].length) };
  const main = /\bvoid\s+main\s*\(/.exec(code);
  if (main) return { ok: false, error: 'não declare main(): só a função ' + fn, line: lineOf(code, main.index) };
  if (/\bgl_FragColor\b/.test(code)) return { ok: false, error: 'não use gl_FragColor: devolva a cor na função ' + fn };
  let depth = 0;
  for (const ch of code) { if (ch === '{') depth++; else if (ch === '}') depth--; if (depth < 0) break; }
  if (depth !== 0) return { ok: false, error: 'chaves { } desbalanceadas' };
  return { ok: true };
}

function lineOf(code: string, index: number): number {
  return code.slice(0, index).split('\n').length;
}

/** extrai a 1ª mensagem/linha do log do compilador (linha relativa ao código do usuário) */
export function parseShaderLog(log: string, stage: ShaderStage): { error: string; line?: number } {
  const lines = log.split('\n').map((l) => l.trim()).filter(Boolean);
  for (const l of lines) {
    const m = /(?:ERROR|WARNING):\s*\d+:(\d+):\s*(.*)$/i.exec(l);
    if (m && /^ERROR/i.test(l)) {
      const raw = parseInt(m[1], 10);
      const rel = raw - PRELUDE_LINES[stage];
      const codeLines = Infinity;
      return rel >= 1 && rel <= codeLines ? { error: m[2].trim(), line: rel } : { error: m[2].trim() };
    }
  }
  return { error: (lines[0] ?? 'erro de compilação').slice(0, 300) };
}

const checkCache = new Map<string, ShaderCheck>();

/**
 * Valida o código: checagens estáticas + compilação num contexto WebGL reutilizável.
 * Fora do navegador (sem WebGL) só as checagens estáticas valem.
 */
export function checkShader(code: string, stage: ShaderStage): ShaderCheck {
  const st = staticCheck(code, stage);
  if (!st.ok) return st;
  const key = shaderHash(code, stage);
  const hit = checkCache.get(key);
  if (hit) return hit;
  let res: ShaderCheck = { ok: true };
  let gl: { ok: boolean; log: string } | null = null;
  try { gl = glCompileCheck(wrapShader(code, stage)); } catch { gl = null; }
  if (gl && !gl.ok) {
    const { error, line } = parseShaderLog(gl.log, stage);
    // linha além do código = erro no main() fixo (p.ex. assinatura errada)
    const n = code.split('\n').length;
    res = line && line <= n ? { ok: false, error, line } : { ok: false, error };
  }
  if (gl) { // só guarda resultado da GPU (o estático é barato)
    if (checkCache.size > 200) checkCache.clear();
    checkCache.set(key, res);
  }
  return res;
}

/** texto curto p/ o prompt da IA (≤ 1.200 caracteres) */
export const SHADER_PRELUDE_DOC =
  'Shaders GLSL ES 1.00 (WebGL 1). EFEITO: escreva só `vec4 effect(vec2 uv)`; TRANSIÇÃO: só `vec4 transition(vec2 uv)`. ' +
  'uv 0..1, (0,0) no canto SUPERIOR esquerdo. Devolva cor RGBA 0..1 (alfa reto). ' +
  'Efeito: uTex (quadro do clipe; na camada de ajuste = tudo abaixo; ignore-o p/ gerar fundo), tex(uv) lê uTex com clamp, ' +
  'uResolution (px), uTime (s desde o início do clipe), uDuration, uProgress (0..1 no clipe), uIntensity (0..1), uSpeed, ' +
  'uColor (vec3), uParams[8]. Transição: getFromColor(uv), getToColor(uv), uProgress (0..1 com easing), uResolution, uTime, uParams[8]. ' +
  'Helpers: rand(vec2), noise(vec2), fbm(vec2), luma(vec3), rgb2hsv, hsv2rgb, rot2(a)->mat2, sdCircle(p,r), sdBox(p,b), aspect(), PI, TAU. ' +
  'Regras: sem main(), gl_FragColor, #version/#extension; loops só `for` com limite constante (≤ 64 de preferência); ' +
  'texturas só uTex/uFrom/uTo; índice de uParams constante; floats com ponto (1.0); máx. 16 KB. Se não compilar, o efeito não aparece.';

export interface ShaderExample { id: string; name: string; stage: ShaderStage; code: string }

/** exemplos testados (compilam e mudam os pixels; ver /dev/fx e customShader.test.ts) */
export const SHADER_EXAMPLES: ShaderExample[] = [
  {
    id: 'waves', name: 'Ondas', stage: 'effect',
    code: `vec4 effect(vec2 uv){
  float a = 0.02 * uIntensity;
  uv.x += sin(uv.y * 20.0 + uTime * 4.0 * uSpeed) * a;
  uv.y += cos(uv.x * 16.0 + uTime * 3.0 * uSpeed) * a * 0.6;
  return tex(uv);
}`,
  },
  {
    id: 'neon-scanline', name: 'Scanline neon', stage: 'effect',
    code: `vec4 effect(vec2 uv){
  vec4 c = tex(uv);
  float l = luma(c.rgb);
  float scan = 0.5 + 0.5 * sin(uv.y * uResolution.y * 1.5 - uTime * 20.0);
  vec3 neon = uColor * smoothstep(0.3, 0.9, l) * 1.6;
  vec3 o = mix(c.rgb, neon + c.rgb * 0.2, uIntensity) * (0.8 + 0.2 * scan);
  return vec4(o, c.a);
}`,
  },
  {
    id: 'rain', name: 'Chuva procedural', stage: 'effect',
    code: `vec4 effect(vec2 uv){
  vec4 c = tex(uv);
  float x = uv.x * 90.0;
  float id = floor(x);
  float sp = (1.2 + rand(vec2(id, 3.0)) * 1.6) * uSpeed;
  float y = fract(uv.y * 1.5 - uTime * sp + rand(vec2(id, 9.0)));
  float line = 1.0 - smoothstep(0.0, 0.12, abs(fract(x) - 0.5));
  float drop = line * smoothstep(0.8, 1.0, y) * step(0.55, rand(vec2(id, 5.0)));
  vec3 o = c.rgb * (1.0 - 0.15 * uIntensity) + vec3(0.75, 0.85, 1.0) * drop * uIntensity;
  return vec4(o, max(c.a, drop * uIntensity));
}`,
  },
  {
    id: 'gradient-bg', name: 'Gradiente animado (fundo)', stage: 'effect',
    code: `vec4 effect(vec2 uv){
  float t = uTime * 0.2 * uSpeed;
  vec3 a = hsv2rgb(vec3(fract(t + uv.x * 0.3), 0.7, 0.95));
  vec3 b = hsv2rgb(vec3(fract(t + 0.5 + uv.y * 0.3), 0.8, 0.6));
  float n = fbm(uv * 3.0 + t);
  return vec4(mix(a, b, smoothstep(0.2, 0.8, uv.y + n * 0.4 - 0.2)), 1.0);
}`,
  },
  {
    id: 'particles', name: 'Partículas brilhantes', stage: 'effect',
    code: `vec4 effect(vec2 uv){
  vec4 c = tex(uv);
  vec3 acc = vec3(0.0);
  vec2 k = vec2(aspect(), 1.0);
  for (int i = 0; i < 40; i++) {
    float f = float(i);
    float fall = (0.05 + 0.1 * rand(vec2(f, 3.0))) * uSpeed;
    vec2 p = vec2(rand(vec2(f, 1.0)), fract(rand(vec2(f, 2.0)) + uTime * fall));
    float d = length((uv - p) * k);
    float tw = 0.5 + 0.5 * sin(uTime * 4.0 + f);
    acc += uColor * (0.00003 / (d * d + 0.00003)) * tw;
  }
  acc *= uIntensity;
  return vec4(c.rgb + acc, max(c.a, clamp(luma(acc), 0.0, 1.0)));
}`,
  },
  {
    id: 'beat-pulse', name: 'Pulso na batida (uParams: bpm, força)', stage: 'effect',
    code: `vec4 effect(vec2 uv){
  float bpm = uParams[0] > 0.0 ? uParams[0] : 120.0;
  float force = uParams[1] > 0.0 ? uParams[1] : 1.0;
  float b = fract(uTime * bpm / 60.0);
  float k = exp(-b * 8.0) * force * uIntensity;
  vec4 col = tex(0.5 + (uv - 0.5) / (1.0 + 0.12 * k));
  col.rgb += k * 0.25;
  return col;
}`,
  },
  {
    id: 'rgb-glitch', name: 'Glitch RGB', stage: 'effect',
    code: `vec4 effect(vec2 uv){
  float fr = floor(uTime * 12.0);
  float row = floor(uv.y * 40.0);
  float j = (rand(vec2(row, fr)) - 0.5) * 0.08 * uIntensity * step(0.7, rand(vec2(fr, row * 0.3)));
  float s = 0.01 * uIntensity;
  vec4 c = tex(uv + vec2(j, 0.0));
  return vec4(tex(uv + vec2(j + s, 0.0)).r, c.g, tex(uv + vec2(j - s, 0.0)).b, c.a);
}`,
  },
  {
    id: 'spiral', name: 'Espiral', stage: 'transition',
    code: `vec4 transition(vec2 uv){
  vec2 p = (uv - 0.5) * vec2(aspect(), 1.0);
  float a = atan(p.y, p.x) / TAU + 0.5;
  float r = length(p);
  float v = (fract(a - r * 2.0) + r * 1.2) / 2.2;
  float m = smoothstep(v - 0.02, v + 0.02, uProgress * 1.1);
  return mix(getFromColor(uv), getToColor(uv), m);
}`,
  },
  {
    id: 'diagonal-pixels', name: 'Pixels em diagonal', stage: 'transition',
    code: `vec4 transition(vec2 uv){
  vec2 g = vec2(24.0, 24.0 * uResolution.y / uResolution.x);
  vec2 cell = floor(uv * g);
  float d = (cell.x / g.x + cell.y / g.y) * 0.5;
  float m = step(d + rand(cell) * 0.15, uProgress * 1.3 - 0.1);
  float px = sin(uProgress * PI);
  vec2 suv = mix(uv, (cell + 0.5) / g, step(0.02, px) * px);
  return mix(getFromColor(suv), getToColor(suv), m);
}`,
  },
  {
    id: 'zoom-flash', name: 'Zoom com flash', stage: 'transition',
    code: `vec4 transition(vec2 uv){
  float p = uProgress;
  vec4 a = getFromColor(0.5 + (uv - 0.5) / (1.0 + p * 0.8));
  vec4 b = getToColor(0.5 + (uv - 0.5) * (1.0 + (1.0 - p) * 0.8));
  vec4 c = mix(a, b, smoothstep(0.4, 0.6, p));
  c.rgb += exp(-abs(p - 0.5) * 12.0) * 0.8;
  return c;
}`,
  },
];
