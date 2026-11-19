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

const BASE = { light: '#FFFFFF', dark: '#0D0D0F' };
export const HERO_COLOR = '#EC6418';

/** cor da barra de status/gestos do sistema (meta theme-color) e tema no <html> */
export function applySystemChrome(dark: boolean, heroTop = false): void {
  if (typeof document === 'undefined') return;
  const color = heroTop ? HERO_COLOR : dark ? BASE.dark : BASE.light;
  const metas = Array.from(document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]'));
  if (!metas.length) {
    const m = document.createElement('meta');
    m.name = 'theme-color';
    document.head.appendChild(m);
    metas.push(m);
  }
  // remove variações por media query para a cor escolhida valer sempre
  metas.forEach((m, i) => { if (i === 0) { m.content = color; m.removeAttribute('media'); } else m.remove(); });
  const html = document.documentElement;
  html.classList.toggle('dark', dark);
  html.style.colorScheme = dark ? 'dark' : 'light';
  html.style.backgroundColor = dark ? BASE.dark : BASE.light;
}
