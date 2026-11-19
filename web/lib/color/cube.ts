/* =====================================================================
   LUT 3D: tipo, parser/gerador de .cube (Adobe/Resolve) e amostragem
   trilinear de referência (CPU). Ordem dos dados no .cube: R varia mais
   rápido, depois G, depois B.
   ===================================================================== */

export interface Lut3D {
  id: string;
  name: string;
  size: number;
  /** size³ × 3 floats (RGB), R mais rápido; valores já mapeados p/ saída 0..1 */
  data: Float32Array;
  /** domínio de ENTRADA (DOMAIN_MIN/MAX); padrão 0..1 */
  domainMin: [number, number, number];
  domainMax: [number, number, number];
}

export class CubeParseError extends Error {}

const MAX_SIZE = 129;

/** lê um arquivo .cube (3D; LUT 1D é convertida para 3D 33³) */
export function parseCube(text: string, id = 'lut', fallbackName = 'LUT'): Lut3D {
  let size3 = 0, size1 = 0;
  let title = '';
  let dmin: [number, number, number] = [0, 0, 0], dmax: [number, number, number] = [1, 1, 1];
  const vals: number[] = [];
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  for (let ln = 0; ln < lines.length; ln++) {
    const raw = lines[ln];
    const hash = raw.indexOf('#');
    const line = (hash >= 0 ? raw.slice(0, hash) : raw).trim();
    if (!line) continue;
    const up = line.toUpperCase();
    if (up.startsWith('TITLE')) { const m = line.match(/TITLE\s+"?([^"]*)"?/i); title = m ? m[1].trim() : ''; continue; }
    if (up.startsWith('LUT_3D_SIZE')) { size3 = parseInt(line.split(/\s+/)[1], 10); continue; }
    if (up.startsWith('LUT_1D_SIZE')) { size1 = parseInt(line.split(/\s+/)[1], 10); continue; }
    if (up.startsWith('DOMAIN_MIN')) { dmin = triple(line, ln); continue; }
    if (up.startsWith('DOMAIN_MAX')) { dmax = triple(line, ln); continue; }
    if (up.startsWith('LUT_1D_INPUT_RANGE') || up.startsWith('LUT_3D_INPUT_RANGE')) {
      const p = line.split(/\s+/).slice(1).map(Number);
      if (p.length >= 2 && p.every(Number.isFinite)) { dmin = [p[0], p[0], p[0]]; dmax = [p[1], p[1], p[1]]; }
      continue;
    }
    if (/^[A-Z_]+(\s|$)/.test(up) && !/^[-+.\d]/.test(line)) continue; // palavra-chave desconhecida
    const p = line.split(/\s+/);
    if (p.length < 3) throw new CubeParseError(`linha ${ln + 1}: esperado "R G B"`);
    for (let i = 0; i < 3; i++) {
      const v = Number(p[i]);
      if (!Number.isFinite(v)) throw new CubeParseError(`linha ${ln + 1}: número inválido "${p[i]}"`);
      vals.push(v);
    }
  }
  for (let i = 0; i < 3; i++) if (!(dmax[i] > dmin[i])) throw new CubeParseError('DOMAIN_MAX deve ser maior que DOMAIN_MIN');
  const name = title || fallbackName;
  if (size3) {
    if (!(size3 >= 2 && size3 <= MAX_SIZE)) throw new CubeParseError(`LUT_3D_SIZE inválido: ${size3}`);
    const need = size3 * size3 * size3 * 3;
    if (vals.length < need) throw new CubeParseError(`dados incompletos: ${vals.length / 3} de ${need / 3} entradas`);
    return { id, name, size: size3, data: Float32Array.from(vals.slice(0, need)), domainMin: dmin, domainMax: dmax };
  }
  if (size1) {
    if (!(size1 >= 2 && size1 <= 65536)) throw new CubeParseError(`LUT_1D_SIZE inválido: ${size1}`);
    if (vals.length < size1 * 3) throw new CubeParseError('dados incompletos na LUT 1D');
    const one = vals.slice(0, size1 * 3);
    const s1 = (ch: number, x: number) => {
      const f = Math.max(0, Math.min(1, x)) * (size1 - 1);
      const i = Math.min(size1 - 2, Math.floor(f));
      const a = f - i;
      return one[i * 3 + ch] * (1 - a) + one[(i + 1) * 3 + ch] * a;
    };
    const N = 33;
    const data = new Float32Array(N * N * N * 3);
    let o = 0;
    for (let b = 0; b < N; b++) for (let g = 0; g < N; g++) for (let r = 0; r < N; r++) {
      data[o++] = s1(0, r / (N - 1)); data[o++] = s1(1, g / (N - 1)); data[o++] = s1(2, b / (N - 1));
    }
    return { id, name, size: N, data, domainMin: dmin, domainMax: dmax };
  }
  throw new CubeParseError('arquivo sem LUT_3D_SIZE');
}

function triple(line: string, ln: number): [number, number, number] {
  const p = line.split(/\s+/).slice(1, 4).map(Number);
  if (p.length < 3 || !p.every(Number.isFinite)) throw new CubeParseError(`linha ${ln + 1}: domínio inválido`);
  return [p[0], p[1], p[2]];
}

/** escreve um .cube (para exportar looks) */
export function writeCube(lut: Lut3D): string {
  const out: string[] = [`TITLE "${lut.name.replace(/"/g, "'")}"`, `LUT_3D_SIZE ${lut.size}`];
  if (lut.domainMin.some((v) => v !== 0) || lut.domainMax.some((v) => v !== 1)) {
    out.push(`DOMAIN_MIN ${lut.domainMin.join(' ')}`, `DOMAIN_MAX ${lut.domainMax.join(' ')}`);
  }
  for (let i = 0; i < lut.data.length; i += 3) out.push(`${lut.data[i].toFixed(6)} ${lut.data[i + 1].toFixed(6)} ${lut.data[i + 2].toFixed(6)}`);
  return out.join('\n') + '\n';
}

/** gera uma LUT a partir de uma função rgb→rgb */
export function bakeLut(id: string, name: string, size: number, f: (r: number, g: number, b: number, out: Float32Array) => void): Lut3D {
  const data = new Float32Array(size * size * size * 3);
  const tmp = new Float32Array(3);
  let o = 0;
  for (let b = 0; b < size; b++) for (let g = 0; g < size; g++) for (let r = 0; r < size; r++) {
    f(r / (size - 1), g / (size - 1), b / (size - 1), tmp);
    data[o++] = tmp[0]; data[o++] = tmp[1]; data[o++] = tmp[2];
  }
  return { id, name, size, data, domainMin: [0, 0, 0], domainMax: [1, 1, 1] };
}

/** amostragem trilinear (entrada no domínio da LUT); escreve em out */
export function sampleLut(lut: Lut3D, r: number, g: number, b: number, out: Float32Array | number[]): void {
  const N = lut.size, d = lut.data;
  const n = (v: number, i: number) => {
    const x = (v - lut.domainMin[i]) / (lut.domainMax[i] - lut.domainMin[i]);
    return (x < 0 ? 0 : x > 1 ? 1 : x) * (N - 1);
  };
  const fr = n(r, 0), fg = n(g, 1), fb = n(b, 2);
  const r0 = Math.min(N - 2, Math.floor(fr)), g0 = Math.min(N - 2, Math.floor(fg)), b0 = Math.min(N - 2, Math.floor(fb));
  const ar = fr - r0, ag = fg - g0, ab = fb - b0;
  const idx = (ri: number, gi: number, bi: number) => ((bi * N + gi) * N + ri) * 3;
  for (let ch = 0; ch < 3; ch++) {
    const c000 = d[idx(r0, g0, b0) + ch], c100 = d[idx(r0 + 1, g0, b0) + ch];
    const c010 = d[idx(r0, g0 + 1, b0) + ch], c110 = d[idx(r0 + 1, g0 + 1, b0) + ch];
    const c001 = d[idx(r0, g0, b0 + 1) + ch], c101 = d[idx(r0 + 1, g0, b0 + 1) + ch];
    const c011 = d[idx(r0, g0 + 1, b0 + 1) + ch], c111 = d[idx(r0 + 1, g0 + 1, b0 + 1) + ch];
    const c00 = c000 + (c100 - c000) * ar, c10 = c010 + (c110 - c010) * ar;
    const c01 = c001 + (c101 - c001) * ar, c11 = c011 + (c111 - c011) * ar;
    const c0 = c00 + (c10 - c00) * ag, c1 = c01 + (c11 - c01) * ag;
    out[ch] = c0 + (c1 - c0) * ab;
  }
}

/** grade do atlas 2D (fatias de B lado a lado em colunas×linhas, cabe em 4096 até 129³) */
export function lutAtlasLayout(size: number) {
  const cols = Math.ceil(Math.sqrt(size));
  const rows = Math.ceil(size / cols);
  return { cols, rows, width: cols * size, height: rows * size };
}

/** atlas RGBA8 para a GPU (WebGL1/2 com filtro LINEAR) */
export function lutAtlasData(lut: Lut3D): { data: Uint8Array; width: number; height: number; cols: number } {
  const N = lut.size;
  const { cols, width, height } = lutAtlasLayout(N);
  const data = new Uint8Array(width * height * 4);
  const q = (v: number) => (v <= 0 ? 0 : v >= 1 ? 255 : Math.round(v * 255));
  for (let b = 0; b < N; b++) {
    const tx = (b % cols) * N, ty = Math.floor(b / cols) * N;
    for (let g = 0; g < N; g++) for (let r = 0; r < N; r++) {
      const s = ((b * N + g) * N + r) * 3;
      const o = ((ty + g) * width + tx + r) * 4;
      data[o] = q(lut.data[s]); data[o + 1] = q(lut.data[s + 1]); data[o + 2] = q(lut.data[s + 2]); data[o + 3] = 255;
    }
  }
  return { data, width, height, cols };
}
