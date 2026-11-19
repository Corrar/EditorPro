'use client';
/* pequenas peças de UI compartilhadas pelas galerias (design v2) */
import type { ReactNode } from 'react';
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
