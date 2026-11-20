/* =====================================================================
   Ritmo da edição AO VIVO para lotes grandes (puro, testado).
   Lote pequeno: cada op é um passo com a pausa cheia (dá para ver o cursor).
   Lote grande: as primeiras ops passam uma a uma ("editando ao vivo") e o
   resto entra em poucos passos agrupados por tipo (cortes, movimento, cor…),
   com pausa curta — o lote inteiro cabe em ~7 s, mesmo num celular.
   ===================================================================== */
import type { EditOp } from '../ops';
import { shortExplain } from './order';

/** orçamento total de pausas de um lote ao vivo (ms) */
export const LIVE_BUDGET_MS = 7000;
/** orçamento das ops mostradas uma a uma no começo do lote grande (ms) */
export const LIVE_FULL_BUDGET_MS = 4800;
/** no máximo tantas ops uma a uma num lote grande */
export const LIVE_FULL_MAX = 8;
/** no máximo tantos passos agrupados depois delas */
export const LIVE_MAX_GROUPS = 8;
/** pausa dos passos agrupados: mínima e máxima (ms) */
export const LIVE_GROUP_MIN_MS = 150;
export const LIVE_GROUP_MAX_MS = 450;

export interface LivePlan {
  /** índices das ops em cada passo (partição em ordem) */
  steps: number[][];
  /** quantos passos (do começo) são de uma op só com a pausa cheia */
  full: number;
  /** pausa de cada passo agrupado (ms), com a pausa cheia `base` */
  groupMs: number;
}

/** categoria da op para juntar passos parecidos (e dar nome ao grupo) */
export function liveKind(op: EditOp): string {
  switch (op.op) {
    case 'ripple_delete': case 'remove_words': case 'cut_pauses': case 'split_clip': case 'trim_clip': case 'remove_clip': return 'cut';
    case 'move_clip': case 'duplicate_clip': return 'move';
    case 'set_captions': case 'set_caption_style': case 'update_caption': case 'toggle_captions': return 'captions';
    case 'add_marker': case 'update_marker': case 'remove_marker': return 'marker';
    case 'add_clip': return op.clip.type === 'audio' ? 'audio' : op.clip.type === 'video' || op.clip.type === 'image' ? 'media' : op.clip.type === 'adjustment' ? 'color' : 'text';
    case 'update_clip': {
      const k = Object.keys(op.patch ?? {});
      if (k.includes('keyframes') || k.includes('transform')) return 'motion';
      if (k.includes('transitionIn')) return 'transition';
      if (k.some((x) => ['colorGrade', 'colorPreset', 'filters', 'adjust', 'lut'].includes(x))) return 'color';
      if (k.some((x) => ['effects', 'blend', 'mask'].includes(x))) return 'effects';
      if (k.some((x) => ['volume', 'audioEffects', 'fadeIn', 'fadeOut', 'muted', 'duckUnderVoice', 'pitch'].includes(x))) return 'audio';
      if (k.some((x) => ['text', 'style', 'position', 'animation', 'animationOut', 'animationLoop'].includes(x))) return 'text';
      if (k.some((x) => ['speed', 'speedCurve', 'reverse'].includes(x))) return 'speed';
      return 'clip';
    }
    default: return 'project';
  }
}

/**
 * Divide o lote em passos. `base` = pausa cheia por op (ms). Cabe no orçamento: uma op por passo.
 * Senão: até LIVE_FULL_MAX ops uma a uma (cabendo em LIVE_FULL_BUDGET_MS) e o resto em
 * ≤ LIVE_MAX_GROUPS passos (sequências do mesmo tipo; grupos vizinhos menores se juntam).
 */
export function planLiveSteps(ops: EditOp[], base: number): LivePlan {
  const n = ops.length;
  const b = Math.max(0, base);
  if (n * b <= LIVE_BUDGET_MS || n <= 3) return { steps: ops.map((_, i) => [i]), full: n, groupMs: b };
  const full = Math.min(n, LIVE_FULL_MAX, Math.max(3, Math.floor(LIVE_FULL_BUDGET_MS / Math.max(1, b))));
  const groups: { kind: string; idx: number[] }[] = [];
  for (let i = full; i < n; i++) {
    const kind = liveKind(ops[i]);
    const last = groups[groups.length - 1];
    if (last && last.kind === kind) last.idx.push(i);
    else groups.push({ kind, idx: [i] });
  }
  // muitos grupos pequenos (tipos alternados): junta o menor com o vizinho menor até caber
  while (groups.length > LIVE_MAX_GROUPS) {
    let k = 0;
    for (let i = 1; i < groups.length; i++) if (groups[i].idx.length < groups[k].idx.length) k = i;
    const left = k > 0 ? groups[k - 1] : undefined;
    const right = k < groups.length - 1 ? groups[k + 1] : undefined;
    const into = !right || (left && left.idx.length <= right.idx.length) ? k - 1 : k + 1;
    const [a, z] = into < k ? [into, k] : [k, into];
    groups.splice(a, 2, { kind: groups[a].kind === groups[z].kind ? groups[a].kind : 'mixed', idx: [...groups[a].idx, ...groups[z].idx] });
  }
  const rest = Math.max(0, LIVE_BUDGET_MS - full * b);
  const groupMs = groups.length ? Math.round(Math.max(LIVE_GROUP_MIN_MS, Math.min(LIVE_GROUP_MAX_MS, b, rest / groups.length))) : b;
  return { steps: [...ops.slice(0, full).map((_, i) => [i]), ...groups.map((g) => g.idx)], full, groupMs };
}

/** pausa do passo `step` do plano (lida a cada passo: "Mais rápido" no meio vale na hora) */
export function liveStepDelay(plan: LivePlan, step: number, base: number): number {
  return step < plan.full ? base : Math.min(base, plan.groupMs);
}

const KIND_LABEL: Record<string, (n: number) => string> = {
  cut: (n) => `${n} cortes`,
  move: (n) => `${n} clipes reposicionados`,
  captions: (n) => (n > 1 ? `${n} ajustes nas legendas` : 'Legendas'),
  marker: (n) => `${n} marcadores`,
  audio: (n) => `${n} ajustes de áudio`,
  media: (n) => `${n} clipes na timeline`,
  color: (n) => `Cor em ${n} clipes`,
  motion: (n) => `Movimento em ${n} tomadas`,
  transition: (n) => `${n} transições`,
  effects: (n) => `Efeitos em ${n} clipes`,
  text: (n) => `${n} textos`,
  speed: (n) => `Velocidade em ${n} clipes`,
};

/** nome curto de um passo agrupado (vai na lista de passos do chat) */
export function groupLabel(ops: EditOp[]): string {
  if (ops.length === 1) return shortExplain(ops[0].explain);
  const kinds = new Set(ops.map(liveKind));
  const one = kinds.size === 1 ? KIND_LABEL[[...kinds][0]] : undefined;
  return one ? one(ops.length) : `Mais ${ops.length} ajustes de uma vez`;
}
