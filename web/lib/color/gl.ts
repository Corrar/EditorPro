/* =====================================================================
   ColorGrader: executa o shader de cor num contexto WebGL compartilhado
   (um só por página — nada de vazar contextos). Cache de programas por
   variante, textura de curvas e atlas de LUT por conteúdo. Sobrevive a
   webglcontextlost (recria tudo no restored / na próxima chamada).
   O canvas devolvido é REUTILIZADO: desenhe-o logo em seguida.
   ===================================================================== */
import type { ColorGrade } from '../types';
import { curvesTextureData } from './curves';
import { lutAtlasData, type Lut3D } from './cube';
import { resolveGrade, type LutResolver, type ResolvedGrade } from './pipeline';
import { VERTEX_SRC, featureKey, fragmentSource, type ShaderFeatures } from './shader';

type GL = WebGLRenderingContext | WebGL2RenderingContext;
type Canvas = HTMLCanvasElement | OffscreenCanvas;

interface Prog { p: WebGLProgram; u: Record<string, WebGLUniformLocation | null> }

const UNIFORMS = ['uSrc', 'uExp', 'uWb', 'uOff', 'uGain', 'uLift', 'uGamma', 'uCon', 'uPiv', 'uHl', 'uSh', 'uSat', 'uVib', 'uMix',
  'uHsl', 'uCurves', 'uLut', 'uLutN', 'uLutCols', 'uLutK', 'uLutSize', 'uLutMin', 'uLutMax', 'uSplit'];

export interface GradeRenderOpts {
  /** comparação dividida: à esquerda de x (0..1) mostra o original */
  split?: number;
}

export class ColorGrader {
  readonly canvas: Canvas;
  private gl: GL | null = null;
  private progs = new Map<string, Prog>();
  private buf: WebGLBuffer | null = null;
  private srcTex: WebGLTexture | null = null;
  private curveTex: WebGLTexture | null = null;
  private curveKey: unknown = null;
  private lutTex: WebGLTexture | null = null;
  private lutKey: Lut3D | null = null;
  private lutInfo = { cols: 1, width: 1, height: 1 };
  private lost = false;
  private failed = false;
  /** versão WebGL em uso (1 ou 2) — informativo */
  version = 0;

  constructor(canvas?: Canvas) {
    this.canvas = canvas ?? makeGlCanvas();
    const c = this.canvas as HTMLCanvasElement;
    c.addEventListener?.('webglcontextlost', (e: Event) => { e.preventDefault(); this.lost = true; }, false);
    c.addEventListener?.('webglcontextrestored', () => { this.reset(); }, false);
  }

  private reset() {
    this.lost = false;
    this.gl = null;
    this.progs.clear();
    this.buf = this.srcTex = this.curveTex = this.lutTex = null;
    this.curveKey = null; this.lutKey = null;
  }

  /** contexto pronto (cria sob demanda); null se WebGL indisponível */
  context(): GL | null {
    if (this.failed) return null;
    if (this.gl && !this.lost && !this.gl.isContextLost()) return this.gl;
    if (this.lost) return null;
    if (this.gl && this.gl.isContextLost()) return null;
    const attrs: WebGLContextAttributes = { premultipliedAlpha: true, alpha: true, preserveDrawingBuffer: true, antialias: false, depth: false, stencil: false };
    let gl: GL | null = null;
    try {
      gl = (this.canvas.getContext('webgl2', attrs) as WebGL2RenderingContext | null);
      this.version = gl ? 2 : 0;
      if (!gl) { gl = this.canvas.getContext('webgl', attrs) as WebGLRenderingContext | null; this.version = gl ? 1 : 0; }
    } catch { gl = null; }
    if (!gl) { this.failed = true; return null; }
    this.gl = gl;
    this.buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]), gl.STATIC_DRAW);
    this.srcTex = makeTex(gl, gl.LINEAR);
    return gl;
  }

  available(): boolean { return !!this.context(); }

  private program(gl: GL, f: ShaderFeatures): Prog | null {
    const key = featureKey(f);
    const hit = this.progs.get(key);
    if (hit) return hit;
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
      return s;
    };
    try {
      const p = gl.createProgram()!;
      gl.attachShader(p, sh(gl.VERTEX_SHADER, VERTEX_SRC));
      gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fragmentSource(f)));
      gl.bindAttribLocation(p, 0, 'a');
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS) && !gl.isContextLost()) throw new Error(gl.getProgramInfoLog(p) ?? 'link');
      const u: Prog['u'] = {};
      for (const n of UNIFORMS) u[n] = gl.getUniformLocation(p, n);
      u.uHsl = gl.getUniformLocation(p, 'uHsl[0]') ?? u.uHsl;
      const prog = { p, u };
      this.progs.set(key, prog);
      return prog;
    } catch (e) {
      console.warn('[cor] shader falhou', e);
      return null;
    }
  }

  /**
   * Aplica a grade e devolve o canvas WebGL (w×h) — ou null se WebGL não estiver
   * disponível/contexto perdido. `source` pode ser vídeo, imagem, canvas, bitmap.
   */
  render(source: TexImageSource, grade: ColorGrade | ResolvedGrade, w: number, h: number, luts?: LutResolver, opts: GradeRenderOpts = {}): Canvas | null {
    const gl = this.context();
    if (!gl) return null;
    const R: ResolvedGrade = 'expMul' in grade ? grade : resolveGrade(grade, luts);
    w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
    const split = opts.split !== undefined && opts.split > 0;
    const f: ShaderFeatures = { hsl: R.useHsl, curves: !!R.curves, lut: !!R.lut && R.lutIntensity > 0, split };
    const prog = this.program(gl, f);
    if (!prog) return null;
    const u = prog.u;
    gl.viewport(0, 0, w, h);
    gl.useProgram(prog.p);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.srcTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    try {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    } catch (e) {
      // vídeo sem quadro / origem cruzada
      return null;
    }
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.uniform1i(u.uSrc, 0);

    gl.uniform1f(u.uExp, R.expMul);
    gl.uniform3fv(u.uWb, R.wb);
    gl.uniform3fv(u.uOff, R.offset);
    gl.uniform3fv(u.uGain, R.gain);
    gl.uniform3fv(u.uLift, R.lift);
    gl.uniform3fv(u.uGamma, R.gammaExp);
    gl.uniform1f(u.uCon, R.contrast);
    gl.uniform1f(u.uPiv, R.pivot);
    gl.uniform1f(u.uHl, R.highlights);
    gl.uniform1f(u.uSh, R.shadows);
    gl.uniform1f(u.uSat, R.saturation);
    gl.uniform1f(u.uVib, R.vibrance);
    gl.uniform1f(u.uMix, R.mix);
    if (f.hsl) gl.uniform3fv(u.uHsl, R.hsl);
    if (f.curves && R.curves) {
      gl.activeTexture(gl.TEXTURE1);
      if (!this.curveTex) this.curveTex = makeTex(gl, gl.LINEAR);
      gl.bindTexture(gl.TEXTURE_2D, this.curveTex);
      if (this.curveKey !== R.curves) {
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, curvesTextureData(R.curves));
        this.curveKey = R.curves;
      }
      gl.uniform1i(u.uCurves, 1);
    }
    if (f.lut && R.lut) {
      gl.activeTexture(gl.TEXTURE2);
      if (!this.lutTex) this.lutTex = makeTex(gl, gl.LINEAR);
      gl.bindTexture(gl.TEXTURE_2D, this.lutTex);
      if (this.lutKey !== R.lut) {
        const a = lutAtlasData(R.lut);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, a.width, a.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, a.data);
        this.lutKey = R.lut;
        this.lutInfo = { cols: a.cols, width: a.width, height: a.height };
      }
      gl.uniform1i(u.uLut, 2);
      gl.uniform1f(u.uLutN, R.lut.size);
      gl.uniform1f(u.uLutCols, this.lutInfo.cols);
      gl.uniform2f(u.uLutSize, this.lutInfo.width, this.lutInfo.height);
      gl.uniform3fv(u.uLutMin, R.lut.domainMin);
      gl.uniform3fv(u.uLutMax, R.lut.domainMax);
      gl.uniform1f(u.uLutK, R.lutIntensity);
    }
    if (split) gl.uniform1f(u.uSplit, opts.split!);
    gl.activeTexture(gl.TEXTURE0);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    return this.canvas;
  }

  /** lê o resultado (RGBA, de cima p/ baixo) — testes/escopos */
  readPixels(): Uint8Array | null {
    const gl = this.gl;
    if (!gl) return null;
    const w = this.canvas.width, h = this.canvas.height;
    const px = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    // GL lê de baixo p/ cima
    const row = w * 4, tmp = new Uint8Array(row);
    for (let y = 0; y < h >> 1; y++) {
      const a = y * row, b = (h - 1 - y) * row;
      tmp.set(px.subarray(a, a + row)); px.copyWithin(a, b, b + row); px.set(tmp, b);
    }
    return px;
  }

  /** força perda de contexto (testes) */
  loseContext(): void {
    const ext = this.gl?.getExtension('WEBGL_lose_context');
    ext?.loseContext();
  }
  restoreContext(): void {
    const ext = this.gl?.getExtension('WEBGL_lose_context');
    ext?.restoreContext();
  }
}

function makeTex(gl: GL, filter: number): WebGLTexture {
  const t = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}

function makeGlCanvas(): Canvas {
  if (typeof document !== 'undefined') { const c = document.createElement('canvas'); c.width = 16; c.height = 16; return c; }
  return new OffscreenCanvas(16, 16);
}

const shared: Partial<Record<'render' | 'ui', ColorGrader>> = {};

/**
 * Grader compartilhado (cria na 1ª chamada; null no servidor). 'render' = preview/export
 * (gradeLayer); 'ui' = miniaturas e escopos do painel — separado p/ não ficar
 * redimensionando o canvas do preview a cada miniatura. No máximo 2 contextos.
 */
export function getColorGrader(slot: 'render' | 'ui' = 'render'): ColorGrader | null {
  const hit = shared[slot];
  if (hit) return hit;
  if (typeof document === 'undefined' && typeof OffscreenCanvas === 'undefined') return null;
  return (shared[slot] = new ColorGrader());
}
