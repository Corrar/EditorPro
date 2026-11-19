/* =====================================================================
   Processamento por pixel em WebGL (com fallback em CPU para o chroma):
   recorte, chroma key (distância em CbCr + supressão de vazamento),
   realces/sombras e nitidez. Um único contexto compartilhado; o resultado
   deve ser desenhado imediatamente (o canvas é reaproveitado).
   ===================================================================== */
import type { ChromaKey, Crop } from '../types';
import { makeCanvas, scratch, type AnyCanvas, type Ctx } from './surface';

export interface PixelParams {
  crop?: Crop;
  chroma?: ChromaKey;
  highlights?: number;
  shadows?: number;
  sharpen?: number;
}

const VS = `attribute vec2 a;varying vec2 v;uniform vec4 r;void main(){v=r.xy+a*r.zw;gl_Position=vec4(a*2.-1.,0.,1.);}`;
const FS = `precision mediump float;varying vec2 v;uniform sampler2D t;uniform vec2 px;uniform float hl,sh,sp;uniform int ck;uniform vec2 kc;uniform float th,sm;
vec2 cbcr(vec3 c){return vec2(-.168736*c.r-.331264*c.g+.5*c.b,.5*c.r-.418688*c.g-.081312*c.b);}
void main(){vec4 c=texture2D(t,v);
if(sp>0.){vec3 n=texture2D(t,v+vec2(px.x,0.)).rgb+texture2D(t,v-vec2(px.x,0.)).rgb+texture2D(t,v+vec2(0.,px.y)).rgb+texture2D(t,v-vec2(0.,px.y)).rgb;c.rgb+=(c.rgb*4.-n)*sp*.6;}
float l=dot(c.rgb,vec3(.299,.587,.114));
c.rgb+=sh*(1.-smoothstep(0.,.55,l))*.35;c.rgb+=hl*smoothstep(.45,1.,l)*.35;
float a=c.a;
if(ck==1){float d=distance(cbcr(c.rgb),kc);float m=smoothstep(th,th+sm,d);a*=m;float spill=1.-smoothstep(th,th+sm*2.5+.06,d);float y=dot(c.rgb,vec3(.299,.587,.114));c.rgb=mix(c.rgb,vec3(y),spill*.9);}
c.rgb=clamp(c.rgb,0.,1.);gl_FragColor=vec4(c.rgb*a,a);}`;

interface GLState {
  canvas: AnyCanvas;
  gl: WebGLRenderingContext;
  prog: WebGLProgram;
  tex: WebGLTexture;
  u: Record<string, WebGLUniformLocation | null>;
}

let state: GLState | null | undefined;

/** última perda/falha: não recria o contexto a cada quadro enquanto a GPU está indisponível */
let lastFail = -Infinity;
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

function init(): GLState | null {
  if (state !== undefined) return state;
  if (now() - lastFail < 1000) return null; // usa o fallback de CPU por ~1 s
  state = null;
  try {
    if (typeof document === 'undefined' && typeof OffscreenCanvas === 'undefined') return null;
    const canvas = makeCanvas(16, 16);
    const gl = (canvas as HTMLCanvasElement).getContext('webgl', { premultipliedAlpha: true, preserveDrawingBuffer: true, alpha: true }) as WebGLRenderingContext | null;
    if (!gl) return null;
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'a');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    const u: GLState['u'] = {};
    for (const n of ['r', 't', 'px', 'hl', 'sh', 'sp', 'ck', 'kc', 'th', 'sm']) u[n] = gl.getUniformLocation(prog, n);
    (canvas as HTMLCanvasElement).addEventListener?.('webglcontextlost', (e: Event) => {
      e.preventDefault();
      lastFail = now();
      state = undefined; // recria o contexto depois do intervalo (o antigo morreu)
    }, false);
    state = { canvas, gl, prog, tex, u };
  } catch (e) {
    console.warn('[engine] WebGL indisponível, usando fallback', e);
    state = null;
  }
  return state;
}

export function hasGL(): boolean {
  return !!init();
}

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim()) ?? /^#?([0-9a-f]{3})$/i.exec(hex.trim());
  if (!m) return [0, 1, 0];
  const h = m[1].length === 3 ? [...m[1]].map((x) => x + x).join('') : m[1];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as [number, number, number];
}

const cbcr = ([r, g, b]: [number, number, number]) => [-0.168736 * r - 0.331264 * g + 0.5 * b, 0.5 * r - 0.418688 * g - 0.081312 * b];

export function chromaThresholds(k: ChromaKey) {
  return { th: 0.02 + Math.max(0, Math.min(1, k.similarity)) * 0.38, sm: 0.005 + Math.max(0, Math.min(1, k.smoothness)) * 0.25 };
}

/**
 * Processa `src` (tamanho natural sw×sh) e devolve um canvas w×h com o
 * resultado (recortado). null se não houver nada a fazer.
 */
export function processPixels(src: TexImageSource, sw: number, sh: number, w: number, h: number, p: PixelParams): AnyCanvas | null {
  const crop = p.crop ?? { x: 0, y: 0, w: 1, h: 1 };
  let S = init();
  if (S && S.gl.isContextLost()) { state = undefined; lastFail = now(); S = null; }
  // sem GPU (ou contexto perdido): recorte + chroma em CPU — o clipe nunca some
  if (!S) return cpuFallback(src, sw, sh, w, h, p, crop);
  const { gl, u, canvas } = S;
  w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  gl.viewport(0, 0, w, h);
  try {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
  } catch {
    return null;
  }
  // flipY: v=0 é a base da imagem → converte o recorte (origem no topo)
  gl.uniform4f(u.r, crop.x, 1 - crop.y - crop.h, crop.w, crop.h);
  gl.uniform1i(u.t, 0);
  gl.uniform2f(u.px, 1 / Math.max(1, sw), 1 / Math.max(1, sh));
  gl.uniform1f(u.hl, p.highlights ?? 0);
  gl.uniform1f(u.sh, p.shadows ?? 0);
  gl.uniform1f(u.sp, p.sharpen ?? 0);
  if (p.chroma) {
    const [kb, kr] = cbcr(hexToRgb(p.chroma.color));
    const { th, sm } = chromaThresholds(p.chroma);
    gl.uniform1i(u.ck, 1);
    gl.uniform2f(u.kc, kb, kr);
    gl.uniform1f(u.th, th);
    gl.uniform1f(u.sm, sm);
  } else gl.uniform1i(u.ck, 0);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.drawArrays(gl.TRIANGLES, 0, 6);
  if (gl.isContextLost()) { state = undefined; lastFail = now(); return cpuFallback(src, sw, sh, w, h, p, crop); }
  return canvas;
}

const cpuOwner = {};
/** sem WebGL: recorte + chroma por CPU numa resolução reduzida */
function cpuFallback(src: TexImageSource, sw: number, sh: number, w: number, h: number, p: PixelParams, crop: Crop): AnyCanvas | null {
  const k = Math.min(1, 640 / Math.max(w, h));
  const cw = Math.max(1, Math.round(w * k)), ch = Math.max(1, Math.round(h * k));
  const { c, ctx } = scratch(cpuOwner, cw, ch, 0);
  (ctx as Ctx).drawImage(src as CanvasImageSource, crop.x * sw, crop.y * sh, crop.w * sw, crop.h * sh, 0, 0, cw, ch);
  if (p.chroma) {
    const img = ctx.getImageData(0, 0, cw, ch);
    const [kb, kr] = cbcr(hexToRgb(p.chroma.color));
    const { th, sm } = chromaThresholds(p.chroma);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i] / 255, g = d[i + 1] / 255, b = d[i + 2] / 255;
      const cb = -0.168736 * r - 0.331264 * g + 0.5 * b, cr = 0.5 * r - 0.418688 * g - 0.081312 * b;
      const dist = Math.hypot(cb - kb, cr - kr);
      const x = Math.min(1, Math.max(0, (dist - th) / sm));
      d[i + 3] = Math.round(d[i + 3] * x * x * (3 - 2 * x));
    }
    ctx.putImageData(img, 0, 0);
  }
  return c;
}

/** só p/ testes (/dev/fx): contexto atual, p/ simular perda com WEBGL_lose_context */
export function glContextForTests(): WebGLRenderingContext | null {
  return init()?.gl ?? null;
}
