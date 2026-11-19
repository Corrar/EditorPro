'use client';
/* pequenas peças de UI compartilhadas pelas galerias (design v2) */
import { useEffect as useEffect2, type ReactNode } from 'react';
import { useLibPrefs, type LibKind } from '@/lib/library/prefs';
import Icon, { type IconName } from '@/components/ui/Icon';

/** fileira rolável de pílulas de filtro/categoria */
export function PillRow<T extends string>({ value, options, onChange, label }: {
  value: T; options: { id: T; label: string }[]; onChange: (v: T) => void; label: string;
}) {
  return (
    <div className="ep-lib-pills" role="tablist" aria-label={label}>
      {options.map((o) => (
        <button key={o.id} type="button" role="tab" aria-selected={value === o.id}
          className={`ep-lib-pill${value === o.id ? ' on' : ''}`} onClick={() => onChange(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** busca em pílula */
export function SearchPill({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <label className="ep-searchpill ep-lib-search">
      <Icon name="search" size={18} />
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder} />
      {value && (
        <button type="button" className="ep-lib-clear" onClick={() => onChange('')} aria-label="Limpar busca"><Icon name="close" size={16} /></button>
      )}
    </label>
  );
}

/** cabeçalho de seção da galeria */
export function LibHead({ title, hint, icon, right }: { title: string; hint?: string; icon?: IconName; right?: ReactNode }) {
  return (
    <div className="ep-lib-head">
      {icon && <span className="ep-lib-headic"><Icon name={icon} size={20} /></span>}
      <div className="ep-lib-headtx">
        <div className="ep-lib-title">{title}</div>
        {hint && <div className="ep-lib-hint">{hint}</div>}
      </div>
      {right}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="ep-lib-empty">{children}</div>;
}

/* ---------- favoritos / recentes ---------- */

export const FAV = '__fav__';
export const REC = '__rec__';

/** favoritos/recentes de um tipo (hidrata do navegador na 1ª vez) */
export function usePrefs(kind: LibKind) {
  const hydrate = useLibPrefs((s) => s.hydrate);
  useEffect2(() => { hydrate(); }, [hydrate]);
  const favs = useLibPrefs((s) => s.favorites[kind]);
  const recents = useLibPrefs((s) => s.recents[kind]);
  const toggleFav = useLibPrefs((s) => s.toggleFav);
  const pushRecent = useLibPrefs((s) => s.pushRecent);
  return {
    favs, recents,
    toggle: (id: string) => toggleFav(kind, id),
    recent: (id: string) => pushRecent(kind, id),
    isFav: (id: string) => favs.includes(id),
  };
}

/** pílulas "Favoritos" e "Recentes" antes das categorias (só aparecem se houver itens) */
export function withPrefPills<T extends string>(opts: { id: T; label: string }[], favs: string[], recents: string[]): { id: T | typeof FAV | typeof REC; label: string }[] {
  const out: { id: T | typeof FAV | typeof REC; label: string }[] = [opts[0]];
  if (favs.length) out.push({ id: FAV, label: `★ Favoritos (${favs.length})` });
  if (recents.length) out.push({ id: REC, label: 'Recentes' });
  return [...out, ...opts.slice(1)];
}

/** filtra/ordena por pílula especial (favoritos/recentes mantêm a ordem salva) */
export function prefFilter<T extends { id: string }>(items: T[], cat: string, favs: string[], recents: string[]): T[] | null {
  if (cat === FAV) return favs.map((id) => items.find((x) => x.id === id)).filter((x): x is T => !!x);
  if (cat === REC) return recents.map((id) => items.find((x) => x.id === id)).filter((x): x is T => !!x);
  return null;
}

/** botão de favorito sobre a miniatura (alvo de 44px) */
export function FavButton({ on, onToggle, label }: { on: boolean; onToggle: () => void; label: string }) {
  return (
    <button type="button" aria-pressed={on} aria-label={on ? `Remover ${label} dos favoritos` : `Favoritar ${label}`}
      className={`ep-lib-fav${on ? ' on' : ''}`} onClick={(e) => { e.stopPropagation(); onToggle(); }}>
      <span aria-hidden>{on ? '★' : '☆'}</span>
    </button>
  );
}
