/* =====================================================================
   Registro de LUTs: looks embutidos (gerados por código a partir de uma
   ColorGrade, assados em 33³ sob demanda) + LUTs .cube importadas
   (IndexedDB, chave = id). Leitura síncrona via getLut(id).
   ===================================================================== */
import type { ColorGrade } from '../types';
import { bakeLut, parseCube, type Lut3D } from './cube';
import { gradePixel, resolveGrade } from './pipeline';

export interface LookDef {
  id: string;
  name: string;
  /** cor de destaque p/ a miniatura sem quadro */
  swatch: [string, string];
  grade: ColorGrade;
  /** retoque extra por pixel depois da grade (ex.: cross-process) */
  post?: (rgb: Float32Array) => void;
}

const W = (r: number, g: number, b: number, y = 0) => ({ r, g, b, y });

/** looks prontos (todos convertidos em LUT 3D: o resultado é idêntico no preview e no export) */
export const BUILTIN_LOOKS: LookDef[] = [
  {
    id: 'look:teal-orange', name: 'Teal & Laranja', swatch: ['#1F6F78', '#F29A4A'],
    grade: {
      lift: W(-0.06, 0.0, 0.07, 0), gain: W(0.06, 0.01, -0.06, 0), contrast: 0.12, saturation: 0.05,
      hsl: { orange: { hue: 0, sat: 0.25, lum: 0.05 }, yellow: { hue: -0.35, sat: -0.1, lum: 0 }, green: { hue: 0.6, sat: -0.35, lum: 0 }, aqua: { hue: 0.1, sat: 0.2, lum: -0.05 }, blue: { hue: -0.3, sat: 0.1, lum: -0.05 } },
    },
  },
  {
    id: 'look:kodak-2383', name: 'Filme Kodak (2383)', swatch: ['#2B3A3A', '#E8B07A'],
    grade: {
      lift: W(-0.03, 0.01, 0.04, -0.02), gain: W(0.05, 0.02, -0.05, 0), contrast: 0.18, saturation: -0.08,
      curves: { master: [{ x: 0, y: 0.02 }, { x: 0.25, y: 0.2 }, { x: 0.75, y: 0.82 }, { x: 1, y: 0.97 }] },
      hsl: { red: { hue: 0.1, sat: 0.05, lum: -0.05 }, green: { hue: 0.2, sat: -0.25, lum: -0.05 } },
    },
  },
  {
    id: 'look:fuji-eterna', name: 'Filme Fuji (Eterna)', swatch: ['#3D4A44', '#CFC3A6'],
    grade: {
      lift: W(-0.02, 0.03, 0.02, 0.03), gain: W(0.0, 0.01, 0.0, -0.03), contrast: -0.12, saturation: -0.28,
      curves: { master: [{ x: 0, y: 0.05 }, { x: 0.5, y: 0.5 }, { x: 1, y: 0.95 }] },
      hsl: { green: { hue: 0.25, sat: -0.2, lum: 0 }, red: { hue: 0.05, sat: -0.1, lum: 0 } },
    },
  },
  {
    id: 'look:bleach-bypass', name: 'Bleach Bypass', swatch: ['#4A4E52', '#C9CCCF'],
    grade: { contrast: 0.38, saturation: -0.55, highlights: 0.08, shadows: -0.1, gain: W(0, 0.01, 0.02, 0) },
  },
  {
    id: 'look:noir', name: 'Noir (P&B)', swatch: ['#111111', '#E5E5E5'],
    grade: {
      saturation: -1, contrast: 0.3, shadows: -0.1,
      curves: { master: [{ x: 0, y: 0 }, { x: 0.3, y: 0.22 }, { x: 0.7, y: 0.8 }, { x: 1, y: 1 }] },
    },
  },
  {
    id: 'look:vintage', name: 'Vintage', swatch: ['#6B5A3E', '#E9D3A6'],
    grade: {
      temperature: 0.25, saturation: -0.3, contrast: -0.1, lift: W(0.03, 0.02, -0.02, 0.04),
      curves: { master: [{ x: 0, y: 0.09 }, { x: 0.5, y: 0.52 }, { x: 1, y: 0.92 }], b: [{ x: 0, y: 0.08 }, { x: 1, y: 0.9 }] },
    },
  },
  {
    id: 'look:cross-process', name: 'Cross-process', swatch: ['#2E5C3B', '#F2E36B'],
    grade: {
      curves: {
        r: [{ x: 0, y: 0 }, { x: 0.25, y: 0.18 }, { x: 0.75, y: 0.85 }, { x: 1, y: 1 }],
        g: [{ x: 0, y: 0 }, { x: 0.3, y: 0.25 }, { x: 0.7, y: 0.8 }, { x: 1, y: 1 }],
        b: [{ x: 0, y: 0.18 }, { x: 1, y: 0.78 }],
      },
      saturation: 0.15, contrast: 0.08,
    },
  },
  {
    id: 'look:day-for-night', name: 'Noite americana', swatch: ['#0E1A33', '#4C6A9E'],
    grade: { exposure: -0.55, temperature: -0.6, saturation: -0.45, contrast: 0.15, gain: W(-0.04, 0.0, 0.08, 0), lift: W(-0.02, -0.01, 0.03, -0.02) },
  },
  {
    id: 'look:warm-film', name: 'Filme quente', swatch: ['#5A3A22', '#F5C27D'],
    grade: {
      temperature: 0.35, tint: 0.05, contrast: 0.08, saturation: 0.05, lift: W(0.02, 0.0, -0.03, 0.02),
      curves: { master: [{ x: 0, y: 0.04 }, { x: 0.5, y: 0.53 }, { x: 1, y: 0.97 }] },
    },
  },
  {
    id: 'look:cool-film', name: 'Filme frio', swatch: ['#23384A', '#A9C4D9'],
    grade: {
      temperature: -0.35, tint: -0.03, contrast: 0.1, saturation: -0.1, lift: W(-0.02, 0.0, 0.04, 0.01),
      curves: { master: [{ x: 0, y: 0.03 }, { x: 0.5, y: 0.49 }, { x: 1, y: 0.97 }] },
    },
  },
  {
    id: 'look:pastel', name: 'Pastel', swatch: ['#E8C9D6', '#BFE3DC'],
    grade: {
      saturation: -0.35, contrast: -0.25, exposure: 0.12, lift: W(0.02, 0.01, 0.03, 0.08),
      hsl: { red: { hue: -0.15, sat: 0, lum: 0.2 }, blue: { hue: -0.2, sat: 0, lum: 0.2 } },
    },
  },
  {
    id: 'look:summer', name: 'Verão vibrante', swatch: ['#F28C28', '#33B7E8'],
    grade: { saturation: 0.25, vibrance: 0.35, temperature: 0.18, contrast: 0.1, highlights: -0.08, hsl: { blue: { hue: 0, sat: 0.2, lum: 0 }, aqua: { hue: 0, sat: 0.2, lum: 0 } } },
  },
  {
    id: 'look:matte', name: 'Fosco', swatch: ['#3A3A3A', '#D8D2C8'],
    grade: { contrast: -0.15, saturation: -0.12, curves: { master: [{ x: 0, y: 0.1 }, { x: 0.2, y: 0.22 }, { x: 0.8, y: 0.82 }, { x: 1, y: 0.92 }] } },
  },
  {
    id: 'look:sepia', name: 'Sépia', swatch: ['#4A3420', '#E3C49A'],
    grade: { saturation: -1, temperature: 0, contrast: 0.05 },
    post: (c) => {
      // tonaliza a luminância com uma rampa marrom
      const l = c[0];
      c[0] = Math.min(1, l * 1.07 + 0.02); c[1] = Math.min(1, l * 0.94 + 0.01); c[2] = Math.min(1, l * 0.74);
    },
  },
  {
    id: 'look:moody', name: 'Dramático', swatch: ['#1C2326', '#8A7B6A'],
    grade: {
      exposure: -0.12, contrast: 0.25, saturation: -0.3, lift: W(-0.02, 0.01, 0.03, -0.03), gain: W(0.03, 0.01, -0.02, 0),
      hsl: { orange: { hue: 0, sat: 0.1, lum: 0 }, green: { hue: 0.3, sat: -0.4, lum: -0.1 }, blue: { hue: 0, sat: -0.3, lum: -0.1 } },
    },
  },
];

export const BUILTIN_LUT_SIZE = 33;

const registry = new Map<string, Lut3D>();
const listeners = new Set<() => void>();

function notify() { for (const f of listeners) { try { f(); } catch { /* ignora */ } } }

/** avisa quando uma LUT nova fica disponível (o preview pode redesenhar) */
export function onLutsChanged(f: () => void): () => void {
  listeners.add(f);
  return () => { listeners.delete(f); };
}

export function lookById(id: string): LookDef | undefined {
  return BUILTIN_LOOKS.find((l) => l.id === id);
}

export function bakeLook(look: LookDef, size = BUILTIN_LUT_SIZE): Lut3D {
  const R = resolveGrade(look.grade);
  return bakeLut(look.id, look.name, size, (r, g, b, out) => {
    gradePixel(R, r, g, b, out);
    for (let i = 0; i < 3; i++) out[i] = out[i] < 0 ? 0 : out[i] > 1 ? 1 : out[i];
    look.post?.(out);
  });
}

/** LUT pelo id (looks embutidos são assados na primeira chamada; importadas precisam de loadImportedLuts) */
export function getLut(id: string): Lut3D | null {
  const hit = registry.get(id);
  if (hit) return hit;
  const look = lookById(id);
  if (look) { const l = bakeLook(look); registry.set(id, l); return l; }
  if (id.startsWith('cube:') && !loading) void loadImportedLuts();
  return null;
}

export function registerLut(l: Lut3D): void {
  registry.set(l.id, l);
  notify();
}

/** LUTs importadas já carregadas na memória */
export function importedLuts(): Lut3D[] {
  return [...registry.values()].filter((l) => l.id.startsWith('cube:'));
}

/* ---------- IndexedDB ---------- */

const DB = 'editorpro-color';
const STORE = 'luts';
let loading: Promise<Lut3D[]> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((res) => {
    try {
      if (typeof indexedDB === 'undefined') return res(null);
      const rq = indexedDB.open(DB, 1);
      rq.onupgradeneeded = () => { if (!rq.result.objectStoreNames.contains(STORE)) rq.result.createObjectStore(STORE, { keyPath: 'id' }); };
      rq.onsuccess = () => res(rq.result);
      rq.onerror = () => res(null);
      rq.onblocked = () => res(null);
    } catch { res(null); }
  });
}

interface StoredLut { id: string; name: string; size: number; data: Float32Array; domainMin: number[]; domainMax: number[]; createdAt: number }

/** carrega as LUTs importadas do IndexedDB para o registro (idempotente) */
export function loadImportedLuts(): Promise<Lut3D[]> {
  if (loading) return loading;
  loading = (async () => {
    const db = await openDb();
    if (!db) return [];
    const all = await new Promise<StoredLut[]>((res) => {
      try {
        const rq = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
        rq.onsuccess = () => res((rq.result as StoredLut[]) ?? []);
        rq.onerror = () => res([]);
      } catch { res([]); }
    });
    db.close();
    const out: Lut3D[] = [];
    for (const s of all.sort((a, b) => a.createdAt - b.createdAt)) {
      if (!s || !s.id || !(s.data instanceof Float32Array) || s.data.length !== s.size ** 3 * 3) continue;
      const l: Lut3D = { id: s.id, name: s.name, size: s.size, data: s.data, domainMin: s.domainMin as Lut3D['domainMin'], domainMax: s.domainMax as Lut3D['domainMax'] };
      registry.set(l.id, l);
      out.push(l);
    }
    if (out.length) notify();
    return out;
  })();
  return loading;
}

/** id estável a partir do conteúdo (importar o mesmo arquivo duas vezes não duplica) */
export function cubeId(text: string): string {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return `cube:${(h >>> 0).toString(36)}`;
}

/** importa um .cube: valida, registra e salva no IndexedDB. Lança CubeParseError se inválido. */
export async function importCubeFile(file: File | { name: string; text: () => Promise<string> }): Promise<Lut3D> {
  const text = await file.text();
  const base = file.name.replace(/\.cube$/i, '');
  const lut = parseCube(text, cubeId(text), base);
  if (lut.name === 'LUT' || !lut.name) lut.name = base;
  registerLut(lut);
  const db = await openDb();
  if (db) {
    await new Promise<void>((res) => {
      try {
        const tx = db.transaction(STORE, 'readwrite');
        const rec: StoredLut = { id: lut.id, name: lut.name, size: lut.size, data: lut.data, domainMin: lut.domainMin, domainMax: lut.domainMax, createdAt: Date.now() };
        tx.objectStore(STORE).put(rec);
        tx.oncomplete = () => res();
        tx.onerror = () => res();
      } catch { res(); }
    });
    db.close();
  }
  return lut;
}

export async function deleteImportedLut(id: string): Promise<void> {
  registry.delete(id);
  notify();
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((res) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = () => res();
      tx.onerror = () => res();
    } catch { res(); }
  });
  db.close();
}

/** nome amigável de uma LUT pelo id */
export function lutName(id: string): string {
  return lookById(id)?.name ?? registry.get(id)?.name ?? 'LUT';
}
