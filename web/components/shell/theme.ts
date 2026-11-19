'use client';
/* tema: segue o sistema (prefers-color-scheme) até o usuário escolher; escolha salva em ep_theme.
   Antes de saber (1º render/SSR) o valor é null: telas mostram só o fundo neutro (sem flash). */
import { useCallback, useEffect, useState } from 'react';

export const THEME_KEY = 'ep_theme';

export function systemDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function savedTheme(): 'dark' | 'light' | null {
  try { const v = localStorage.getItem(THEME_KEY); return v === 'dark' || v === 'light' ? v : null; } catch { return null; }
}

export function useTheme(): [boolean | null, () => void] {
  const [dark, setDark] = useState<boolean | null>(null);
  useEffect(() => {
    const s = savedTheme();
    setDark(s ? s === 'dark' : systemDark());
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onSys = () => { if (!savedTheme()) setDark(mq.matches); };
    mq.addEventListener('change', onSys);
    return () => mq.removeEventListener('change', onSys);
  }, []);
  const toggle = useCallback(() => {
    setDark((d) => {
      const next = !(d ?? systemDark());
      try { localStorage.setItem(THEME_KEY, next ? 'dark' : 'light'); } catch {}
      return next;
    });
  }, []);
  return [dark, toggle];
}
