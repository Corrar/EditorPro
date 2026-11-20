/* =====================================================================
   KEYFRAMES UNIVERSAIS ("IA sem limites"): resolve `Keyframe.props` — qualquer
   propriedade numérica ou de cor do clipe, por caminho — no tempo local.
   Puro e testado (animate.test.ts). Usado pelo desenho (preview e export),
   pelo modo nativo do preview e pela automação de áudio.

   Caminhos aceitos (exemplos):
     'volume' · 'fadeIn' · 'fadeOut' · 'scale' · 'rotation' · 'fill' · 'stroke' · 'cornerRadius'
     'style.fontSize' · 'style.color' · 'style.strokeWidth' · 'style.letterSpacing' · 'style.opacity'
     'style.highlightColor' · 'style.background' · 'position.x' · 'position.y'
     'effects.0.intensity' · 'effects.1.speed' · 'effects.0.angle' · 'effects.0.params.0' (uParams[0..7]
     do shader da IA; também 'transitionIn.params.N')
     'filters.brightness' (o value do Filter daquele kind; cria se não existir)
     'colorGrade.saturation' · 'colorGrade.lift.r' (cria colorGrade se faltar)
     'mask.x|y|w|h|rotation|feather' · 'chromaKey.similarity|smoothness'
   Regras:
   - números interpolam; cores '#RGB' / '#RRGGBB' / 'rgb(a)()' interpolam em RGB(A);
     outras strings trocam quando o keyframe é atingido;
   - easing de um keyframe vale para o trecho que TERMINA nele (igual ao transform);
     antes do 1º keyframe segura o 1º valor, depois do último segura o último;
   - caminho inválido ou valor de tipo estranho é ignorado (nunca lança);
   - 'speed' (e curvas de velocidade) NÃO é animável aqui: mexe no tempo da mídia
     (sourceTime), não num valor do quadro — é ignorado de propósito;
   - sem props → devolve o MESMO objeto (custo zero); com props, o último resultado
     por clipe/tempo fica em cache (não aloca de novo no mesmo quadro).
   ===================================================================== */
import type { Clip, Keyframe } from '../types';
import { ease, lerp } from './easing';

type Val = number | string;
interface Track { path: string[]; keys: { t: number; v: Val; easing: Keyframe['easing'] }[] }
interface Plan { tracks: Track[] }

const NOT_ANIMATABLE = new Set(['speed', 'speedCurve', 'speedPreset', 'in', 'start', 'duration', 'id', 'type', 'assetId', 'reverse']);
const BAD_KEY = new Set(['__proto__', 'prototype', 'constructor']);

/* ---------- cores ---------- */

export type RGBA = [number, number, number, number];

/** '#RGB' | '#RGBA' | '#RRGGBB' | '#RRGGBBAA' | 'rgb(r,g,b)' | 'rgba(r,g,b,a)' → [r,g,b,a] (a 0..1); senão null */
export function parseColor(s: string): RGBA | null {
  const v = s.trim();
  let m = /^#([0-9a-f]{3,8})$/i.exec(v);
  if (m) {
    const h = m[1];
    if (h.length === 3 || h.length === 4) {
      const n = h.split('').map((c) => parseInt(c + c, 16));
      return [n[0], n[1], n[2], h.length === 4 ? n[3] / 255 : 1];
    }
    if (h.length === 6 || h.length === 8) {
      const n = [0, 2, 4, 6].map((i) => parseInt(h.slice(i, i + 2), 16));
      return [n[0], n[1], n[2], h.length === 8 ? n[3] / 255 : 1];
    }
    return null;
  }
  m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(v);
  if (m) {
    const a = m[4] === undefined ? 1 : Number(m[4]);
    const r = [Number(m[1]), Number(m[2]), Number(m[3]), a];
    if (r.some((x) => !Number.isFinite(x))) return null;
    return [r[0], r[1], r[2], r[3]] as RGBA;
  }
  return null;
}

const hex2 = (n: number) => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, '0');

/** mistura duas cores; sai em '#rrggbb' (ou 'rgba()' se houver transparência) */
export function lerpColor(a: string, b: string, p: number): string | null {
  const ca = parseColor(a), cb = parseColor(b);
  if (!ca || !cb) return null;
  const c = ca.map((x, i) => lerp(x, cb[i], p)) as RGBA;
  if (c[3] >= 0.999) return `#${hex2(c[0])}${hex2(c[1])}${hex2(c[2])}`;
  return `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${Math.round(c[3] * 1000) / 1000})`;
}

/* ---------- plano (por lista de keyframes, em cache) ---------- */

const planCache = new WeakMap<Keyframe[], Plan | null>();

function planOf(kfs: Keyframe[] | undefined): Plan | null {
  if (!kfs || !kfs.length) return null;
  if (planCache.has(kfs)) return planCache.get(kfs)!;
  const byPath = new Map<string, Track>();
  for (const k of kfs) {
    if (!k || !k.props || typeof k.props !== 'object' || !Number.isFinite(k.t)) continue;
    for (const [rawPath, v] of Object.entries(k.props)) {
      if (typeof v === 'number' ? !Number.isFinite(v) : typeof v !== 'string') continue;
      const path = rawPath.split('.').filter(Boolean);
      if (!path.length || path.some((s) => BAD_KEY.has(s)) || NOT_ANIMATABLE.has(path[0])) continue;
      let tr = byPath.get(rawPath);
      if (!tr) { tr = { path, keys: [] }; byPath.set(rawPath, tr); }
      tr.keys.push({ t: k.t, v, easing: k.easing });
    }
  }
  const tracks = [...byPath.values()];
  tracks.forEach((tr) => tr.keys.sort((a, b) => a.t - b.t));
  const plan = tracks.length ? { tracks } : null;
  planCache.set(kfs, plan);
  return plan;
}

/** valor de uma trilha no tempo local (null = não dá p/ resolver) */
export function valueAt(keys: Track['keys'], t: number): Val | null {
  if (!keys.length) return null;
  if (t <= keys[0].t) return keys[0].v;
  const last = keys[keys.length - 1];
  if (t >= last.t) return last.v;
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i], c = keys[i + 1];
    if (t < a.t || t > c.t) continue;
    const span = c.t - a.t;
    const p = span <= 0 ? 1 : ease(c.easing, (t - a.t) / span);
    if (typeof a.v === 'number' && typeof c.v === 'number') return lerp(a.v, c.v, p);
    if (typeof a.v === 'string' && typeof c.v === 'string') {
      const mixed = lerpColor(a.v, c.v, p);
      if (mixed !== null) return mixed;
    }
    // string (não cor) ou tipos diferentes: troca quando o keyframe é atingido
    return p >= 1 ? c.v : a.v;
  }
  return last.v;
}

/* ---------- aplicação por caminho (imutável, só copia o que muda) ---------- */

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => !!x && typeof x === 'object' && !Array.isArray(x);

/** pode receber o valor? (mesmo tipo do atual; ausente: número/cor aceitos) */
function compatible(cur: unknown, v: Val): boolean {
  if (cur === undefined || cur === null) return true;
  return typeof cur === typeof v;
}

/** grava `v` em `root` seguindo `path`; devolve a raiz nova ou null se o caminho não serve */
function setPath(root: Obj, path: string[], v: Val): Obj | null {
  const [head, ...rest] = path;
  // 'filters.<kind>' → value do Filter daquele kind (cria se faltar)
  if (head === 'filters' && rest.length === 1) {
    if (typeof v !== 'number') return null;
    const list = Array.isArray(root.filters) ? (root.filters as { kind: string; value: number }[]) : [];
    const i = list.findIndex((f) => f && f.kind === rest[0]);
    const next = list.slice();
    if (i >= 0) next[i] = { ...list[i], value: v }; else next.push({ kind: rest[0], value: v });
    return { ...root, filters: next };
  }
  // 'effects.N.campo(.sub)' → índice numérico existente
  if (head === 'effects') {
    const list = root.effects;
    const idx = Number(rest[0]);
    if (!Array.isArray(list) || !Number.isInteger(idx) || idx < 0 || idx >= list.length || rest.length < 2) return null;
    const item = list[idx];
    if (!isObj(item)) return null;
    const sub = setPath(item, rest.slice(1), v);
    if (!sub) return null;
    const next = list.slice();
    next[idx] = sub;
    return { ...root, effects: next };
  }
  // 'params.I' (uParams[0..7] dos shaders da IA): lista numérica, índice 0..7 (completa com zeros)
  if (head === 'params' && rest.length === 1) {
    const idx = Number(rest[0]);
    if (typeof v !== 'number' || !Number.isInteger(idx) || idx < 0 || idx > 7) return null;
    const cur = root.params;
    if (cur !== undefined && !Array.isArray(cur)) return null;
    const next = Array.isArray(cur) ? (cur as unknown[]).slice() : [];
    while (next.length < idx) next.push(0);
    next[idx] = v;
    return { ...root, params: next };
  }
  if (!rest.length) {
    if (!compatible(root[head], v)) return null;
    return { ...root, [head]: v };
  }
  let child = root[head];
  if (child === undefined && head === 'colorGrade') child = {};
  // rodas da correção de cor (lift/gamma/gain/offset) também podem faltar
  if (child === undefined && path.length === 2 && isObj(root) && ['lift', 'gamma', 'gain', 'offset'].includes(head)) child = {};
  if (!isObj(child)) return null;
  const sub = setPath(child, rest, v);
  return sub ? { ...root, [head]: sub } : null;
}

/* ---------- API ---------- */

const lastResult = new WeakMap<Clip, { t: number; out: Clip }>();

/** o clipe tem keyframes de props? (barato: usa o plano em cache) */
export function hasPropKeyframes(clip: Clip): boolean {
  return !!planOf((clip as { keyframes?: Keyframe[] }).keyframes);
}

/** o clipe tem automação de volume (props.volume)? */
export function hasVolumeKeyframes(clip: Clip): boolean {
  const plan = planOf((clip as { keyframes?: Keyframe[] }).keyframes);
  return !!plan && plan.tracks.some((tr) => tr.path.length === 1 && (tr.path[0] === 'volume' || tr.path[0] === 'fadeIn' || tr.path[0] === 'fadeOut'));
}

/**
 * Alguma prop animada está MUDANDO em `tLocal` (entre o 1º e o último keyframe de uma trilha com
 * valores diferentes)? Fora disso o valor fica parado — caches por valor (bitmap de texto) voltam a servir.
 * `prefix` limita aos caminhos que começam por ele (ex.: 'style.').
 */
export function propsChangingAt(clip: Clip, tLocal: number, prefix = ''): boolean {
  const plan = planOf((clip as { keyframes?: Keyframe[] }).keyframes);
  if (!plan) return false;
  for (const tr of plan.tracks) {
    if (prefix && !(tr.path.join('.') + '.').startsWith(prefix)) continue;
    const k = tr.keys;
    if (k.length < 2 || tLocal <= k[0].t || tLocal >= k[k.length - 1].t) continue;
    if (k.some((x) => x.v !== k[0].v)) return true;
  }
  return false;
}

/**
 * Clipe com as props animadas resolvidas no tempo local `tLocal` (segundos desde o início do clipe).
 * Sem props: devolve o mesmo objeto. Caminho inválido: ignorado.
 */
export function animateClip<C extends Clip>(clip: C, tLocal: number): C {
  const plan = planOf((clip as { keyframes?: Keyframe[] }).keyframes);
  if (!plan) return clip;
  const t = Number.isFinite(tLocal) ? tLocal : 0;
  const hit = lastResult.get(clip);
  if (hit && hit.t === t) return hit.out as C;
  let out: Obj = clip as unknown as Obj;
  for (const tr of plan.tracks) {
    const v = valueAt(tr.keys, t);
    if (v === null) continue;
    const next = setPath(out, tr.path, v);
    if (next) out = next;
  }
  lastResult.set(clip, { t, out: out as unknown as Clip });
  return out as unknown as C;
}
