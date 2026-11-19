/* =====================================================================
   Shader de cor (GLSL ES 1.00 — roda em WebGL1 e WebGL2). Espelha
   pipeline.ts passo a passo. Variantes por #define (HSL/CURVES/LUT/SPLIT)
   evitam pagar pelo que a grade não usa.
   ===================================================================== */

export interface ShaderFeatures { hsl: boolean; curves: boolean; lut: boolean; split: boolean }

export const featureKey = (f: ShaderFeatures) => `${+f.hsl}${+f.curves}${+f.lut}${+f.split}`;

export const VERTEX_SRC = `attribute vec2 a;varying vec2 v;void main(){v=a;gl_Position=vec4(a*2.-1.,0.,1.);}`;

export function fragmentSource(f: ShaderFeatures): string {
  const defs = [f.hsl && '#define HSL 1', f.curves && '#define CURVES 1', f.lut && '#define LUT 1', f.split && '#define SPLIT 1'].filter(Boolean).join('\n');
  return `${defs}
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 v;
uniform sampler2D uSrc;
uniform float uExp;
uniform vec3 uWb, uOff, uGain, uLift, uGamma;
uniform float uCon, uPiv, uHl, uSh, uSat, uVib, uMix;
const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
#ifdef HSL
uniform vec3 uHsl[8];
#endif
#ifdef CURVES
uniform sampler2D uCurves;
#endif
#ifdef LUT
uniform sampler2D uLut;
uniform float uLutN, uLutCols, uLutK;
uniform vec2 uLutSize;
uniform vec3 uLutMin, uLutMax;
#endif
#ifdef SPLIT
uniform float uSplit;
#endif

vec3 toLin(vec3 c){ return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c)); }
vec3 toSrgb(vec3 c){ return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c)); }

#ifdef HSL
vec3 rgb2hsv(vec3 c){
  float mx = max(c.r, max(c.g, c.b)), mn = min(c.r, min(c.g, c.b)), d = mx - mn;
  float h = 0.0;
  if (d > 1e-6) {
    if (mx == c.r) h = (c.g - c.b) / d / 6.0;
    else if (mx == c.g) h = ((c.b - c.r) / d + 2.0) / 6.0;
    else h = ((c.r - c.g) / d + 4.0) / 6.0;
    if (h < 0.0) h += 1.0;
  }
  return vec3(h, mx > 1e-6 ? d / mx : 0.0, mx);
}
float hsvF(float n, vec3 c){ float k = mod(n + c.x * 6.0, 6.0); return c.z - c.z * c.y * max(0.0, min(min(k, 4.0 - k), 1.0)); }
vec3 hsv2rgb(vec3 c){ return vec3(hsvF(5.0, c), hsvF(3.0, c), hsvF(1.0, c)); }
float band(float h, float c, float prev, float next){
  float d = h - c; d -= floor(d + 0.5);
  float t = d < 0.0 ? 1.0 + d / mod(c - prev + 1.0, 1.0) : 1.0 - d / mod(next - c + 1.0, 1.0);
  return t <= 0.0 ? 0.0 : t * t * (3.0 - 2.0 * t);
}
#endif

#ifdef LUT
vec3 lutSlice(vec2 rg, float b){
  float tx = mod(b, uLutCols), ty = floor(b / uLutCols);
  vec2 p = vec2(tx, ty) * uLutN + rg * (uLutN - 1.0) + 0.5;
  return texture2D(uLut, p / uLutSize).rgb;
}
vec3 lut3d(vec3 c){
  vec3 x = clamp((c - uLutMin) / (uLutMax - uLutMin), 0.0, 1.0);
  float fb = x.b * (uLutN - 1.0);
  float b0 = min(floor(fb), uLutN - 2.0);
  return mix(lutSlice(x.rg, b0), lutSlice(x.rg, b0 + 1.0), fb - b0);
}
#endif

void main(){
  vec4 src = texture2D(uSrc, v);
  vec3 c0 = src.rgb;
  vec3 c = toSrgb(max(toLin(c0) * uExp * uWb, 0.0));
  c = (c + uOff) * uGain;
  c = c + uLift * (1.0 - c);
  c = pow(max(c, 0.0), uGamma);
  c = (c - uPiv) * uCon + uPiv;
  float l = dot(c, LUMA);
  c += uSh * (1.0 - smoothstep(0.0, 0.5, l)) * 0.3 + uHl * smoothstep(0.5, 1.0, l) * 0.3;
  l = dot(c, LUMA);
  float cs = max(c.r, max(c.g, c.b)) - min(c.r, min(c.g, c.b));
  c = l + (c - l) * (uSat * (1.0 + uVib * (1.0 - smoothstep(0.0, 0.6, cs))));
#ifdef HSL
  vec3 hv = rgb2hsv(clamp(c, 0.0, 1.0));
  vec3 dd = uHsl[0] * band(hv.x, 0.0, 300.0/360.0, 30.0/360.0)
          + uHsl[1] * band(hv.x, 30.0/360.0, 0.0, 60.0/360.0)
          + uHsl[2] * band(hv.x, 60.0/360.0, 30.0/360.0, 120.0/360.0)
          + uHsl[3] * band(hv.x, 120.0/360.0, 60.0/360.0, 180.0/360.0)
          + uHsl[4] * band(hv.x, 180.0/360.0, 120.0/360.0, 240.0/360.0)
          + uHsl[5] * band(hv.x, 240.0/360.0, 180.0/360.0, 270.0/360.0)
          + uHsl[6] * band(hv.x, 270.0/360.0, 240.0/360.0, 300.0/360.0)
          + uHsl[7] * band(hv.x, 300.0/360.0, 270.0/360.0, 0.0);
  float m = smoothstep(0.03, 0.25, hv.y) * smoothstep(0.0, 0.08, hv.z);
  float h = hv.x + dd.x * m / 12.0; h -= floor(h);
  c = hsv2rgb(vec3(h, clamp(hv.y * (1.0 + dd.y * m), 0.0, 1.0), hv.z * (1.0 + dd.z * m * 0.5)));
#endif
  c = clamp(c, 0.0, 1.0);
#ifdef CURVES
  // texel i em (i+0.5)/256: amostragem LINEAR = interpolação da tabela de 256
  const float S = 255.0 / 256.0, O = 0.5 / 256.0;
  c = vec3(texture2D(uCurves, vec2(c.r * S + O, 0.5)).a, texture2D(uCurves, vec2(c.g * S + O, 0.5)).a, texture2D(uCurves, vec2(c.b * S + O, 0.5)).a);
  c = vec3(texture2D(uCurves, vec2(c.r * S + O, 0.5)).r, texture2D(uCurves, vec2(c.g * S + O, 0.5)).g, texture2D(uCurves, vec2(c.b * S + O, 0.5)).b);
#endif
#ifdef LUT
  c = mix(c, clamp(lut3d(c), 0.0, 1.0), uLutK);
#endif
  c = mix(c0, c, uMix);
#ifdef SPLIT
  if (v.x < uSplit) c = c0;
#endif
  gl_FragColor = vec4(clamp(c, 0.0, 1.0) * src.a, src.a);
}`;
}
