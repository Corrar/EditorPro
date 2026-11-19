/* utilitários de montagem dos modelos (compartilhados por templates.ts e templatesMore.ts) */
import type { TextStyle } from '../types';
import type { Frame, TemplateParam } from './templates';

export const P = (key: string, label: string, def: string, multiline = false): TemplateParam => ({ key, label, type: 'text', default: def, multiline });
export const N = (key: string, label: string, def: number): TemplateParam => ({ key, label, type: 'number', default: String(def) });
/** estilo de texto base dos modelos (sem contorno/sombra, centralizado) */
export const ts = (s: Partial<TextStyle>): Partial<TextStyle> => ({ strokeWidth: 0, shadow: false, align: 'center', ...s });
/** margem lateral dos lower thirds (fração da largura) */
export const mx = (f: Frame) => (f.portrait ? 0.07 : 0.06);
/** linha base dos lower thirds */
export const ly = (f: Frame) => (f.portrait ? 0.74 : 0.78);
/** centro x para um texto alinhado à esquerda começando em `left` */
export const leftX = (f: Frame, left: number, text: string, style: Partial<TextStyle>) => left + f.textW(text, style) / 2;
/** px base-1920 -> fração da altura */
export const fy = (px: number) => px / 1920;
/** lado (fração) de um quadrado de `size` do lado menor do quadro */
export const sq = (f: Frame, size: number) => ({ w: (size * f.short) / f.W, h: (size * f.short) / f.H });
