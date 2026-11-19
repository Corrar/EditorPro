/* =====================================================================
   Ordem "boa de assistir" para a edição ao vivo (puro, testado):
   cortes (esquerda -> direita) -> legendas -> cor/efeitos/transições ->
   textos/stickers/modelos -> áudio -> marcadores/resto.
   Só troca a ordem se o resultado final for IDÊNTICO ao da ordem original
   (as ops da IA foram calculadas em sequência; nada pode mudar de lugar).
   Também garante `explain` curto (é o balão do cursor da IA).
   ===================================================================== */
import { applyOps, type EditOp } from '../ops';
import type { Project } from '../types';

function rank(op: EditOp): number {
  switch (op.op) {
    case 'set_aspect': case 'set_project': case 'add_track': case 'update_track': case 'move_track': return 0;
    case 'ripple_delete': case 'split_clip': case 'trim_clip': case 'remove_clip': case 'move_clip': case 'remove_words': case 'duplicate_clip': return 1;
    case 'set_captions': case 'set_caption_style': case 'update_caption': case 'toggle_captions': return 2;
    case 'update_clip': {
      const k = Object.keys(op.patch ?? {});
      if (k.some((x) => ['volume', 'audioEffects', 'pitch', 'fadeIn', 'fadeOut', 'muted', 'duckUnderVoice'].includes(x))) return 5;
      if (k.some((x) => ['text', 'style', 'position', 'animation', 'animationOut', 'animationLoop'].includes(x))) return 4;
      return 3;
    }
    case 'add_clip': {
      const t = op.clip.type;
      if (t === 'video' || t === 'image') return 1;
      if (t === 'adjustment') return 3;
      if (t === 'audio') return 5;
      return 4; // text / sticker / shape
    }
    case 'add_marker': case 'update_marker': case 'remove_marker': return 6;
    default: return 6;
  }
}

/** posição na timeline (p/ ordenar cada grupo da esquerda para a direita) */
function timeOf(op: EditOp): number {
  const o = op as unknown as Record<string, unknown>;
  if (typeof o.start === 'number') return o.start;
  if (typeof o.at === 'number') return o.at;
  if (op.op === 'add_clip') return op.clip.start;
  return Number.POSITIVE_INFINITY; // sem tempo: mantém a ordem relativa no fim do grupo
}

const sig = (p: Project) => JSON.stringify(p.tracks) + JSON.stringify(p.captions) + JSON.stringify(p.markers ?? []) + p.aspect;

function safe(p: Project, ops: EditOp[]): Project | null {
  try {
    const r = applyOps(p, ops);
    return r.errors.length ? null : r.project;
  } catch { return null; }
}

export function orderForViewing(ops: EditOp[], p: Project): EditOp[] {
  if (ops.length < 3) return ops;
  const target = safe(p, ops);
  if (!target) return ops;
  const want = sig(target);
  const idx = ops.map((op, i) => ({ op, i, r: rank(op), t: timeOf(op) }));
  // 1ª tentativa: por grupo e, dentro do grupo, da esquerda p/ direita; 2ª: só por grupo
  const tries = [
    [...idx].sort((a, b) => a.r - b.r || a.t - b.t || a.i - b.i),
    [...idx].sort((a, b) => a.r - b.r || (a.r === 1 ? 0 : a.t - b.t) || a.i - b.i),
    [...idx].sort((a, b) => a.r - b.r || a.i - b.i),
  ];
  for (const tr of tries) {
    const cand = tr.map((x) => x.op);
    if (cand.every((o, i) => o === ops[i])) return ops;
    const res = safe(p, cand);
    if (res && sig(res) === want) return cand;
  }
  return ops;
}

/** balão do cursor: curto, sem ponto final, no máximo ~60 caracteres */
export function shortExplain(text: string | undefined, fallback = 'Editando'): string {
  let t = (text ?? '').replace(/\s+/g, ' ').trim().replace(/[.;]+$/, '');
  if (!t) return fallback;
  if (t.length > 60) t = `${t.slice(0, 57).replace(/\s+\S*$/, '')}…`;
  return t.charAt(0).toUpperCase() + t.slice(1);
}
