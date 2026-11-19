/* =====================================================================
   "Vídeo modelo" anexado no chat (puro, testado):
   - describeStyle: resumo legível do StyleProfile detectado
   - styleScopeFromText / wantsApplyNow: o que o usuário pediu junto
   - styleOps: aplica o estilo no modo demo (ritmo de cortes, legendas, cores…)
   - modelRequestText: pedido equivalente para o Claude
   ===================================================================== */
import { applyOps, type EditOp } from '../ops';
import type { CaptionStyle, Project, StyleProfile } from '../types';
import { colorOps, norm, videoClipsOf } from './demo';
import { templateCaptionStyle, templateOps } from './template';
import { captionPresetDef } from '../library';

export type StyleScope = 'all' | 'captions' | 'pacing' | 'colors';

const NATIVE_CAPTIONS: Record<string, string> = { classic: 'clássica', 'bold-pop': 'negrito pop', karaoke: 'karaokê', minimal: 'minimal', boxed: 'em caixa', neon: 'neon' };
const PACING = { 'very-fast': 'muito rápido', fast: 'rápido', medium: 'moderado', slow: 'calmo' } as const;
const COLORS: Record<string, string> = {
  cinematic: 'cinematográficas', warm: 'quentes', cool: 'frias', vibrant: 'vibrantes', vintage: 'vintage / desbotadas',
  bw: 'preto e branco', moody: 'escuras / dramáticas', none: 'naturais',
};
const TRANSITIONS: Record<string, string> = {
  cut: 'corte seco', crossfade: 'dissolver', fade: 'fade', 'zoom-in': 'zoom', 'zoom-out': 'zoom', whip: 'chicote',
  'slide-left': 'deslizar', 'slide-right': 'deslizar', spin: 'giro', flash: 'flash', glitch: 'glitch',
};

/** resumo do estilo, uma linha por aspecto (para a resposta no chat) */
export function describeStyle(s: StyleProfile, name?: string): string {
  const cps = s.avgShotLength > 0 ? 1 / s.avgShotLength : 0;
  const lines: string[] = [];
  lines.push(name ? `Estilo do modelo “${name}”:` : 'Estilo do modelo:');
  const n = (x: number, d: number) => x.toFixed(d).replace('.', ',');
  lines.push(`• Ritmo: ${PACING[s.pacing]} — ${n(cps, cps < 1 ? 2 : 1)} corte${cps > 1.04 ? 's' : ''} por segundo (tomada média de ${n(s.avgShotLength, 1)} s)`);
  if (s.aspect) lines.push(`• Formato: ${s.aspect}`);
  if (s.captions) {
    if (!s.captions.present) lines.push('• Legendas: não tem');
    else {
      const bits = [
        s.captions.preset ? captionPresetDef(String(s.captions.preset))?.name ?? NATIVE_CAPTIONS[String(s.captions.preset)] ?? String(s.captions.preset) : '',
        s.captions.maxWords ? `${s.captions.maxWords} palavra${s.captions.maxWords > 1 ? 's' : ''} por vez` : '',
        s.captions.uppercase ? 'maiúsculas' : '',
        s.captions.color ? `cor ${s.captions.color}` : '',
      ].filter(Boolean);
      lines.push(`• Legendas: sim${bits.length ? ` (${bits.join(', ')})` : ''}`);
    }
  }
  lines.push(`• Cores/look: ${s.colorPreset ? COLORS[s.colorPreset] ?? s.colorPreset : 'naturais'}`);
  const MOVES: Record<string, string> = { static: 'câmera parada (sem zoom)', 'smooth-push': 'aproximação lenta e suave', 'push-pull': 'aproxima e afasta, suave', punch: 'zoom em pancada', pan: 'movimento lateral', handheld: 'câmera na mão', mixed: 'movimento misto' };
  const mv = s.template?.motion ?? (s.motion ? { mode: s.motion.kind, avgZoomPerShot: s.motion.zoomPerShot ?? 1 } : undefined);
  if (mv) lines.push(`• Movimento: ${MOVES[mv.mode] ?? mv.mode}${Math.abs(mv.avgZoomPerShot - 1) > 0.01 ? ` (${n(Math.abs(mv.avgZoomPerShot - 1) * 100, 0)}% por tomada)` : ''}`);
  else lines.push(`• Zooms: ${s.zoomPunchIns ? 'punch-ins rápidos nas frases' : 'não medido — uso aproximação lenta e suave'}`);
  const tr = [...new Set(s.transitions.map((t) => TRANSITIONS[t] ?? t))];
  if (tr.length) lines.push(`• Transições: ${tr.join(', ')}`);
  if (s.textOverlays) lines.push(`• Textos na tela: ${s.textOverlays.present ? `sim${s.textOverlays.examples?.length ? ` (ex.: “${s.textOverlays.examples.slice(0, 2).join('”, “')}”)` : ''}` : 'não'}`);
  if (s.music) lines.push(`• Música: ${s.music.present ? `sim, energia ${({ low: 'baixa', medium: 'média', high: 'alta' } as const)[s.music.energy]}${s.music.genre ? ` (${s.music.genre})` : ''}` : 'não'}`);
  if (s.hook) lines.push(`• Gancho: ${s.hook}`);
  if (s.structure?.length) lines.push(`• Estrutura: ${s.structure.join(' → ')}`);
  return lines.join('\n');
}

/** "só as legendas" / "só o ritmo" / "só as cores" (ou nada = tudo) */
export function styleScopeFromText(text: string): StyleScope | undefined {
  const t = norm(text);
  if (/\bso\b.*(legenda|letra)/.test(t)) return 'captions';
  if (/\bso\b.*(ritmo|corte|cortes|velocidade|pacing)/.test(t)) return 'pacing';
  if (/\bso\b.*(cor|cores|look|filtro|coloriz)/.test(t)) return 'colors';
  return undefined;
}

/** o usuário pediu para aplicar já ao anexar ("deixa igual a esse", "segue esse modelo") */
export function wantsApplyNow(text: string): boolean {
  const t = norm(text);
  if (!t) return false;
  return /(igual|parecid|mesmo estilo|mesmo jeito|desse jeito|assim|segue|seguindo|siga|copia|copie|imita|aplica|aplique|faz (um|o) (igual|assim)|nesse estilo|neste estilo|como (esse|este|o modelo)|edita como|deixa (igual|assim|como))/.test(t) || !!styleScopeFromText(text);
}

const SCOPE_TEXT: Record<StyleScope, string> = {
  all: 'Reedite seguindo o estilo do vídeo modelo',
  captions: 'Aplique só as legendas no estilo do vídeo modelo',
  pacing: 'Aplique só o ritmo de cortes do vídeo modelo',
  colors: 'Aplique só as cores do vídeo modelo',
};
export function modelRequestText(scope: StyleScope): string { return SCOPE_TEXT[scope]; }
export const SCOPE_LABELS: Record<Exclude<StyleScope, 'all'>, string> = { captions: 'Só as legendas', pacing: 'Só o ritmo de cortes', colors: 'Só as cores' };

/**
 * Modo demo: aplica o estilo do modelo no projeto (o modelo é o molde DEFINITIVO).
 * - ritmo: corta no tamanho das tomadas do modelo, nos respiros da fala (templateOps), com o
 *   movimento de câmera dele (suave por padrão; pancada só se o modelo tiver) e só as transições dele
 * - legendas: estilo do modelo (medido > descrito)
 * - cores: `graded` = a cor já foi casada (colorGrade) → tira presets antigos (não empilha dois looks);
 *   sem grade, usa o preset do perfil
 */
export function styleOps(p: Project, s: StyleProfile, scope: StyleScope = 'all', opts: { graded?: boolean } = {}): { ops: EditOp[]; said: string[] } {
  const ops: EditOp[] = [];
  const said: string[] = [];
  let sim = p;
  const push = (more: EditOp[], phrase?: string) => {
    if (!more.length) return;
    sim = applyOps(sim, more).project;
    ops.push(...more);
    if (phrase) said.push(phrase);
  };

  // cores antes dos cortes: os pedaços herdam a cor (menos passos ao vivo)
  if (scope === 'all' || scope === 'colors') {
    if (opts.graded) {
      const stale = videoClipsOf(sim).filter((c) => !c.locked && c.colorPreset && c.colorPreset !== 'none');
      push(stale.map((c) => ({ op: 'update_clip' as const, clipId: c.id, patch: { colorPreset: 'none' as const }, explain: 'Tirando o look antigo (a cor agora vem do modelo)' })));
    } else if (s.colorPreset && s.colorPreset !== 'none') {
      push(colorOps(sim, s.colorPreset, COLORS[s.colorPreset] ?? s.colorPreset), `cores ${COLORS[s.colorPreset] ?? s.colorPreset}`);
    } else if (scope === 'colors') said.push('o modelo usa cores naturais — não mudei nada');
  }

  if (scope === 'all' || scope === 'pacing') {
    const t = templateOps(sim, s, { captions: false });
    push(t.ops);
    said.push(...t.said);
    if (!t.ops.length && !said.length) said.push('o vídeo já está no ritmo do modelo');
  }

  if ((scope === 'all' || scope === 'captions') && s.captions) {
    if (!s.captions.present) {
      if (s.template && sim.captions.enabled && scope === 'captions') push([{ op: 'toggle_captions', enabled: false, explain: 'O modelo não usa legendas' }], 'escondi as legendas (o modelo não tem)');
    } else {
      const measured = s.template ? templateCaptionStyle(s.template) : undefined;
      const { present: _p, ...rest } = s.captions;
      const style = { ...(rest as Partial<CaptionStyle>), ...(measured ?? {}) };
      if (Object.keys(style).length) push([{ op: 'set_caption_style', style, explain: 'Legendas no estilo do modelo' }], 'legendas no estilo do modelo');
      if (sim.captions.segments.length && !sim.captions.enabled) push([{ op: 'toggle_captions', enabled: true, explain: 'Mostrando as legendas' }]);
      if (!sim.captions.segments.length) said.push('as legendas aparecem assim que forem geradas');
    }
  }

  if (scope === 'all' && s.aspect && s.aspect !== sim.aspect) push([{ op: 'set_aspect', aspect: s.aspect, explain: `Formato ${s.aspect} como o modelo` }], `formato ${s.aspect}`);
  return { ops, said };
}
