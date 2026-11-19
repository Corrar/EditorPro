/* =====================================================================
   Pedidos "adiados" da IA: não viram EditOp no servidor porque precisam do
   navegador (Worker, DOMParser/canvas, Whisper). O validate os separa; o
   pipeline executa no aparelho e valida o resultado de novo.
     run_script {code}                       -> ops geradas por JS isolado
     add_graphic {svg, name, start, duration, trackId?, transform?, animation*?, keyframes?}
     update_graphic {assetId, svg}           -> re-rasteriza o gráfico
     generate_captions {language?}           -> transcrição Whisper local
   ===================================================================== */
import type { Id, MediaAsset, Project } from '../types';
import { projectDuration } from '../ops';
import { clampNum, isObj, r3, str } from './sanitize';

export const DEFERRED_MACROS = ['run_script', 'add_graphic', 'update_graphic', 'generate_captions'] as const;
export const MAX_SVG_CHARS = 200_000;
export const MAX_SCRIPT_CODE = 20_000;

export type Deferred =
  | { kind: 'script'; code: string; explain?: string }
  | { kind: 'graphic'; svg: string; name: string; start: number; duration: number; trackId?: string; clip: Record<string, unknown>; explain?: string }
  | { kind: 'update_graphic'; assetId: Id; svg: string; explain?: string }
  | { kind: 'captions'; language?: string };

export function isDeferredMacro(item: unknown): boolean {
  return isObj(item) && (DEFERRED_MACROS as readonly string[]).includes(String(item.op));
}

const looksLikeSvg = (s: string) => /^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(s);

/** valida o pedido (forma); o SVG em si é saneado no navegador (svg.ts) */
export function toDeferred(item: Record<string, unknown>, p: Project, assets: Record<Id, MediaAsset>): Deferred {
  const fail = (m: string): never => { throw new Error(m); };
  const explain = str(item.explain, 160);
  switch (item.op) {
    case 'run_script': {
      const code = typeof item.code === 'string' ? item.code : fail('run_script sem code');
      if (code.length > MAX_SCRIPT_CODE) fail(`script grande demais (máx. ${MAX_SCRIPT_CODE} caracteres)`);
      return { kind: 'script', code, ...(explain ? { explain } : {}) };
    }
    case 'add_graphic': {
      const svg = typeof item.svg === 'string' ? item.svg : fail('add_graphic sem svg');
      if (svg.length > MAX_SVG_CHARS) fail('SVG grande demais (máx. 200 KB)');
      if (!looksLikeSvg(svg)) fail('svg precisa começar com <svg …>');
      const dur = Math.max(1, projectDuration(p));
      const start = r3(clampNum(item.start, 0, dur) ?? 0);
      const duration = r3(clampNum(item.duration, 0.2, 3600) ?? Math.min(4, Math.max(0.5, dur - start)));
      const clip: Record<string, unknown> = {};
      for (const k of ['transform', 'animationIn', 'animationOut', 'animationLoop', 'keyframes', 'opacity', 'blendMode', 'effects', 'label']) if (item[k] !== undefined) clip[k] = item[k];
      const trackId = str(item.trackId, 80);
      return { kind: 'graphic', svg, name: str(item.name, 60) ?? 'Gráfico', start, duration, ...(trackId ? { trackId } : {}), clip, ...(explain ? { explain } : {}) };
    }
    case 'update_graphic': {
      const assetId = str(item.assetId, 80) ?? fail('update_graphic sem assetId');
      if (assets[assetId]?.role !== 'graphic') fail(`gráfico ${assetId} não existe`);
      const svg = typeof item.svg === 'string' ? item.svg : fail('update_graphic sem svg');
      if (svg.length > MAX_SVG_CHARS) fail('SVG grande demais (máx. 200 KB)');
      if (!looksLikeSvg(svg)) fail('svg precisa começar com <svg …>');
      return { kind: 'update_graphic', assetId, svg, ...(explain ? { explain } : {}) };
    }
    case 'generate_captions': {
      const language = str(item.language, 12);
      return { kind: 'captions', ...(language && /^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,4})?$/.test(language) ? { language } : {}) };
    }
  }
  return fail(`macro desconhecida: ${String(item.op)}`);
}

/** pedidos vindos da rota (JSON): revalida no cliente */
export function sanitizeDeferredList(v: unknown, p: Project, assets: Record<Id, MediaAsset>): Deferred[] {
  if (!Array.isArray(v)) return [];
  const out: Deferred[] = [];
  for (const d of v.slice(0, 12)) {
    if (!isObj(d)) continue;
    const op = d.kind === 'script' ? 'run_script' : d.kind === 'graphic' ? 'add_graphic' : d.kind === 'update_graphic' ? 'update_graphic' : d.kind === 'captions' ? 'generate_captions' : '';
    try { out.push(toDeferred({ ...d, ...(isObj(d.clip) ? d.clip : {}), op }, p, assets)); } catch { /* ignora */ }
  }
  return out;
}
