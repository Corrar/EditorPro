/* =====================================================================
   Núcleo WebGL compartilhado da sessão fx: UM contexto para efeitos por
   pixel e transições em shader (navegadores limitam ~16 contextos; antes
   eram dois). Texturas reaproveitadas, programas e uniforms em cache,
   recuperação de perda de contexto (celular em segundo plano) e limite de
   MAX_TEXTURE_SIZE. Texturas sobem PRÉ-MULTIPLICADAS (desfoque correto
   em bordas transparentes); a saída também é pré-multiplicada.
   O canvas devolvido é reaproveitado: desenhe-o ANTES da próxima chamada.
   ===================================================================== */
import { makeCanvas, type AnyCanvas } from '../engine/surface';

const VERT = 'attribute vec2 a_pos;varying vec2 v_uv;void main(){v_uv=a_pos*.5+.5;v_uv.y=1.-v_uv.y;gl_Position=vec4(a_pos,0.,1.);}';

/** cabeçalho comum: precisão alta quando existir (hash com tempo em mediump serrilha) */
export const GLSL_PRECISION = '#ifdef GL_FRAGMENT_PRECISION_HIGH\nprecision highp float;\n#else\nprecision mediump float;\n#endif\n';

interface Prog { p: WebGLProgram; u: Map<string, WebGLUniformLocation | null>; aPos: number }

interface State {
  canvas: AnyCanvas;
  gl: WebGLRenderingContext;
  vs: WebGLShader;
  progs: Map<string, Prog | null>;
  /** compilações iniciadas pelo aquecimento e ainda não consultadas (KHR_parallel_shader_compile) */
  pending: Map<string, { p: WebGLProgram; fs: WebGLShader }>;
  parallel: boolean;
  tex: WebGLTexture[];
  maxTex: number;
  buf: WebGLBuffer;
}

let st: State | null | undefined;
let failures = 0;
/** chave do programa rodando agora: se o contexto cair durante ele, o shader vai p/ a lista negra */
let lastCustom: { key: string; at: number } | null = null;
const blacklist = new Set<string>();
/** programas "descartáveis" (código da IA) com prefixo 'c:' — LRU p/ não acumular */
const CUSTOM_MAX = 24;

/** só p/ testes/diagnóstico */
export const glStats = { inits: 0, programs: 0, lost: 0, runs: 0 };

/** última perda de contexto: espera ~1 s antes de recriar (getContext pode nascer perdido) */
let lastLost = -Infinity;
const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

function init(): State | null {
  if (st !== undefined) return st;
  if (nowMs() - lastLost < 1000) return null;
  st = null;
  if (failures > 2) return null; // não insiste em aparelho sem WebGL
  try {
    if (typeof document === 'undefined' && typeof OffscreenCanvas === 'undefined') return null;
    const canvas = makeCanvas(16, 16);
    const gl = (canvas as HTMLCanvasElement).getContext('webgl', {
      alpha: true, premultipliedAlpha: true, preserveDrawingBuffer: true, antialias: false, depth: false, stencil: false,
    }) as WebGLRenderingContext | null;
    if (!gl) { failures++; return null; }
    const vs = gl.createShader(gl.VERTEX_SHADER)!;
    gl.shaderSource(vs, VERT); gl.compileShader(vs);
    if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS)) { failures++; return null; }
    const buf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const tex: WebGLTexture[] = [];
    for (let i = 0; i < 2; i++) {
      const t = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      tex.push(t);
    }
    const lost = (e: Event) => {
      e.preventDefault();
      glStats.lost++;
      // a perda chega assíncrona: culpa o último shader da IA rodado nos últimos 3 s (pesado/infinito)
      if (lastCustom && Date.now() - lastCustom.at < 3000) blacklist.add(lastCustom.key);
      lastLost = nowMs();
      st = undefined; // recria na próxima chamada (programas antigos morreram com o contexto)
    };
    (canvas as HTMLCanvasElement).addEventListener?.('webglcontextlost', lost as EventListener, false);
    glStats.inits++;
    st = { canvas, gl, vs, progs: new Map(), pending: new Map(), parallel: !!gl.getExtension('KHR_parallel_shader_compile'), tex, maxTex: gl.getParameter(gl.MAX_TEXTURE_SIZE) as number, buf };
  } catch (e) {
    failures++;
    console.warn('[fx] WebGL indisponível, usando fallback 2D', e);
    st = null;
  }
  return st;
}

export function fxGLAvailable(): boolean {
  return !!init();
}

function program(S: State, key: string, frag: string): Prog | null {
  if (blacklist.has(key)) return null;
  if (S.progs.has(key)) {
    const hit = S.progs.get(key)!;
    if (key.startsWith('c:')) { S.progs.delete(key); S.progs.set(key, hit); } // LRU: vai p/ o fim
    return hit;
  }
  const { gl } = S;
  const pend = S.pending.get(key);
  if (pend) { S.pending.delete(key); return finalize(S, key, pend.p, pend.fs); }
  if (key.startsWith('c:')) {
    const customs = [...S.progs.keys()].filter((k) => k.startsWith('c:'));
    for (const k of customs.slice(0, Math.max(0, customs.length - CUSTOM_MAX + 1))) {
      const old = S.progs.get(k);
      if (old) gl.deleteProgram(old.p);
      S.progs.delete(k);
    }
  }
  const fs = gl.createShader(gl.FRAGMENT_SHADER)!;
  gl.shaderSource(fs, frag); gl.compileShader(fs);
  const p = gl.createProgram()!;
  gl.attachShader(p, S.vs); gl.attachShader(p, fs); gl.linkProgram(p);
  return finalize(S, key, p, fs);
}

/** consulta o resultado (bloqueia só o que faltar da compilação) e guarda no cache */
function finalize(S: State, key: string, p: WebGLProgram, fs: WebGLShader): Prog | null {
  const { gl } = S;
  if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
    console.warn('[fx] shader', key, gl.getShaderInfoLog(fs));
    gl.deleteShader(fs);
    gl.deleteProgram(p);
    S.progs.set(key, null); // não recompila a cada quadro
    return null;
  }
  gl.deleteShader(fs); // fica vivo enquanto anexado ao programa
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) { gl.deleteProgram(p); S.progs.set(key, null); return null; }
  glStats.programs++;
  const prog: Prog = { p, u: new Map(), aPos: gl.getAttribLocation(p, 'a_pos') };
  S.progs.set(key, prog);
  return prog;
}

export type UniformValue = number | readonly number[] | Float32Array;

export interface RunOpts {
  /** false = textura sobe com alfa "reto" (shaders da IA); padrão true (pré-multiplicada) */
  premultiply?: boolean;
}

/**
 * Roda o shader `frag` (chave de cache `key`) com até 2 texturas e devolve o
 * canvas GL W×H (null = sem WebGL / grande demais / erro → use o fallback).
 */
export function runFx(
  key: string, frag: string, textures: readonly (readonly [string, TexImageSource])[], W: number, H: number,
  uniforms: Record<string, UniformValue> = {}, opts: RunOpts = {},
): AnyCanvas | null {
  W = Math.round(W); H = Math.round(H);
  if (!(W > 0 && H > 0)) return null;
  const S = init();
  if (!S) return null;
  if (W > S.maxTex || H > S.maxTex) return null;
  const { gl, canvas } = S;
  if (gl.isContextLost()) { st = undefined; lastLost = nowMs(); return null; }
  const P = program(S, key, frag);
  if (!P) return null;
  if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
  gl.viewport(0, 0, W, H);
  gl.useProgram(P.p);
  gl.bindBuffer(gl.ARRAY_BUFFER, S.buf);
  gl.enableVertexAttribArray(P.aPos);
  gl.vertexAttribPointer(P.aPos, 2, gl.FLOAT, false, 0, 0);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, opts.premultiply !== false);
  const u = (n: string) => {
    if (!P.u.has(n)) P.u.set(n, gl.getUniformLocation(P.p, n));
    return P.u.get(n)!;
  };
  try {
    textures.slice(0, S.tex.length).forEach(([name, src], i) => {
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_2D, S.tex[i]);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
      gl.uniform1i(u(name), i);
    });
  } catch {
    return null; // fonte sem dados (vídeo ainda carregando, canvas "tainted")
  }
  gl.uniform2f(u('u_res'), W, H);
  for (const [n, v] of Object.entries(uniforms)) {
    const loc = u(n);
    if (!loc) continue;
    if (typeof v === 'number') gl.uniform1f(loc, Number.isFinite(v) ? v : 0);
    else if (v.length > 4) gl.uniform1fv(loc, v instanceof Float32Array ? v : new Float32Array(v));
    else if (v.length === 2) gl.uniform2f(loc, v[0], v[1]);
    else if (v.length === 3) gl.uniform3f(loc, v[0], v[1], v[2]);
    else if (v.length === 4) gl.uniform4f(loc, v[0], v[1], v[2], v[3]);
  }
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  if (key.startsWith('c:')) lastCustom = { key, at: Date.now() };
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  glStats.runs++;
  return canvas;
}

/** true se este programa (chave) já falhou ao compilar ou derrubou o contexto */
export function fxProgramFailed(key: string): boolean {
  if (blacklist.has(key)) return true;
  return !!st && st.progs.has(key) && st.progs.get(key) === null;
}

/**
 * Compila (e liga) um fragment shader só p/ checar. null = sem WebGL (vitest, aparelho sem GPU).
 * Não guarda o programa.
 */
export function glCompileCheck(frag: string): { ok: boolean; log: string } | null {
  const S = init();
  if (!S) return null;
  const { gl } = S;
  if (gl.isContextLost()) { st = undefined; return null; }
  const fs = gl.createShader(gl.FRAGMENT_SHADER);
  if (!fs) return null;
  gl.shaderSource(fs, frag);
  gl.compileShader(fs);
  if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(fs) ?? 'erro de compilação';
    gl.deleteShader(fs);
    return { ok: false, log };
  }
  const p = gl.createProgram()!;
  gl.attachShader(p, S.vs); gl.attachShader(p, fs); gl.linkProgram(p);
  const ok = !!gl.getProgramParameter(p, gl.LINK_STATUS);
  const log = ok ? '' : gl.getProgramInfoLog(p) ?? 'erro de ligação';
  gl.deleteProgram(p); gl.deleteShader(fs);
  return { ok, log };
}

/** '#RRGGBB' / '#RGB' → [r,g,b] 0..1 (fallback = laranja da marca) */
export function hexToRgb01(hex: string | undefined, fallback: [number, number, number] = [0.949, 0.408, 0.122]): [number, number, number] {
  if (!hex) return fallback;
  const m = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(hex.trim());
  if (!m) return fallback;
  const h = m[1].length === 3 ? [...m[1]].map((x) => x + x).join('') : m[1];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as [number, number, number];
}

/** só p/ testes (/dev/fx): contexto compartilhado atual */
export function fxContextForTests(): WebGLRenderingContext | null {
  return init()?.gl ?? null;
}

const COMPLETION_STATUS_KHR = 0x91B1;

export type WarmState = 'ready' | 'pending' | 'failed' | 'unavailable';

/**
 * Aquecimento sem travar a thread principal: inicia a compilação/ligação de `frag` (chave `key`)
 * e devolve na hora. Com KHR_parallel_shader_compile o driver compila em segundo plano; chame de
 * novo (no ócio) até dar 'ready'. Sem a extensão, a 1ª chamada só dispara e a 2ª finaliza (bloqueia
 * o que faltar). O uso real (runFx) sempre finaliza antes de desenhar: o export nunca pula efeito.
 */
export function prewarmFx(key: string, frag: string): WarmState {
  const S = init();
  if (!S) return 'unavailable';
  if (blacklist.has(key)) return 'failed';
  if (S.progs.has(key)) return S.progs.get(key) ? 'ready' : 'failed';
  const { gl } = S;
  if (gl.isContextLost()) return 'unavailable';
  const pend = S.pending.get(key);
  if (pend) {
    if (S.parallel && !gl.getProgramParameter(pend.p, COMPLETION_STATUS_KHR)) return 'pending';
    S.pending.delete(key);
    return finalize(S, key, pend.p, pend.fs) ? 'ready' : 'failed';
  }
  const fs = gl.createShader(gl.FRAGMENT_SHADER);
  const p = gl.createProgram();
  if (!fs || !p) return 'unavailable';
  gl.shaderSource(fs, frag); gl.compileShader(fs);
  gl.attachShader(p, S.vs); gl.attachShader(p, fs); gl.linkProgram(p);
  S.pending.set(key, { p, fs });
  return 'pending';
}

/** o driver compila em paralelo? (KHR_parallel_shader_compile) */
export function fxParallelCompile(): boolean {
  return !!init()?.parallel;
}
