/* normalização dos catálogos da sessão FX (puro, testado). Aceita lista de objetos
   ({ id|kind, label|name|title, category? }) ou mapa id → rótulo/objeto. */
export interface CatItem { id: string; label: string; category?: string }

export function normalizeCatalog(raw: unknown): CatItem[] | null {
  if (!raw) return null;
  const out: CatItem[] = [];
  const push = (id: unknown, v: unknown) => {
    if (typeof id !== 'string' || !id) return;
    if (typeof v === 'string') { out.push({ id, label: v }); return; }
    if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      const label = [o.label, o.name, o.title].find((x) => typeof x === 'string') as string | undefined;
      const category = [o.category, o.group].find((x) => typeof x === 'string') as string | undefined;
      out.push({ id, label: label ?? id, ...(category ? { category } : {}) });
    }
  };
  if (Array.isArray(raw)) {
    for (const v of raw) {
      if (typeof v === 'string') push(v, v);
      else if (v && typeof v === 'object') { const o = v as Record<string, unknown>; push(o.id ?? o.kind, v); }
    }
  } else if (typeof raw === 'object') {
    for (const [id, v] of Object.entries(raw as Record<string, unknown>)) push(id, v);
  }
  const seen = new Set<string>();
  const dedup = out.filter((x) => (seen.has(x.id) ? false : (seen.add(x.id), true)));
  return dedup.length ? dedup : null;
}
