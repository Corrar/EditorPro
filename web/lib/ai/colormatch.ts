/* =====================================================================
   Combinar cor com a referência (puro, testado): estatísticas de cor do
   vídeo modelo × material -> ColorGrade (contrato estilo DaVinci).
   - offset por canal: equilíbrio de cor (sem mexer no brilho)
   - exposure: diferença de brilho médio
   - contrast: razão dos desvios de luminância
   - saturation: diferença relativa de saturação
   Valores conservadores (o motor de cor da sessão "cor" interpreta).
   ===================================================================== */
import type { ColorGrade, Filter, FilterKind, Id, Project } from '../types';
import type { EditOp } from '../ops';
import type { ColorStats } from './frames';
import { r3 } from './sanitize';

const clamp = (v: number, lo = -1, hi = 1) => Math.max(lo, Math.min(hi, v));

/**
 * O motor de cor (sessão "cor") ainda não renderiza `colorGrade`. Enquanto isso o match é aplicado
 * como `filters` equivalentes (que já renderizam). A principal avisa quando virar para true —
 * aí usamos colorGrade e paramos de mandar os filtros (para não aplicar duas vezes).
 */
export const COLOR_GRADE_LIVE = true; // motor de cor ligado (integração f5375ce: preview + export)

const GRADE_FILTER_KINDS: FilterKind[] = ['temperature', 'tint', 'exposure', 'contrast', 'saturation'];

/** ColorGrade -> filtros equivalentes do engine (aproximação: equilíbrio via temperatura/matiz) */
export function gradeToFilters(g: ColorGrade): Filter[] {
  const out: Filter[] = [];
  const o = g.offset;
  if (o) {
    const temp = r3(clamp((o.r - o.b) * 2));
    const tint = r3(clamp(-(o.g - (o.r + o.b) / 2) * 3));
    if (Math.abs(temp) > 0.02) out.push({ kind: 'temperature', value: temp });
    if (Math.abs(tint) > 0.02) out.push({ kind: 'tint', value: tint });
  }
  if (g.exposure) out.push({ kind: 'exposure', value: r3(clamp(g.exposure)) });
  if (g.contrast) out.push({ kind: 'contrast', value: r3(clamp(g.contrast)) });
  if (g.saturation) out.push({ kind: 'saturation', value: r3(clamp(g.saturation)) });
  return out;
}

export function matchColorGrade(model: ColorStats, material: ColorStats, strength = 1): ColorGrade {
  const s = Math.max(0, Math.min(1, strength));
  const dl = model.lum - material.lum;
  const off = (m: number, x: number) => r3(clamp(((m - x) - dl) * s, -0.3, 0.3));
  const g: ColorGrade = {};
  const offset = { r: off(model.r, material.r), g: off(model.g, material.g), b: off(model.b, material.b), y: 0 };
  if (Math.abs(offset.r) + Math.abs(offset.g) + Math.abs(offset.b) > 0.01) g.offset = offset;
  const exposure = r3(clamp(dl * 1.5 * s, -0.6, 0.6));
  if (Math.abs(exposure) > 0.02) g.exposure = exposure;
  if (model.lumSd && material.lumSd && material.lumSd > 0.01) {
    const contrast = r3(clamp((model.lumSd / material.lumSd - 1) * 0.8 * s, -0.6, 0.6));
    if (Math.abs(contrast) > 0.02) g.contrast = contrast;
  }
  const saturation = r3(clamp(((model.sat - material.sat) / Math.max(material.sat, 0.1)) * 0.8 * s, -1, 0.8));
  if (Math.abs(saturation) > 0.02) g.saturation = saturation;
  return g;
}

/** update_clip {colorGrade} nos clipes visuais do material (não mexe no vídeo modelo nem em gráficos) */
export function colorGradeOps(p: Project, gradeByAsset: Record<Id, ColorGrade>, label = 'Combinando a cor com o modelo', live = COLOR_GRADE_LIVE): EditOp[] {
  const ops: EditOp[] = [];
  for (const t of p.tracks) {
    if (t.kind !== 'video' && t.kind !== 'overlay') continue;
    for (const c of t.clips) {
      if ((c.type !== 'video' && c.type !== 'image') || c.locked) continue;
      const g = gradeByAsset[c.assetId];
      if (!g || !Object.keys(g).length) continue;
      // nunca zera o colorPreset; sem o motor de cor, vai como filtros equivalentes (substituindo só os mesmos tipos)
      const patch = live
        ? { colorGrade: g }
        : { filters: [...(c.filters ?? []).filter((f) => !GRADE_FILTER_KINDS.includes(f.kind)), ...gradeToFilters(g)] };
      if (!live && !gradeToFilters(g).length) continue;
      ops.push({ op: 'update_clip', clipId: c.id, patch, explain: ops.length ? `Cor do modelo no clipe de ${c.start.toFixed(1).replace('.', ',')} s` : label } as EditOp);
    }
  }
  return ops;
}
